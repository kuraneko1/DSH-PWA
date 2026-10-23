window.__ModuleLoader__.load({
  id: "rdsh-pwa",
  factory(require) {
    // rdsh-pwa — browser half.
    //
    // Makes the DSH Web GUI behave like an app: registers the app-shell service
    // worker (offline launch + static-asset caching), surfaces the install
    // prompt in the sidebar and in Settings, offers a reload when a new build
    // is waiting, reports the offline state, and insets the layout for notches
    // and home indicators when launched standalone.
    //
    // The host half (index.js) serves /manifest.webmanifest, /sw.js and the
    // icons, and adds viewport-fit=cover to the index. Nothing here depends on
    // a build step: this file is loaded verbatim by the client module loader.
    const React = require("react");
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;

    const SCOPE = new URL("./", document.baseURI);
    const SW_URL = new URL("sw.js", SCOPE).href;
    /** Script URL of the notification plugin's worker (see unifyWorker below). */
    const PUSH_WORKER_PATH = "/push/sw.js";
    const STYLE_ATTR = "data-rdsh-pwa-style";
    const ROOT_ATTR = "data-rdsh-pwa";
    const UPDATE_POLL_MS = 30 * 60 * 1000;
    const UPDATE_MIN_GAP_MS = 5 * 60 * 1000;
    const INSTALL_PROMPT_KEY = "rdsh-pwa:install-prompt-dismissed";
    const INSTALL_PROMPT_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000;
    const NARROW_QUERY = "(max-width: 767px)";

    const STANDALONE_QUERY = "(display-mode: standalone)";
    const FULLSCREEN_QUERY = "(display-mode: fullscreen)";
    const MINIMAL_QUERY = "(display-mode: minimal-ui)";

    function isStandalone() {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
      if (window.matchMedia(STANDALONE_QUERY).matches) return true;
      if (window.matchMedia(FULLSCREEN_QUERY).matches) return true;
      if (window.matchMedia(MINIMAL_QUERY).matches) return true;
      return navigator.standalone === true;
    }

    function isIos() {
      const ua = navigator.userAgent || "";
      if (/iPad|iPhone|iPod/.test(ua)) return true;
      // iPadOS 13+ reports a desktop Mac UA; touch points give it away.
      return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    }

    const CSS = `
html[data-rdsh-pwa="standalone"] #root {
  box-sizing: border-box;
  padding-top: env(safe-area-inset-top, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  padding-left: env(safe-area-inset-left, 0px);
}
html[data-rdsh-pwa="standalone"] { overscroll-behavior-y: none; }
html[data-rdsh-pwa="standalone"] body { overscroll-behavior-y: contain; }
html[data-rdsh-pwa="standalone"] .rdsh-pwa-toasts { top: calc(env(safe-area-inset-top, 0px) + 10px); }

/* Phones: keep the toast column clear of the 64px sidebar header, and hang the
   install card on the right so the logo (session list) stays tappable. */
@media (max-width: 767px) {
  .rdsh-pwa-toasts { top: calc(env(safe-area-inset-top, 0px) + 8px); padding-top: 56px; }
  .rdsh-pwa-install { align-self: flex-end; max-width: min(330px, calc(100vw - 24px)); flex-wrap: wrap; row-gap: 8px; }
  .rdsh-pwa-install .rdsh-pwa-card-text { flex: 1 1 100%; }
  .rdsh-pwa-install-actions { display: flex; gap: 8px; margin-left: auto; align-items: center; }
}

.rdsh-pwa-toasts {
  position: fixed; top: 10px; left: 50%; transform: translateX(-50%);
  z-index: 960; display: flex; flex-direction: column; align-items: center;
  gap: 8px; width: min(420px, calc(100vw - 24px)); pointer-events: none;
}
.rdsh-pwa-pill {
  pointer-events: none; padding: 6px 14px; border-radius: 999px;
  background: var(--dsw-alias-bg-module-platform, #2a2a2e);
  color: var(--dsw-alias-label-secondary, #cfd3d6);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.12));
  box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.35));
  font-size: 12px; line-height: 18px; white-space: nowrap;
}
.rdsh-pwa-card {
  pointer-events: auto; display: flex; align-items: center; gap: 10px;
  width: 100%; box-sizing: border-box; padding: 10px 12px; border-radius: 14px;
  background: var(--dsw-alias-bg-module-platform, #2a2a2e);
  color: var(--dsw-alias-label-primary, #f9fafb);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.12));
  box-shadow: var(--dsw-elevation-prominent, 0 8px 24px rgba(0,0,0,.35));
  font-size: 13px; line-height: 1.5;
}
.rdsh-pwa-card-text { flex: 1; min-width: 0; }
.rdsh-pwa-card button {
  font: inherit; font-size: 13px; cursor: pointer; border-radius: 999px;
  padding: 5px 12px; border: 0;
  background: var(--dsw-alias-button-primary-fill, #4d6bfe);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.rdsh-pwa-card button:hover { background: var(--dsw-alias-button-primary-hover, #5c78ff); }
.rdsh-pwa-card button.rdsh-pwa-quiet {
  background: transparent; color: var(--dsw-alias-label-secondary, #cfd3d6);
  padding: 5px 8px;
}
.rdsh-pwa-card button.rdsh-pwa-quiet:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }

.rdsh-pwa-foot {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 36px; min-width: 36px; padding: 0 10px; border: 0; border-radius: 999px;
  background: transparent; color: var(--dsw-alias-label-primary, #f9fafb);
  font: inherit; font-size: 13px; cursor: pointer; white-space: nowrap;
  -webkit-tap-highlight-color: transparent;
}
.rdsh-pwa-foot[data-wide="false"] { width: 36px; min-width: 36px; padding: 0; }
.rdsh-pwa-foot:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }
.rdsh-pwa-foot svg { flex: none; }

.rdsh-pwa-section { display: flex; flex-direction: column; gap: 12px; color: var(--dsw-alias-label-primary, #f9fafb); }
.rdsh-pwa-cardbox {
  border: .5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3, rgba(255,255,255,.12)));
  background: var(--dsw-alias-settings-card-fill, transparent);
  border-radius: 12px; padding: 12px 14px; display: flex; flex-direction: column; gap: 10px;
}
.rdsh-pwa-title { margin: 0; font-size: 16px; font-weight: 500; }
.rdsh-pwa-desc { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #adb2b8); }
.rdsh-pwa-rows { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 14px; margin: 0; font-size: 13px; }
.rdsh-pwa-rows dt { color: var(--dsw-alias-label-secondary, #cfd3d6); }
.rdsh-pwa-rows dd { margin: 0; overflow-wrap: anywhere; }
.rdsh-pwa-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.rdsh-pwa-actions button {
  font: inherit; font-size: 13px; min-height: 34px; padding: 0 14px; border-radius: 9px; cursor: pointer;
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  background: transparent; color: var(--dsw-alias-label-primary, #f9fafb);
}
.rdsh-pwa-actions button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }
.rdsh-pwa-actions button.rdsh-pwa-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #4d6bfe);
  color: var(--dsw-alias-label-primary-foreground, #fff);
}
.rdsh-pwa-actions button:disabled { opacity: .45; cursor: default; }
.rdsh-pwa-note { font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #adb2b8); margin: 0; }
.rdsh-pwa-code { font-family: var(--dsh-font-family-code, monospace); font-size: 12px; }
`;

    // ---------------------------------------------------------------------
    // Store
    // ---------------------------------------------------------------------
    const state = {
      installable: false,
      standalone: isStandalone(),
      offline: typeof navigator.onLine === "boolean" ? !navigator.onLine : false,
      bootError: "",
      updateReady: false,
      updateDismissed: false,
      // pending | active | unsupported | insecure | error
      sw: "pending",
      swError: "",
      swScript: "",
      build: "",
      cache: "",
      ios: isIos(),
      narrow: typeof window.matchMedia === "function" ? window.matchMedia(NARROW_QUERY).matches : false,
      secure: typeof window.isSecureContext === "boolean" ? window.isSecureContext : false,
      installing: false,
      installDismissed: false,
    };
    const subscribers = new Set();
    // Small ring buffer for diagnostics (and for tests that drive the page).
    const transitions = [];
    function emit(patch, source) {
      Object.assign(state, patch);
      transitions.push({ at: Date.now(), patch, source: source ?? "" });
      if (transitions.length > 40) transitions.shift();
      for (const fn of subscribers) {
        try {
          fn();
        } catch {
          /* a broken subscriber must not stop the others */
        }
      }
    }
    function useStore() {
      const [, tick] = useState(0);
      useEffect(() => {
        const force = () => tick((n) => (n + 1) % 1000000);
        subscribers.add(force);
        return () => {
          subscribers.delete(force);
        };
      }, []);
      return state;
    }

    // ---------------------------------------------------------------------
    // Install prompt
    // ---------------------------------------------------------------------
    let installEvent = null;

    async function promptInstall() {
      if (installEvent === null) return "unavailable";
      const event = installEvent;
      installEvent = null;
      emit({ installable: false, installing: true });
      try {
        event.prompt();
        const choice = await event.userChoice;
        const outcome = choice && choice.outcome ? choice.outcome : "dismissed";
        // "accepted" installs the app but leaves this tab a tab: the standalone
        // state stays owned by the display-mode media query.
        if (outcome === "accepted") emit({ installable: false });
        return outcome;
      } catch {
        return "error";
      } finally {
        emit({ installing: false });
      }
    }

    // ---------------------------------------------------------------------
    // Service worker
    // ---------------------------------------------------------------------
    let registration = null;
    let updateRequested = false;
    let reloading = false;
    let lastUpdateCheck = 0;

    async function applyUpdate() {
      updateRequested = true;
      emit({ updateReady: false });
      try {
        const reg = registration ?? (await navigator.serviceWorker.getRegistration());
        if (reg !== null && reg !== undefined && reg.waiting !== null) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
          // controllerchange reloads; keep a fallback for a worker that
          // already activated behind our back.
          setTimeout(() => {
            if (!reloading) location.reload();
          }, 1500);
          return;
        }
        location.reload();
      } catch {
        location.reload();
      }
    }

    async function checkForUpdate() {
      const now = Date.now();
      if (now - lastUpdateCheck < 3000) return;
      lastUpdateCheck = now;
      try {
        const reg = registration ?? (await navigator.serviceWorker.getRegistration());
        if (reg === null || reg === undefined) return;
        emit({}, "checked");
        await reg.update();
        const waiting = reg.waiting === null ? "" : reg.waiting.scriptURL;
        if (isOwnWorker(waiting) && navigator.serviceWorker.controller !== null) emit({ updateReady: true }, "check");
      } catch {
        /* offline or the server is restarting; the next poll retries */
      }
    }

    function watchRegistration(reg) {
      const note = () => {
        const waiting = reg.waiting === null ? "" : reg.waiting.scriptURL;
        if (isOwnWorker(waiting) && navigator.serviceWorker.controller !== null) emit({ updateReady: true }, "watch");
      };
      note();
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (installing === null) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed") note();
        });
      });
    }

    async function pingWorker() {
      try {
        const reg = registration ?? (await navigator.serviceWorker.getRegistration());
        const worker = reg === null || reg === undefined ? null : reg.active;
        if (worker === null) return;
        const channel = new MessageChannel();
        const reply = new Promise((resolve) => {
          const timer = setTimeout(() => resolve(null), 1200);
          channel.port1.onmessage = (event) => {
            clearTimeout(timer);
            resolve(event.data ?? null);
          };
        });
        worker.postMessage({ type: "PING" }, [channel.port2]);
        const data = await reply;
        if (data && typeof data === "object") emit({ build: String(data.build ?? ""), cache: String(data.cache ?? "") });
      } catch {
        /* the badge simply stays empty */
      }
    }

    /**
     * Whether a service worker script URL is this plugin's own worker.
     * @param {string|undefined} url
     * @returns {boolean}
     */
    function isOwnWorker(url) {
      if (typeof url !== "string" || url === "") return false;
      try {
        return new URL(url).pathname === new URL(SW_URL).pathname;
      } catch {
        return false;
      }
    }

    /**
     * Tolerate the notification plugin's null-subscription bug.
     *
     * `dsh-notify-push` reads `getSubscription()` and tests `!== undefined`, so
     * a browser returning null throws inside its controllerchange handler. The
     * redirection below hands it a registration whose `getSubscription()`
     * reports "no subscription" the way that code expects; every other member
     * passes through to the real object.
     *
     * @param {ServiceWorkerRegistration} registration
     * @returns {ServiceWorkerRegistration}
     */
    function tolerateNullSubscription(registration) {
      const manager = registration.pushManager;
      if (manager === undefined || manager === null) return registration;
      const pushManager = new Proxy(manager, {
        get(target, property) {
          if (property === "getSubscription") {
            return async () => (await target.getSubscription()) ?? undefined;
          }
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      return new Proxy(registration, {
        get(target, property) {
          if (property === "pushManager") return pushManager;
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }

    /**
     * Redirect the notification plugin's worker registration to ours.
     *
     * A browser allows one controlling worker per scope, so `dsh-notify-push`
     * (registered at /push/sw.js with scope "/") and this plugin would keep
     * replacing each other on every controllerchange: the loser stays
     * "waiting", the offline cache never controls the page and the update
     * banner fires on a worker that is not an update. Our worker implements
     * that plugin's push/notificationclick contract, so pointing its
     * registration here keeps notifications working and leaves exactly one
     * worker in charge.
     *
     * The wrapper only rewrites that one script URL; every other registration
     * passes through untouched, and cleanup restores the original function.
     */
    function unifyWorker() {
      const prototype = Object.getPrototypeOf(navigator.serviceWorker);
      const nativeRegister = prototype.register;
      const patched = function register(url, options) {
        try {
          const resolved = new URL(String(url), document.baseURI);
          if (resolved.pathname.endsWith(PUSH_WORKER_PATH)) {
            return nativeRegister.call(this, SW_URL, { ...options, scope: SCOPE.pathname })
              .then(tolerateNullSubscription);
          }
        } catch {
          /* fall through to the untouched registration */
        }
        return nativeRegister.call(this, url, options);
      };
      prototype.register = patched;
      return () => {
        if (prototype.register === patched) prototype.register = nativeRegister;
      };
    }

    async function registerWorker() {
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
        emit({ sw: "unsupported" });
        return;
      }
      if (!state.secure) {
        emit({ sw: "insecure" });
        return;
      }
      try {
        const existing = await navigator.serviceWorker.getRegistration();
        if (existing !== null && existing !== undefined) {
          const worker = existing.active ?? existing.waiting ?? existing.installing;
          const script = worker === null ? "" : worker.scriptURL;
          if (!isOwnWorker(script) && script.endsWith(PUSH_WORKER_PATH)) {
            // Replace the notification worker with the unified one. Its push
            // subscription is recreated by that plugin on controllerchange.
            await existing.unregister();
          } else if (script !== "" && !isOwnWorker(script)) {
            // An unknown worker owns this scope: never fight it, just report.
            emit({ sw: "shared", swScript: script });
            return;
          }
        }
        registration = await navigator.serviceWorker.register(SW_URL, {
          scope: SCOPE.pathname,
          updateViaCache: "none",
        });
        emit({ sw: navigator.serviceWorker.controller !== null ? "active" : "pending" });
        watchRegistration(registration);
        navigateWhenControllerChanges();
        if (registration.active !== null) void pingWorker();
        navigator.serviceWorker.ready.then(() => {
          emit({ sw: "active" });
          void pingWorker();
        }).catch(() => {});
      } catch (error) {
        emit({ sw: "error", swError: String((error && error.message) || error) });
      }
    }

    function navigateWhenControllerChanges() {
      if (navigator.serviceWorker.controller !== null) {
        emit({ sw: "active" });
        void pingWorker();
        return;
      }
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (updateRequested) {
          if (!reloading) {
            reloading = true;
            location.reload();
          }
          return;
        }
        emit({ sw: "active" }, "controllerchange");
        void pingWorker();
      }, { once: false });
    }

    // ---------------------------------------------------------------------
    // Toasts (plain DOM: they must survive any React tree remount)
    // ---------------------------------------------------------------------
    let toastRoot = null;
    let renderedSignature = "";

    function installPromptSnoozed() {
      try {
        const until = Number(localStorage.getItem(INSTALL_PROMPT_KEY) || 0);
        return Number.isFinite(until) && until > Date.now();
      } catch {
        return false;
      }
    }

    function snoozeInstallPrompt() {
      try {
        localStorage.setItem(INSTALL_PROMPT_KEY, String(Date.now() + INSTALL_PROMPT_SNOOZE_MS));
      } catch {
        /* private mode: the prompt simply returns next launch */
      }
      emit({ installDismissed: true });
    }

    /**
     * Whether the conversation is still the empty "new session" view. The
     * install card only belongs there: on a live transcript it would cover the
     * header tabs.
     */
    function onWelcomeScreen() {
      const header = document.querySelector("header[data-window-drag]");
      return header !== null && /_headerBlank/.test(header.className);
    }

    /** The release banner: whether a compact install affordance belongs on screen. */
    function showInstallPrompt() {
      if (state.standalone || state.installDismissed) return false;
      if (!state.narrow) return false;
      if (!state.installable && !state.ios) return false;
      if (!onWelcomeScreen()) return false;
      return !installPromptSnoozed();
    }

    function renderToasts() {
      if (toastRoot === null) return;
      const install = showInstallPrompt();
      const signature = JSON.stringify([state.offline, state.updateReady && !state.updateDismissed, install]);
      if (signature === renderedSignature) return;
      renderedSignature = signature;
      toastRoot.replaceChildren();
      if (install) {
        const card = document.createElement("div");
        card.className = "rdsh-pwa-card rdsh-pwa-install";
        const text = document.createElement("span");
        text.className = "rdsh-pwa-card-text";
        text.textContent = state.installable
          ? "DSH をアプリとしてインストールできます"
          : "Safari の共有 → 「ホーム画面に追加」でアプリにできます";
        const installButton = document.createElement("button");
        installButton.type = "button";
        installButton.textContent = "インストール";
        installButton.addEventListener("click", () => void promptInstall());
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = "rdsh-pwa-quiet";
        dismiss.textContent = "あとで";
        dismiss.addEventListener("click", snoozeInstallPrompt);
        const actions = document.createElement("div");
        actions.className = "rdsh-pwa-install-actions";
        if (state.installable) actions.append(installButton);
        actions.append(dismiss);
        card.append(text, actions);
        toastRoot.append(card);
      }
      if (state.updateReady && !state.updateDismissed) {
        const card = document.createElement("div");
        card.className = "rdsh-pwa-card";
        const text = document.createElement("span");
        text.className = "rdsh-pwa-card-text";
        text.textContent = "新しいバージョンがあります";
        const reload = document.createElement("button");
        reload.type = "button";
        reload.textContent = "再読み込み";
        reload.addEventListener("click", () => void applyUpdate());
        const dismiss = document.createElement("button");
        dismiss.type = "button";
        dismiss.className = "rdsh-pwa-quiet";
        dismiss.textContent = "あとで";
        dismiss.addEventListener("click", () => emit({ updateDismissed: true }));
        card.append(text, reload, dismiss);
        toastRoot.append(card);
      }
      if (state.offline) {
        const pill = document.createElement("div");
        pill.className = "rdsh-pwa-pill";
        pill.textContent = "オフライン — 再接続を待っています";
        toastRoot.append(pill);
      }
    }

    // ---------------------------------------------------------------------
    // UI
    // ---------------------------------------------------------------------
    function InstallIcon({ size }) {
      return h(
        "svg",
        { width: size, height: size, viewBox: "0 0 24 24", fill: "none", "aria-hidden": "true" },
        h("path", {
          d: "M12 3v11m0 0 4-4m-4 4-4-4",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
        h("path", {
          d: "M4.5 16.5V18A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-1.5",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
        }),
      );
    }

    function InstallFooterAction({ wide }) {
      const s = useStore();
      if (!s.installable) return null;
      return h(
        "button",
        {
          type: "button",
          className: "rdsh-pwa-foot",
          "data-wide": wide ? "true" : "false",
          title: "アプリとしてインストール",
          "aria-label": "アプリとしてインストール",
          onClick: () => void promptInstall(),
        },
        h(InstallIcon, { size: wide ? 16 : 18 }),
        wide ? h("span", null, "インストール") : null,
      );
    }

    function swLabel(s) {
      switch (s.sw) {
        case "active":
          return s.updateReady ? "有効（更新待ち）" : "有効";
        case "unsupported":
          return "このブラウザは非対応";
        case "insecure":
          return "無効（HTTPS または localhost で有効）";
        case "shared":
          return "他のサービスワーカーが制御中（キャッシュ無効）";
        case "error":
          return "登録に失敗";
        default:
          return "準備中";
      }
    }

    function installLabel(s) {
      if (s.standalone) return "インストール済み（アプリとして起動中）";
      if (s.installable) return "インストールできます";
      if (s.ios) return "Safari の共有メニュー →「ホーム画面に追加」";
      if (!s.secure) return "HTTPS で開くとインストールできます";
      return "このブラウザでは未対応";
    }

    function PwaSettingsSection() {
      const s = useStore();
      const [message, setMessage] = useState("");
      const [busy, setBusy] = useState(false);

      const install = async () => {
        const outcome = await promptInstall();
        setMessage(outcome === "accepted" ? "インストールしました。" : outcome === "dismissed" ? "キャンセルしました。" : "この環境ではプロンプトを出せません。");
      };
      const check = async () => {
        setBusy(true);
        setMessage("");
        try {
          const reg = registration ?? (await navigator.serviceWorker.getRegistration());
          if (reg === null || reg === undefined) {
            setMessage("サービスワーカーが未登録です。");
          } else {
            await reg.update();
            const waiting = reg.waiting !== null;
            emit({ updateReady: waiting && navigator.serviceWorker.controller !== null });
            setMessage(waiting ? "新しいバージョンがあります。" : "最新です。");
          }
        } catch {
          setMessage("確認できませんでした（オフラインの可能性があります）。");
        } finally {
          setBusy(false);
          void pingWorker();
        }
      };

      return h(
        "section",
        { className: "rdsh-pwa-section" },
        h(
          "div",
          { className: "rdsh-pwa-cardbox" },
          h("h3", { className: "rdsh-pwa-title" }, "アプリ（PWA）"),
          h("p", { className: "rdsh-pwa-desc" }, "DSH を独立したアプリウィンドウで起動し、オフライン時も画面を表示できるようにします。"),
          h(
            "dl",
            { className: "rdsh-pwa-rows" },
            h("dt", null, "表示モード"),
            h("dd", null, s.standalone ? "アプリ（スタンドアロン）" : "ブラウザ"),
            h("dt", null, "インストール"),
            h("dd", null, installLabel(s)),
            h("dt", null, "オフライン起動"),
            h("dd", null, swLabel(s)),
            s.build !== "" ? h("dt", null, "ビルド") : null,
            s.build !== "" ? h("dd", { className: "rdsh-pwa-code" }, s.build) : null,
          ),
          h(
            "div",
            { className: "rdsh-pwa-actions" },
            s.installable ? h("button", { type: "button", className: "rdsh-pwa-primary", onClick: install, disabled: busy }, "インストール") : null,
            s.updateReady ? h("button", { type: "button", className: "rdsh-pwa-primary", onClick: () => void applyUpdate() }, "再読み込みして更新") : null,
            h("button", { type: "button", onClick: check, disabled: busy }, busy ? "確認中…" : "更新を確認"),
          ),
          message !== "" ? h("p", { className: "rdsh-pwa-note" }, message) : null,
          s.ios && !s.standalone
            ? h("p", { className: "rdsh-pwa-note" }, "iPhone / iPad: Safari の共有ボタンから「ホーム画面に追加」を選ぶと、アプリとして起動できます。")
            : null,
          !s.secure ? h("p", { className: "rdsh-pwa-note" }, "オフライン起動とインストールは HTTPS または localhost でのみ有効になります。") : null,
          s.sw === "error" && s.swError !== "" ? h("p", { className: "rdsh-pwa-note" }, `サービスワーカーの登録に失敗しました: ${s.swError}`) : null,
          s.bootError !== "" ? h("p", { className: "rdsh-pwa-note" }, `起動時にエラーが発生しました: ${s.bootError}`) : null,
        ),
      );
    }

    // The mobile settings tab merges this section instead of showing the
    // separate "アプリ" tab.
    globalThis.__RDSH_PWA_SETTINGS_SECTION__ = PwaSettingsSection;

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------
    let booted = false;

    function boot(ctx) {
      if (booted) return;
      booted = true;

      ctx.effect(() => {
        const style = document.createElement("style");
        style.setAttribute(STYLE_ATTR, "true");
        style.textContent = CSS;
        document.head.appendChild(style);

        toastRoot = document.createElement("div");
        toastRoot.className = "rdsh-pwa-toasts";
        toastRoot.setAttribute("role", "status");
        toastRoot.setAttribute("aria-live", "polite");
        document.body.appendChild(toastRoot);

        const applyMode = () => {
          const standalone = isStandalone();
          document.documentElement.setAttribute(ROOT_ATTR, standalone ? "standalone" : "browser");
          emit({ standalone });
          renderToasts();
        };
        applyMode();

        // Belt and braces: if the served index predates the host tap, the
        // viewport still has to allow drawing under the notch.
        const viewport = document.querySelector('meta[name="viewport"]');
        if (viewport !== null && !/viewport-fit\s*=\s*cover/i.test(viewport.content)) {
          viewport.content = `${viewport.content}, viewport-fit=cover`;
        }

        const modeQueries = [STANDALONE_QUERY, FULLSCREEN_QUERY, MINIMAL_QUERY].map((query) => window.matchMedia(query));
        for (const media of modeQueries) media.addEventListener("change", applyMode);
        const narrowMedia = window.matchMedia(NARROW_QUERY);
        const onNarrow = () => emit({ narrow: narrowMedia.matches });
        narrowMedia.addEventListener("change", onNarrow);

        const onOnline = () => {
          emit({ offline: false });
          renderToasts();
          void checkForUpdate();
        };
        const onOffline = () => {
          emit({ offline: true });
          renderToasts();
        };
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);

        const onBeforeInstall = (event) => {
          event.preventDefault();
          installEvent = event;
          emit({ installable: true });
        };
        const onInstalled = () => {
          installEvent = null;
          emit({ installable: false });
          renderToasts();
        };
        window.addEventListener("beforeinstallprompt", onBeforeInstall);
        window.addEventListener("appinstalled", onInstalled);

        const restoreRegister = unifyWorker();
        const unsubscribe = subscribeToStore(renderToasts);
        // Navigation swaps the welcome view for a transcript (and back); the
        // install card depends on which one is mounted.
        let toastTimer = 0;
        const viewObserver = new MutationObserver(() => {
          if (toastTimer !== 0) return;
          toastTimer = setTimeout(() => {
            toastTimer = 0;
            renderToasts();
          }, 300);
        });
        viewObserver.observe(document.body, { childList: true, subtree: true });
        renderToasts();
        // Diagnostics surface: the Settings section reads the same store, and
        // an end-to-end test can assert on it without scraping the DOM.
        globalThis.__RDSH_PWA__ = {
          get state() { return { ...state }; },
          get transitions() { return transitions.slice(); },
          applyUpdate,
          checkForUpdate,
          promptInstall,
        };
        void registerWorker();

        // Poll for a new deployment while the tab stays open, and refresh the
        // check when the user comes back to it.
        const timer = setInterval(() => {
          if (document.visibilityState === "visible") void checkForUpdate();
        }, UPDATE_POLL_MS);
        const onVisible = () => {
          if (document.visibilityState === "visible" && Date.now() - lastUpdateCheck > UPDATE_MIN_GAP_MS) void checkForUpdate();
        };
        document.addEventListener("visibilitychange", onVisible);
        window.addEventListener("focus", onVisible);

        return () => {
          style.remove();
          toastRoot.remove();
          toastRoot = null;
          renderedSignature = "";
          emit({ installDismissed: false });
          for (const media of modeQueries) media.removeEventListener("change", applyMode);
          narrowMedia.removeEventListener("change", onNarrow);
          window.removeEventListener("online", onOnline);
          window.removeEventListener("offline", onOffline);
          window.removeEventListener("beforeinstallprompt", onBeforeInstall);
          window.removeEventListener("appinstalled", onInstalled);
          window.removeEventListener("focus", onVisible);
          document.removeEventListener("visibilitychange", onVisible);
          clearInterval(timer);
          clearTimeout(toastTimer);
          viewObserver.disconnect();
          unsubscribe();
          restoreRegister();
          delete globalThis.__RDSH_PWA__;
          // A live reload disposes and re-applies the plugin: let the effect
          // mount again instead of leaving the shell torn down.
          booted = false;
        };
      }, "rdsh-pwa: app shell");
    }

    // Subscribers are a Set of no-arg callbacks; the hook and the toast
    // renderer share it.
    function subscribeToStore(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        try {
          boot(ctx);
        } catch (error) {
          // Surface a boot failure to Settings and to tests instead of leaving
          // only a console trace behind.
          console.error("[rdsh-pwa] boot failed", error);
          emit({ bootError: String((error && error.message) || error) });
        }
        ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
          name: "sidebar.footer.action",
          id: "pwa-install",
          order: 40,
        }, InstallFooterAction));
        ctx.slots.inject("settings.section", () => ctx.slots.register({
          name: "settings.section",
          id: "pwa",
          order: 80,
          label: () => "アプリ",
        }, PwaSettingsSection));
      },
    };
  },
});
