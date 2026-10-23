/**
 * rdsh-pwa — host half.
 *
 * Serves what the browser needs to treat the DSH Web GUI as an installable
 * app, without patching the installed DSH dist:
 *
 *   /manifest.webmanifest   a real manifest (PNG + maskable icons, standalone
 *                           display, id, theme/background colors, screenshots)
 *   /sw.js                  an app-shell service worker (offline launch, static
 *                           asset caching, never caches /api)
 *   /pwa/*.png              icons, the Apple touch icon and store screenshots
 *
 * and decorates the served index.html with the iOS/Android metadata the stock
 * page lacks (viewport-fit=cover, apple-touch-icon, standalone title, ...).
 *
 * Every route is registered on the Web server's exact-route table, so it wins
 * over the SPA fallback and stays alive across HMR recompositions.
 *
 * @module rdsh-pwa
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Stable Cordis plugin name. */
export const name = "rdsh-pwa";

/** HTTP routes need `webServer`; mount lazily so headless profiles stay clean. */
export const inject = [];

/** Marker proving the index already carries our metadata block. */
const INDEX_MARKER = "<!--rdsh-pwa-->";

/** Manifest and viewport limits we normalize before serving. */
const DISPLAY_MODES = new Set(["standalone", "minimal-ui", "fullscreen", "browser", "window-controls-overlay"]);

/**
 * Configurable knobs. Defaults target the DSH dark shell; every value is a
 * string/number/boolean so the profile patch stays readable.
 */
export const DEFAULTS = {
	name: "DeepSeek Harness",
	shortName: "DSH",
	description: "DeepSeek Harness をアプリのように起動します。",
	lang: "ja",
	display: "standalone",
	themeColor: "#151517",
	backgroundColor: "#151517",
	appleStatusBarStyle: "black-translucent",
	enableServiceWorker: true,
	navigationTimeoutMs: 1500,
};

/** Static files we own, keyed by the public route path. */
const ASSETS = new Map([
	["/pwa/icon-192.png", { file: "assets/icon-192.png", type: "image/png" }],
	["/pwa/icon-512.png", { file: "assets/icon-512.png", type: "image/png" }],
	["/pwa/icon-maskable-192.png", { file: "assets/icon-maskable-192.png", type: "image/png" }],
	["/pwa/icon-maskable-512.png", { file: "assets/icon-maskable-512.png", type: "image/png" }],
	["/pwa/apple-touch-icon.png", { file: "assets/apple-touch-icon.png", type: "image/png" }],
	["/pwa/badge-96.png", { file: "assets/badge-96.png", type: "image/png" }],
	["/pwa/screenshot-mobile.png", { file: "assets/screenshot-mobile.png", type: "image/png" }],
	["/pwa/screenshot-desktop.png", { file: "assets/screenshot-desktop.png", type: "image/png" }],
]);

/** One year for icons: the URLs are versioned by the manifest, not the path. */
const ICON_CACHE_CONTROL = "public, max-age=86400";
const SHELL_CACHE_CONTROL = "no-cache";
const JS_CACHE_CONTROL = "no-cache, no-store, must-revalidate";

function text(value, fallback, limit) {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
	if (trimmed === "") return fallback;
	return trimmed.slice(0, limit);
}

function color(value, fallback) {
	if (typeof value !== "string") return fallback;
	const trimmed = value.trim();
	// Accept #rgb/#rrggbb/#rrggbbaa and CSS color functions/keywords only.
	if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed)) return trimmed;
	if (/^(?:rgb|hsl)a?\([\d\s.,%/-]+\)$/i.test(trimmed)) return trimmed;
	if (/^[a-z]{3,20}$/i.test(trimmed)) return trimmed;
	return fallback;
}

/** Normalize user config; never throw on a bad profile patch. */
export function normalizeConfig(input) {
	const src = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
	const display = text(src.display, DEFAULTS.display, 32);
	const timeout = Number(src.navigationTimeoutMs);
	return {
		name: text(src.name, DEFAULTS.name, 80),
		shortName: text(src.shortName, DEFAULTS.shortName, 24),
		description: text(src.description, DEFAULTS.description, 300),
		lang: text(src.lang, DEFAULTS.lang, 12),
		display: DISPLAY_MODES.has(display) ? display : DEFAULTS.display,
		themeColor: color(src.themeColor, DEFAULTS.themeColor),
		backgroundColor: color(src.backgroundColor, DEFAULTS.backgroundColor),
		appleStatusBarStyle: /^(?:default|black|black-translucent)$/.test(String(src.appleStatusBarStyle))
			? src.appleStatusBarStyle
			: DEFAULTS.appleStatusBarStyle,
		enableServiceWorker: src.enableServiceWorker !== false,
		navigationTimeoutMs: Number.isFinite(timeout) ? Math.min(10000, Math.max(300, Math.round(timeout))) : DEFAULTS.navigationTimeoutMs,
	};
}

/**
 * Build the manifest document.
 *
 * Relative URLs keep the app working when a proxy mounts DSH under a prefix:
 * the browser resolves them against the manifest URL, not the site root.
 *
 * @param {object} [config] - profile config for this plugin.
 * @returns {object} a JSON-serializable Web App Manifest.
 */
export function buildManifest(config) {
	const cfg = normalizeConfig(config);
	return {
		id: "./",
		name: cfg.name,
		short_name: cfg.shortName,
		description: cfg.description,
		lang: cfg.lang,
		dir: "ltr",
		start_url: "./",
		scope: "./",
		display: cfg.display,
		// explicit fallbacks: fullscreen degrades to standalone on desktop, and
		// minimal-ui keeps a back affordance on platforms without our layout.
		display_override: [cfg.display, "minimal-ui"],
		orientation: "any",
		background_color: cfg.backgroundColor,
		theme_color: cfg.themeColor,
		categories: ["productivity", "developer"],
		// Chrome treats a related-app preference as "do not install the PWA".
		prefer_related_applications: false,
		// Clicking the installed icon focuses the running window instead of
		// navigating it, so a live agent session survives the relaunch.
		launch_handler: { client_mode: "focus-existing" },
		icons: [
			{ src: "pwa/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
			{ src: "pwa/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
			{ src: "pwa/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
			{ src: "pwa/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
			{ src: "favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
		],
		screenshots: [
			{ src: "pwa/screenshot-mobile.png", sizes: "390x844", type: "image/png", form_factor: "narrow", label: "チャット画面" },
			{ src: "pwa/screenshot-desktop.png", sizes: "1280x720", type: "image/png", form_factor: "wide", label: "デスクトップ表示" },
		],
	};
}

function escapeAttribute(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

/**
 * Rewrite the viewport meta so a standalone launch fills the screen while the
 * composer stays above the keyboard.
 */
function withViewport(html) {
	const viewport = /<meta\b[^>]*\bname=["']viewport["'][^>]*>/i.exec(html);
	if (viewport === null) {
		return html.replace(/<head(\s[^>]*)?>/i, (open) => `${open}<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">`);
	}
	const tag = viewport[0];
	const content = /\bcontent=["']([^"']*)["']/i.exec(tag);
	const base = content === null ? "width=device-width, initial-scale=1" : content[1];
	const parts = base
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part !== "")
		.filter((part) => !/^(?:viewport-fit|interactive-widget)\s*=/i.test(part));
	parts.push("viewport-fit=cover", "interactive-widget=resizes-content");
	const value = `content="${escapeAttribute(parts.join(", "))}"`;
	const next = content === null ? tag.replace(/\s*\/?>$/, (tail) => ` ${value}${tail.trim() === "/>" ? " />" : ">"}`) : tag.replace(content[0], value);
	return html.replace(tag, next);
}

/**
 * Add the metadata a home-screen launch needs. Pure and idempotent: the
 * returned HTML carries {@link INDEX_MARKER} exactly once.
 *
 * @param {string} html - the index document the Web server rendered.
 * @param {object} [config] - profile config for this plugin.
 * @returns {string} the decorated document.
 */
export function decorateIndex(html, config) {
	if (typeof html !== "string" || html === "") return html;
	if (html.includes(INDEX_MARKER)) return html;
	const cfg = normalizeConfig(config);
	const head = [
		INDEX_MARKER,
		// Match the working todoka-drive setup: the standard capable meta and
		// the install manifest, but NOT apple-mobile-web-app-capable/title.
		// iOS 26 uses a mis-sized legacy frame when the Apple-specific capable
		// meta is present (status bar height left unpainted at the bottom).
		'<meta name="mobile-web-app-capable" content="yes">',
		`<meta name="apple-mobile-web-app-status-bar-style" content="${escapeAttribute(cfg.appleStatusBarStyle)}">`,
		// Code samples carry numbers; iOS must not turn them into call links.
		'<meta name="format-detection" content="telephone=no">',
		'<link rel="apple-touch-icon" href="pwa/apple-touch-icon.png">',
	].join("");
	const out = withViewport(html);
	const open = /<head(?:\s[^>]*)?>/i.exec(out);
	if (open !== null) return `${out.slice(0, open.index + open[0].length)}${head}${out.slice(open.index + open[0].length)}`;
	return `${head}${out}`;
}

function respond(res, method, status, headers, body) {
	const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
	res.writeHead(status, { ...headers, "content-length": payload.length });
	if (method === "HEAD") res.end();
	else res.end(payload);
}

function methodNotAllowed(res, allow) {
	res.writeHead(405, { allow, "content-type": "text/plain; charset=utf-8" });
	res.end("method not allowed\n");
}

function readOnly(handler) {
	return async (req, res) => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			methodNotAllowed(res, "GET, HEAD");
			return;
		}
		await handler(req, res);
	};
}

function assetPath(file) {
	return new URL(`./${file}`, import.meta.url);
}


/**
 * Strip the PWA markup that makes iOS 26 use its mis-sized legacy standalone
 * frame. Served only at /launch, as a test for the 47px bottom strip.
 */
function stripPwaMarkup(html) {
	return html
		.replace(/<link\b[^>]*\brel=["']manifest["'][^>]*>/gi, "")
		.replace(/<link\b[^>]*\brel=["']apple-touch-icon["'][^>]*>/gi, "")
		.replace(/<meta\b[^>]*\bname=["'](?:apple-mobile-web-app-[^"']*|mobile-web-app-capable|application-name)["'][^>]*>/gi, "")
		.replace(/<meta\b[^>]*\bname=["']viewport["'][^>]*>/i, '<meta name="viewport" content="width=device-width, initial-scale=1">')
		.replace(/<base\b[^>]*>/i, '<base href="/">');
}


/**
 * Mount the routes, assets and index decoration.
 * @param {object} ctx - plugin context.
 * @param {object} [config] - profile config for this plugin.
 */
export function apply(ctx, config) {
	const cfg = normalizeConfig(config);
	// Read once per activation: a deployment restart is what makes new bytes
	// visible, which is also what bumps the service-worker build hash.
	const files = new Map();
	const readAsset = async (file) => {
		if (!files.has(file)) files.set(file, readFile(assetPath(file)));
		return files.get(file);
	};

	let build;
	const serviceWorkerSource = async () => {
		if (build !== undefined) return build;
		const source = await readFile(assetPath("sw.js"), "utf8");
		const hash = createHash("sha256").update(source).digest("hex").slice(0, 12);
		const header = `self.__RDSH_PWA_BUILD__=${JSON.stringify(hash)};self.__RDSH_PWA_CONFIG__=${JSON.stringify({ navigationTimeoutMs: cfg.navigationTimeoutMs })};\n`;
		build = header + source;
		return build;
	};

	ctx.inject(["webServer"], (webCtx) => {
		const webServer = webCtx.webServer;
		const disposes = [];

		disposes.push(webServer.register({
			kind: "exact",
			path: "/manifest.webmanifest",
			handler: readOnly((req, res) => {
				respond(res, req.method, 200, {
					"content-type": "application/manifest+json; charset=utf-8",
					"cache-control": SHELL_CACHE_CONTROL,
				}, JSON.stringify(buildManifest(cfg), null, 2));
			}),
		}));

		if (cfg.enableServiceWorker) {
			disposes.push(webServer.register({
				kind: "exact",
				path: "/sw.js",
				handler: readOnly(async (req, res) => {
					const source = await serviceWorkerSource();
					respond(res, req.method, 200, {
						"content-type": "text/javascript; charset=utf-8",
						"cache-control": JS_CACHE_CONTROL,
						// The worker lives at the root and controls the whole origin.
						"service-worker-allowed": "/",
						"x-content-type-options": "nosniff",
					}, source);
				}),
			}));
		}

		for (const [route, asset] of ASSETS) {
			disposes.push(webServer.register({
				kind: "exact",
				path: route,
				handler: readOnly(async (req, res) => {
					try {
						const body = await readAsset(asset.file);
						respond(res, req.method, 200, {
							"content-type": asset.type,
							"cache-control": ICON_CACHE_CONTROL,
							"x-content-type-options": "nosniff",
						}, body);
					} catch {
						res.writeHead(404);
						res.end();
					}
				}),
			}));
		}

		disposes.push(webServer.register({
			kind: "exact",
			path: "/launch",
			handler: readOnly(async (req, res) => {
				try {
					// Use the rendered index so the normal client injections stay,
					// then strip only the PWA tags that trigger the legacy frame.
					const response = await fetch(`${webServer.getOrigin()}/`, { headers: { accept: "text/html" } });
					const html = await response.text();
					respond(res, req.method, 200, {
						"content-type": "text/html; charset=utf-8",
						"cache-control": "no-store",
					}, stripPwaMarkup(html));
				} catch {
					res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
					res.end("launch page unavailable\n");
				}
			}),
		}));

		disposes.push(webServer.tapIndex((html) => decorateIndex(html, cfg)));

		return () => {
			for (const dispose of disposes) if (typeof dispose === "function") dispose();
		};
	});
}
