/**
 * Host-half unit tests: no DSH process, no browser.
 *
 * The plugin is pure enough to test directly: the manifest, the index
 * decoration and every HTTP route are ordinary functions over (req, res).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { apply, buildManifest, decorateIndex, normalizeConfig } from "../index.js";

/** Collect the routes a plugin registers on a fake web server. */
function mount(config) {
	const routes = new Map();
	const taps = [];
	const webServer = {
		register(route) {
			assert.equal(routes.has(route.path), false, `duplicate route ${route.path}`);
			routes.set(route.path, route);
			return () => routes.delete(route.path);
		},
		tapIndex(fn) {
			taps.push(fn);
			return () => taps.splice(taps.indexOf(fn), 1);
		},
	};
	const ctx = {
		inject(deps, callback) {
			assert.deepEqual(deps, ["webServer"]);
			return callback({ webServer });
		},
	};
	apply(ctx, config);
	return { routes, taps };
}

/** Invoke one registered route with a fake request/response pair. */
async function call(route, method = "GET", url = route.path) {
	const chunks = [];
	let status;
	let headers;
	const res = {
		writeHead(code, value) {
			status = code;
			headers = value;
		},
		end(body) {
			if (body !== undefined) chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(body));
		},
	};
	await route.handler({ method, url }, res);
	return { status, headers, body: Buffer.concat(chunks), text: Buffer.concat(chunks).toString("utf8") };
}

const INDEX = `<!doctype html><html lang="en"><head><base href="./"><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>DeepSeek Harness</title></head><body><div id="root"></div></body></html>`;

test("manifest carries the installability fields Chrome requires", () => {
	const manifest = buildManifest({});
	assert.equal(manifest.display, "standalone");
	assert.equal(manifest.prefer_related_applications, false);
	assert.equal(typeof manifest.start_url, "string");
	assert.equal(manifest.id, "./");
	const sizes = manifest.icons.map((icon) => icon.sizes);
	assert.ok(sizes.includes("192x192"), "an install prompt needs a 192px icon");
	assert.ok(sizes.includes("512x512"), "a splash screen needs a 512px icon");
	assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable"), "Android masks the icon");
	assert.ok(manifest.icons.some((icon) => icon.type === "image/svg+xml"), "the vector mark stays available");
	// Relative URLs keep the app correct behind a prefix-stripping proxy.
	assert.ok(manifest.icons.every((icon) => !icon.src.startsWith("/")));
	assert.equal(manifest.scope, "./");
});

test("manifest normalizes hostile or partial config", () => {
	const manifest = buildManifest({
		display: "bogus",
		name: "  ",
		shortName: "<script>",
		themeColor: "url(javascript:alert(1))",
		backgroundColor: "#123456",
		navigationTimeoutMs: 10 ** 9,
	});
	assert.equal(manifest.display, "standalone", "an unknown display falls back");
	assert.equal(manifest.name, "DeepSeek Harness", "blank names fall back");
	assert.equal(manifest.theme_color, "#151517", "non-colors are rejected");
	assert.equal(manifest.background_color, "#123456");
	assert.equal(normalizeConfig({ navigationTimeoutMs: 10 ** 9 }).navigationTimeoutMs, 10000);
	assert.equal(normalizeConfig({ navigationTimeoutMs: -5 }).navigationTimeoutMs, 300);
});

test("index decoration adds iOS metadata and an edge-to-edge viewport", () => {
	const html = decorateIndex(INDEX, {});
	assert.ok(html.includes('name="mobile-web-app-capable"'),
		"the standard capable meta is used");
	assert.ok(!html.includes('name="apple-mobile-web-app-capable"'),
		"the Apple-only capable meta would force the iOS 26 legacy frame");
	assert.ok(html.includes('rel="apple-touch-icon"'));
	assert.ok(html.includes('name="format-detection" content="telephone=no"'));
	assert.ok(html.includes("viewport-fit=cover"));
	assert.ok(html.includes("interactive-widget=resizes-content"));
	assert.ok(html.includes("width=device-width"));
	assert.ok(html.includes("initial-scale=1"), "existing viewport parts survive");
});

test("index decoration is idempotent", () => {
	const once = decorateIndex(INDEX, {});
	const twice = decorateIndex(once, {});
	assert.equal(once, twice, "a second tap must not duplicate the block");
	assert.equal(once.split("<!--rdsh-pwa-->").length - 1, 1);
	assert.equal(decorateIndex("", {}), "");
});

test("decorateIndex still works when the document has no viewport or head", () => {
	const bare = decorateIndex("<div id=root></div>", {});
	assert.ok(bare.includes("<!--rdsh-pwa-->"));
	assert.ok(bare.includes("</div>"));
	const noViewport = decorateIndex("<head></head><body></body>", {});
	assert.match(noViewport, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">/);
});

test("routes serve the manifest, the worker and the icons", async () => {
	const { routes, taps } = mount({});
	assert.ok(routes.has("/manifest.webmanifest"));
	assert.ok(routes.has("/sw.js"));
	assert.ok(routes.has("/pwa/icon-192.png"));
	assert.equal(taps.length, 1);

	const manifest = await call(routes.get("/manifest.webmanifest"));
	assert.equal(manifest.status, 200);
	assert.match(manifest.headers["content-type"], /application\/manifest\+json/);
	assert.equal(JSON.parse(manifest.text).display, "standalone");
	assert.equal(manifest.headers["cache-control"], "no-cache");

	const worker = await call(routes.get("/sw.js"));
	assert.equal(worker.status, 200);
	assert.match(worker.headers["content-type"], /text\/javascript/);
	assert.equal(worker.headers["service-worker-allowed"], "/");
	assert.match(worker.headers["cache-control"], /no-store/);
	assert.match(worker.text, /^self\.__RDSH_PWA_BUILD__="[0-9a-f]{12}";/);
	// The served bytes must parse as JavaScript.
	assert.doesNotThrow(() => new Function(worker.text));

	// The build hash is stable within one activation so an idle restart does
	// not push a bogus "update available" prompt.
	const again = await call(routes.get("/sw.js"));
	assert.equal(again.text, worker.text);
	// It must change when the worker source changes; the cache name derives
	// from it, so a stale shell cannot survive a release.
	assert.match(worker.text, /CACHE_NAME = CACHE_PREFIX \+ BUILD|const CACHE_NAME = CACHE_PREFIX \+ BUILD/);

	for (const icon of ["/pwa/icon-192.png", "/pwa/icon-512.png", "/pwa/icon-maskable-512.png", "/pwa/apple-touch-icon.png", "/pwa/badge-96.png"]) {
		const route = routes.get(icon);
		assert.ok(route, `${icon} is served`);
		const response = await call(route);
		assert.equal(response.status, 200, `${icon} exists`);
		assert.equal(response.headers["content-type"], "image/png");
		assert.ok(response.body.length > 500, `${icon} is not empty`);
	}
});

test("the worker injects the configured navigation timeout", async () => {
	const { routes } = mount({ navigationTimeoutMs: 2500 });
	const worker = await call(routes.get("/sw.js"));
	assert.match(worker.text, /"navigationTimeoutMs":2500/);
	assert.match(worker.text, /self\.__RDSH_PWA_CONFIG__=/);
});

test("routes reject methods they do not own", async () => {
	const { routes } = mount({});
	for (const path of ["/manifest.webmanifest", "/sw.js", "/pwa/icon-192.png"]) {
		const response = await call(routes.get(path), "POST");
		assert.equal(response.status, 405);
		assert.equal(response.headers.allow, "GET, HEAD");
	}
});

test("HEAD returns headers without a body", async () => {
	const { routes } = mount({});
	const response = await call(routes.get("/manifest.webmanifest"), "HEAD");
	assert.equal(response.status, 200);
	assert.equal(response.body.length, 0);
	assert.ok(Number(response.headers["content-length"]) > 10);
});

test("a missing optional asset is a 404, not a crash", async () => {
	const { routes } = mount({});
	const route = routes.get("/pwa/screenshot-mobile.png");
	if (route === undefined) return;
	const response = await call(route);
	assert.ok(response.status === 200 || response.status === 404);
});

test("the service worker never caches live state", async () => {
	const { routes } = mount({});
	const source = (await call(routes.get("/sw.js"))).text;
	assert.match(source, /BYPASS_SEGMENTS = \["\/api", "\/hmr", "\/terminal", "\/__"\]/,
		"API answers must always come from the server");
	assert.match(source, /request\.method !== "GET"/, "mutations are never intercepted");
});
