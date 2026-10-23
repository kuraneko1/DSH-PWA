/*
 * rdsh-pwa — app-shell service worker.
 *
 * Served by the rdsh-pwa host plugin at /sw.js (root scope). The host prepends
 * `self.__RDSH_PWA_BUILD__` and `self.__RDSH_PWA_CONFIG__`; the build hash is
 * derived from this file's bytes, so editing it retires the old cache and
 * makes the page offer "reload to update".
 *
 * Strategy:
 *   navigation  network first (bounded), fall back to the cached shell, then
 *               to a built-in offline page — a launch never shows the browser's
 *               offline error
 *   static      cache first + background revalidate for /assets, /plugins,
 *               /pwa and the favicons; hashed URLs make staleness harmless
 *   /api, /hmr, /terminal, non-GET, cross-origin, ranged requests
 *               never intercepted: live state must come from the server
 */

const BUILD = typeof self.__RDSH_PWA_BUILD__ === "string" ? self.__RDSH_PWA_BUILD__ : "dev";
const CONFIG = (self.__RDSH_PWA_CONFIG__ && typeof self.__RDSH_PWA_CONFIG__ === "object" ? self.__RDSH_PWA_CONFIG__ : {});
const NAVIGATION_TIMEOUT_MS = Number.isFinite(CONFIG.navigationTimeoutMs) ? CONFIG.navigationTimeoutMs : 1500;
const CACHE_PREFIX = "rdsh-pwa-";
const CACHE_NAME = CACHE_PREFIX + BUILD;
const MAX_STATIC_ENTRIES = 250;

const SCOPE = new URL(self.registration.scope);
const SHELL_URL = new URL("./", SCOPE).href;
const MANIFEST_URL = new URL("manifest.webmanifest", SCOPE).href;

/** Paths, relative to the scope, whose responses are safe to serve from cache. */
const STATIC_PREFIXES = ["assets/", "plugins/", "pwa/"];
const STATIC_FILES = new Set(["favicon.svg", "favicon-dark.svg", "manifest.webmanifest"]);

/** Never intercept these: the UI reads live state, terminal and HMR need sockets. */
const BYPASS_SEGMENTS = ["/api", "/hmr", "/terminal", "/__"];

const OFFLINE_HTML = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>オフライン — DSH</title>
<style>
:root{color-scheme:dark}
html,body{height:100%}
body{margin:0;display:grid;place-items:center;background:#151517;color:#f9fafb;
  font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;
  padding:calc(env(safe-area-inset-top,0px) + 24px) 24px calc(env(safe-area-inset-bottom,0px) + 24px)}
main{max-width:22rem;text-align:center}
h1{margin:0 0 8px;font-size:18px;font-weight:600}
p{margin:0 0 20px;color:#adb2b8;font-size:14px}
button{font:inherit;font-size:14px;padding:10px 18px;border-radius:999px;border:0;
  background:#4d6bfe;color:#fff;cursor:pointer}
button:active{transform:scale(.98)}
</style></head>
<body><main>
<h1>オフラインです</h1>
<p>DSH のサーバーに接続できませんでした。<br>Tailscale などのネットワーク接続を確認してください。</p>
<button onclick="location.reload()">再試行</button>
</main></body></html>`;

function isBypassed(url) {
	// A proxy prefix such as /dsh/ keeps working: compare from the scope path.
	const path = url.pathname.slice(SCOPE.pathname.length - 1);
	return BYPASS_SEGMENTS.some((segment) => path === segment || path.startsWith(segment + "/") || path.startsWith(segment + "?"));
}

function isStatic(url) {
	const relative = url.pathname.slice(SCOPE.pathname.length);
	if (STATIC_FILES.has(relative)) return true;
	return STATIC_PREFIXES.some((prefix) => relative.startsWith(prefix));
}

/** Fetch with a deadline; the abort looks like any other network failure. */
async function fetchWithTimeout(request, timeoutMs) {
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return fetch(request);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(request, { signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

function offlineResponse() {
	return new Response(OFFLINE_HTML, {
		status: 200,
		headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
	});
}

/** Keep the shell cache bounded; keys() is insertion order, so drop the oldest. */
async function trim(cache) {
	try {
		const keys = await cache.keys();
		if (keys.length <= MAX_STATIC_ENTRIES) return;
		for (const key of keys.slice(0, keys.length - MAX_STATIC_ENTRIES)) await cache.delete(key);
	} catch {
		/* quota and opaque-response errors are not worth failing a request over */
	}
}

async function put(cache, request, response) {
	try {
		await cache.put(request, response);
	} catch {
		/* ignore: an uncacheable response still reaches the page */
	}
}

async function handleNavigation(request) {
	const cache = await caches.open(CACHE_NAME);
	const cached = await cache.match(SHELL_URL);
	try {
		const response = await fetchWithTimeout(request, NAVIGATION_TIMEOUT_MS);
		if (response.ok && response.type === "basic") {
			// Canonical key: the launch URL may carry auth fragments or query
			// parameters that must not multiply shell entries.
			await put(cache, SHELL_URL, response.clone());
		}
		return response;
	} catch {
		return cached ?? offlineResponse();
	}
}

async function handleStatic(request) {
	const cache = await caches.open(CACHE_NAME);
	const cached = await cache.match(request);
	if (cached !== undefined) {
		// Revalidate in the background; the cached copy answers this request.
		fetch(request)
			.then(async (response) => {
				if (response.ok) await put(cache, request, response);
				await trim(cache);
			})
			.catch(() => {});
		return cached;
	}
	try {
		const response = await fetch(request);
		if (response.ok) {
			await put(cache, request, response.clone());
			await trim(cache);
		}
		return response;
	} catch {
		return cached ?? Response.error();
	}
}

self.addEventListener("install", (event) => {
	event.waitUntil((async () => {
		const cache = await caches.open(CACHE_NAME);
		// Shell first: an offline launch must find the document even if an icon
		// is missing from a deployment.
		for (const url of [SHELL_URL, MANIFEST_URL]) {
			try {
				const response = await fetch(url, { cache: "reload" });
				if (response.ok) await put(cache, url, response);
			} catch {
				/* leave install to succeed; the navigation handler repairs later */
			}
		}
	})());
});

self.addEventListener("activate", (event) => {
	event.waitUntil((async () => {
		for (const key of await caches.keys()) {
			if (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) await caches.delete(key);
		}
		await self.clients.claim();
	})());
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin) return;
	if (isBypassed(url)) return;
	if (request.headers.get("range") !== null) return;
	if (request.mode === "navigate") {
		event.respondWith(handleNavigation(request));
		return;
	}
	// A dev reload asks for fresh bytes; let the network answer it untouched.
	if (request.cache === "no-store") return;
	if (isStatic(url)) event.respondWith(handleStatic(request));
});

/*
 * Web Push, shared with dsh-notify-push.
 *
 * Only one worker can control a scope, so the notification plugin's worker and
 * this one cannot coexist. The client half redirects the plugin's
 * `/push/sw.js` registration here, and these two handlers honour the payload
 * contract that plugin's push sender and its page-side listener expect:
 * `{ title, body, url, sessionId }` in, `dsh-notify-push:open-session` out.
 */
function pushPayload(event) {
	const payload = { title: "DSH: 選択肢", body: "エージェントが選択肢を提示しています", url: "./", sessionId: "" };
	try {
		const data = event.data === null ? null : event.data.json();
		if (data !== null && typeof data === "object") {
			if (typeof data.title === "string") payload.title = data.title;
			if (typeof data.body === "string" && data.body.length > 0) payload.body = data.body;
			if (typeof data.url === "string" && data.url !== "") payload.url = data.url;
			if (typeof data.sessionId === "string") payload.sessionId = data.sessionId;
		}
	} catch {
		/* a non-JSON payload keeps the defaults */
	}
	return payload;
}

self.addEventListener("push", (event) => {
	const payload = pushPayload(event);
	event.waitUntil(self.registration.showNotification(payload.title, {
		body: payload.body,
		icon: new URL("pwa/icon-192.png", SCOPE).href,
		badge: new URL("pwa/badge-96.png", SCOPE).href,
		// One banner per session: a shared tag would merge different sessions.
		tag: payload.sessionId !== "" ? `dsh-notify-push:${payload.sessionId}` : "dsh-ask-user",
		renotify: true,
		requireInteraction: true,
		data: { url: payload.url, sessionId: payload.sessionId },
		actions: [{ action: "open", title: "開く" }],
	}));
});

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const data = (event.notification.data && typeof event.notification.data === "object") ? event.notification.data : {};
	const target = typeof data.url === "string" && data.url !== "" ? data.url : new URL("./", SCOPE).href;
	const sessionId = typeof data.sessionId === "string" ? data.sessionId : "";
	event.waitUntil((async () => {
		const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
		for (const client of windows) {
			if (!("focus" in client)) continue;
			await client.focus();
			// The SPA has no session routing: an open window is switched in-page
			// by the notification plugin's listener instead of by a URL.
			if (sessionId !== "" && "postMessage" in client) {
				client.postMessage({ type: "dsh-notify-push:open-session", sessionId });
				return;
			}
			if (target !== new URL("./", SCOPE).href && "navigate" in client) {
				await client.navigate(target);
				return;
			}
			return;
		}
		await self.clients.openWindow(target);
	})());
});

self.addEventListener("message", (event) => {
	const data = event.data;
	if (data === null || typeof data !== "object") return;
	if (data.type === "SKIP_WAITING") {
		self.skipWaiting();
		return;
	}
	if (data.type === "PING" && event.ports !== null && event.ports.length > 0) {
		event.ports[0].postMessage({ type: "PONG", build: BUILD, cache: CACHE_NAME });
	}
});
