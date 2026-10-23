window.__ModuleLoader__.load({
  id: "rdsh-mobile-ux",
  factory(require) {
    // rdsh-mobile-ux — browser half.
    //
    // Phone-width behaviour for the DSH Web UI. Upstream class names are CSS
    // module hashes that change between releases, so this plugin never styles
    // a hash directly: `decorate()` maps the live DOM onto stable
    // `data-rdsh-*` hooks using structure (slots, aria labels, row keys) and
    // the stylesheet only targets those hooks. A renamed upstream class stops
    // a hook from matching and leaves the stock layout in place (fail closed).
    //
    // What it does, in the order a phone user meets it:
    //   * the session rail becomes an overlay drawer with a slide animation and
    //     a tappable backdrop, so the chat is never squeezed
    //   * a floating three-dot button sits where the rail logo used to be while
    //     the drawer is closed, and taps on it open the drawer (the drawer's
    //     own DeepSeek HARNESS brand stays untouched)
    //   * opening a session closes the drawer and does not steal focus into the
    //     composer
    //   * Settings stacks its navigation over the content instead of squeezing
    //     both into 390px
    //   * controls that cannot work inside an installed PWA (open in editor /
    //     terminal, feedback, sign in) are hidden through a readable list
    //   * running sessions animate their label instead of showing a spinner
    //   * the profile's hide list and notification setup live in Settings
    const React = require("react");
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;

    const NARROW_QUERY = "(max-width: 767px)";
    const HIDE_OVERRIDE_KEY = "rdsh-mobile-ux:hide-disabled";
    const HIDE_EXTRA_KEY = "rdsh-mobile-ux:hide-extra";
    const CONFIG = globalThis.__RDSH_MOBILE_UX_CONFIG__ && typeof globalThis.__RDSH_MOBILE_UX_CONFIG__ === "object"
      ? globalThis.__RDSH_MOBILE_UX_CONFIG__
      : {};
    const ANIMATION = ["aurora", "breathing", "outline", "none"].includes(CONFIG.runningAnimation)
      ? CONFIG.runningAnimation
      : "none";
    /** Shown in Settings so a stale PWA bundle is easy to spot. */
    const BUILD = "2026-10-23.2240-code-wrap-lines2";

    /** Controls that have no meaning inside an installed app on a phone. */
    const HIDE_DEFAULT = [
      "Open in Files",
      "More ways to open",
      "More actions",
      "Feedback",
      "Sign in",
      "Keyboard shortcuts",
      "Desktop notifications",
      "Show coding view",
      "Built-in plugins",
      // Bundled editors and file managers are desktop affordances; on a phone
      // the tap only produces an error or a dead end.
      "Open in Text Editor",
      "Open in editor",
      "Open in Explorer",
      "Reveal in Finder",
    ];

    // ---------------------------------------------------------------------
    // Store
    // ---------------------------------------------------------------------
    const state = {
      narrow: window.matchMedia(NARROW_QUERY).matches,
      drawerOpen: false,
      hidden: [],
      hideDisabled: false,
      notifications: { supported: false, permission: "default", subscribed: false, ready: false },
      notice: "",
      bootError: "",
      enterToSend: readEnterToSend(),
    };
    const subscribers = new Set();
    function emit(patch) {
      Object.assign(state, patch);
      for (const fn of subscribers) {
        try {
          fn();
        } catch {
          /* one broken subscriber must not stop the rest */
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

    function narrow() {
      return window.matchMedia(NARROW_QUERY).matches;
    }

    const ENTER_TO_SEND_KEY = "rdsh-mobile-ux:enter-to-send";

    function readEnterToSend() {
      try {
        return localStorage.getItem(ENTER_TO_SEND_KEY) === "1";
      } catch {
        return false;
      }
    }

    function writeEnterToSend(value) {
      try {
        if (value) localStorage.setItem(ENTER_TO_SEND_KEY, "1");
        else localStorage.removeItem(ENTER_TO_SEND_KEY);
      } catch {
        /* private mode: the choice lasts for this page */
      }
      emit({ enterToSend: value });
    }

    /**
     * Some client bundles register a slash command with a plain string where
     * the runtime calls `description()` / `label()`. That single bad row makes
     * the whole command source throw, which is what breaks the composer's "+"
     * menu (and "/"). Coerce the descriptor fields the runtime invokes.
     */
    function normalizeCommandContribution(contribution) {
      if (contribution === null || typeof contribution !== "object") return contribution;
      const next = { ...contribution };
      for (const field of ["label", "description"]) {
        if (next[field] !== undefined && typeof next[field] !== "function") {
          const value = String(next[field]);
          next[field] = () => value;
        }
      }
      if (next.available !== undefined && typeof next.available !== "function") {
        const value = next.available;
        next.available = () => value;
      }
      return next;
    }

    function patchCommandUi(ctx) {
      ctx.inject(["commandUi"], (scope) => {
        const service = scope.get("commandUi");
        if (service === null || service === undefined) return;
        const registry = service.live && service.live.contributions;
        if (registry instanceof Map) {
          for (const [name, contribution] of [...registry]) registry.set(name, normalizeCommandContribution(contribution));
        }
        const originalRegister = service.register;
        service.register = function register(contribution) {
          return originalRegister.call(this, normalizeCommandContribution(contribution));
        };
        return () => {
          service.register = originalRegister;
        };
      });
    }

    /** Publish the measured safe-area insets so fixed layers can inset too. */
    function measureSafeArea() {
      const probe = document.createElement("div");
      probe.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)";
      document.body.append(probe);
      const style = getComputedStyle(probe);
      const top = parseFloat(style.paddingTop) || 0;
      const bottom = parseFloat(style.paddingBottom) || 0;
      const left = parseFloat(style.paddingLeft) || 0;
      const right = parseFloat(style.paddingRight) || 0;
      probe.remove();
      const root = document.documentElement;
      // iOS 26 standalone: the native web view is ~status-bar-height shorter
      // than the screen (screen.height - innerHeight), so the unpainted strip is
      // below the web view. The home indicator is in that strip, not inside the
      // page; the inner bottom safe-area padding would only enlarge the blank.
      const viewport = window.visualViewport;
      const keyboardOpen = viewport !== null && viewport !== undefined && viewport.height < window.innerHeight - 100;
      const screenHeight = window.screen && Number.isFinite(window.screen.height) ? window.screen.height : 0;
      const nativeGap = window.navigator.standalone === true && !keyboardOpen && screenHeight > 0 && screenHeight - window.innerHeight > 8;
      root.toggleAttribute("data-rdsh-native-gap", nativeGap);
      for (const [name, value] of [["top", top], ["bottom", bottom], ["left", left], ["right", right]]) {
        if (value > 0) root.setAttribute(`data-rdsh-safe-${name}`, "");
        else root.removeAttribute(`data-rdsh-safe-${name}`);
      }
      root.style.setProperty("--rdsh-safe-top", `${top}px`);
      root.style.setProperty("--rdsh-safe-bottom", `${bottom}px`);
      root.style.setProperty("--rdsh-native-gap-px", `${nativeGap ? Math.max(0, Math.round(screenHeight - window.innerHeight)) : 0}px`);
    }

    function readHideExtra() {
      try {
        const value = JSON.parse(localStorage.getItem(HIDE_EXTRA_KEY) || "[]");
        return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim() !== "") : [];
      } catch {
        return [];
      }
    }

    function hideDisabled() {
      if (CONFIG.showHiddenControls === true) return true;
      try {
        return localStorage.getItem(HIDE_OVERRIDE_KEY) === "1";
      } catch {
        return false;
      }
    }

    // ---------------------------------------------------------------------
    // Decoration: live DOM → stable hooks
    // ---------------------------------------------------------------------
    function frame() {
      const root = document.getElementById("root");
      const slot = root && root.firstElementChild;
      return slot && slot.firstElementChild;
    }

    function classToken(element, pattern) {
      return element && element.classList ? [...element.classList].some((token) => pattern.test(token)) : false;
    }

    function labelOf(element) {
      const aria = element.getAttribute("aria-label");
      if (aria && aria.trim() !== "") return aria.trim();
      const item = element.querySelector('[class*="_itemLabel"]');
      const text = item ? item.textContent : element.textContent;
      return (text || "").trim().replace(/\s+/g, " ");
    }

    function hideLabels() {
      return [...HIDE_DEFAULT, ...(Array.isArray(CONFIG.hideLabels) ? CONFIG.hideLabels : []), ...readHideExtra()];
    }

    function shouldHide(label, labels) {
      const normalized = label.toLowerCase();
      return labels.some((entry) => {
        const target = entry.toLowerCase();
        return normalized === target || normalized.startsWith(`${target} `) || normalized.startsWith(`${target}:`);
      });
    }

    function applyHideList(disabled) {
      const labels = hideLabels();
      const hidden = new Set();
      for (const element of document.querySelectorAll("button[aria-label], [role='menuitem']")) {
        const label = labelOf(element);
        if (label === "" || label.length > 48) continue;
        if (!disabled && shouldHide(label, labels)) {
          element.setAttribute("data-rdsh-hidden", "");
          hidden.add(label);
        } else {
          element.removeAttribute("data-rdsh-hidden");
        }
      }
      // Mobile settings: merge the PWA/Input tabs and hide PC-only rows/tabs.
      if (narrow()) {
        const modal = document.querySelector('[data-shortcut-modal="settings"]');
        if (modal !== null) {
          for (const button of modal.querySelectorAll("nav button")) {
            const label = (button.textContent || "").trim();
            const merged = label === "アプリ" || label === "入力";
            const hideTab = merged || (!disabled && shouldHide(label, labels));
            button.toggleAttribute("data-rdsh-settings-tab-hidden", hideTab);
            if (hideTab) hidden.add(label);
          }
          const rowHidden = new Set();
          for (const element of modal.querySelectorAll("*")) {
            if (element.children.length !== 0) continue;
            const text = (element.textContent || "").trim().replace(/\s+/g, " ");
            if (text === "" || text.length > 48 || disabled || !shouldHide(text, labels)) continue;
            let row = element;
            while (row !== null && row !== modal) {
              const cls = typeof row.className === "string" ? row.className : "";
              if (/(^|_)(?:row|setting)(?:_|$)|dswsnd-row/.test(cls)) {
                row.setAttribute("data-rdsh-setting-hidden", "");
                rowHidden.add(row);
                hidden.add(text);
                break;
              }
              row = row.parentElement;
            }
          }
          for (const row of modal.querySelectorAll("[data-rdsh-setting-hidden]")) {
            if (!rowHidden.has(row)) row.removeAttribute("data-rdsh-setting-hidden");
          }
        }
      }
      // Two plugins can add a "copy this session's id" row. Keep one: prefer the
      // localised rdsh row (it reports success) and drop the stock duplicate.
      const menu = document.querySelector("[role='menu']");
      if (menu !== null && !disabled) {
        const items = [...menu.querySelectorAll("[role='menuitem']")];
        const localised = items.find((item) => /セッションIDをコピー/.test(item.textContent || ""));
        const stock = items.find((item) => /^Copy Session ID$/i.test(labelOf(item)));
        if (localised !== undefined && stock !== undefined) {
          stock.setAttribute("data-rdsh-hidden", "");
          hidden.add("Copy Session ID");
        }
      }
      const list = [...hidden].sort();
      if (list.join("|") !== state.hidden.join("|")) emit({ hidden: list });
    }

    function unringSessionTitle(title) {
      const unit = title.querySelector("[data-rdsh-title-unit]");
      if (unit !== null) {
        const label = unit.querySelector("[data-rdsh-title-label]");
        if (label !== null) {
          while (label.firstChild !== null) title.insertBefore(label.firstChild, unit);
        }
        unit.remove();
      }
      title.removeAttribute("data-rdsh-ringed");
    }

    function ringSessionRow(row) {
      row.querySelectorAll(":scope > .rdsh-ring--row, :scope > .rdsh-ring-static").forEach((element) => element.remove());
      row.setAttribute("data-rdsh-ring-row", "");
    }

    function unringSessionRow(row) {
      row.querySelectorAll(":scope > .rdsh-ring--row, :scope > .rdsh-ring-static").forEach((element) => element.remove());
      row.removeAttribute("data-rdsh-ring-row");
      const title = row.querySelector("[data-rdsh-session-title]");
      if (title !== null) unringSessionTitle(title);
    }

    const SESSION_FRAME_KEY = "rdsh-mobile-ux:session-frames";
    const FRAME_COLORS = [
      { id: "blue", label: "ブルー", value: "#7aaaff" },
      { id: "green", label: "グリーン", value: "#5bd6a5" },
      { id: "amber", label: "アンバー", value: "#ffd166" },
      { id: "red", label: "レッド", value: "#ff6b6b" },
      { id: "purple", label: "パープル", value: "#b48cff" },
      { id: "pink", label: "ピンク", value: "#ff8fc7" },
    ];
    function readSessionFrames() {
      try {
        const value = JSON.parse(localStorage.getItem(SESSION_FRAME_KEY) || "{}");
        return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
      } catch {
        return {};
      }
    }
    let sessionFrames = readSessionFrames();
    function sessionFrameOf(row) {
      const key = row.getAttribute("data-row-key") || "";
      const id = key.startsWith("session:") ? key.slice("session:".length) : "";
      const value = id === "" ? undefined : sessionFrames[id];
      return typeof value === "string" && value !== "" ? value : null;
    }
    function applySessionFrame(row) {
      const color = sessionFrameOf(row);
      if (color === null) {
        row.removeAttribute("data-rdsh-session-frame");
        row.style.removeProperty("--rdsh-session-frame");
      } else {
        row.setAttribute("data-rdsh-session-frame", "");
        row.style.setProperty("--rdsh-session-frame", color);
      }
    }
    function saveSessionFrame(sessionId, color) {
      if (color === null) delete sessionFrames[sessionId];
      else sessionFrames[sessionId] = color;
      try { localStorage.setItem(SESSION_FRAME_KEY, JSON.stringify(sessionFrames)); } catch { /* private mode */ }
      scheduleDecorate();
    }

    function decorateSessionRows() {
      for (const row of document.querySelectorAll('[data-row-key^="session:"]')) {
        row.setAttribute("data-rdsh-session", "");
        const children = [...row.children];
        const status = children.find((child) => classToken(child, /_slot$/));
        const title = children.find((child) => classToken(child, /_title$/));
        if (status) {
          status.setAttribute("data-rdsh-status", "");
          // Idle rows keep an empty 16px status slot; on a phone that width
          // belongs to the title.
          if (status.children.length === 0 && (status.textContent || "").trim() === "") status.setAttribute("data-rdsh-status-empty", "");
          else status.removeAttribute("data-rdsh-status-empty");
        }
        if (title) title.setAttribute("data-rdsh-session-title", "");
        applySessionFrame(row);
        const running = row.querySelector('svg[data-state="ongoing"]') !== null;
        if (running) row.setAttribute("data-rdsh-running", "");
        else row.removeAttribute("data-rdsh-running");
        // Only a running session sweeps. An open but idle session is marked
        // with the static frame below, so "open" never looks like "working".
        const selected = row.getAttribute("aria-selected") === "true";
        if (ANIMATION === "outline" && running) ringSessionRow(row);
        else unringSessionRow(row);
        row.toggleAttribute("data-rdsh-open-row", selected);
        // The row actions carry the "..." menu plus archive/pin shortcuts. On a
        // phone only the menu earns its width; the shortcuts stay in the menu.
        const actions = children.find((child) => classToken(child, /_rowActions$/));
        if (actions) {
          for (const button of actions.querySelectorAll("button")) {
            if (/^Session actions/i.test(button.getAttribute("aria-label") || "")) button.removeAttribute("data-rdsh-row-minor");
            else button.setAttribute("data-rdsh-row-minor", "");
          }
        }
      }
    }

    function decorateEditCards() {
      for (const element of document.querySelectorAll("[data-rdsh-edit-card]")) element.removeAttribute("data-rdsh-edit-card");
      for (const element of document.querySelectorAll("[data-rdsh-edit-header], [data-rdsh-edit-row]")) {
        element.removeAttribute("data-rdsh-edit-header");
        element.removeAttribute("data-rdsh-edit-row");
      }
      for (const element of document.querySelectorAll("span, div")) {
        if (element.children.length !== 0) continue;
        if (!/^Edited \d+ files?$/.test((element.textContent || "").trim())) continue;
        const card = element.closest('[class*="_card"]');
        if (card === null) continue;
        card.setAttribute("data-rdsh-edit-card", "");
        const header = card.querySelector("button");
        if (header !== null) header.setAttribute("data-rdsh-edit-header", "");
        for (const row of card.querySelectorAll("li > button, button")) {
          if (row !== header) row.setAttribute("data-rdsh-edit-row", "");
        }
        break;
      }
    }

    let rightPanelNode = null;
    let rightPanelWatch = null;
    let rightPanelIO = null;

    function syncRightPanelOpen() {
      const panel = rightPanelNode;
      const open = panel !== null && panel.isConnected
        && getComputedStyle(panel).visibility !== "hidden"
        && panel.getBoundingClientRect().width > 0;
      document.documentElement.toggleAttribute("data-rdsh-rightpanel-open", open);
    }

    function watchRightPanel(panel) {
      if (rightPanelNode !== panel) {
        rightPanelWatch?.disconnect();
        rightPanelIO?.disconnect();
        rightPanelNode = panel;
        rightPanelWatch = new MutationObserver(syncRightPanelOpen);
        rightPanelWatch.observe(panel, { attributes: true, attributeFilter: ["class", "style"] });
        rightPanelIO = new IntersectionObserver(syncRightPanelOpen, { threshold: 0.25 });
        rightPanelIO.observe(panel);
      }
      syncRightPanelOpen();
    }

    /**
     * Tag the scroller that owns a code preview.
     *
     * The viewer scrolls in both axes by default; the lock in the stylesheet
     * keys off this attribute so a long line cannot be panned sideways.
     */
    function decorateCodePreview() {
      for (const pre of document.querySelectorAll("[data-rdsh-rightpanel] [data-textpreview-body] pre:not([data-rdsh-code-pre])")) {
        pre.setAttribute("data-rdsh-code-pre", "");
        let node = pre.parentElement;
        while (node !== null && node !== document.body) {
          const overflowX = getComputedStyle(node).overflowX;
          if (overflowX === "auto" || overflowX === "scroll") {
            node.setAttribute("data-rdsh-code-scroll", "");
            break;
          }
          node = node.parentElement;
        }
      }
    }

    function decorateRightPanel() {
      const collapse = document.querySelector('[aria-label="Collapse right sidebar"]');
      if (collapse === null) return;
      // The panel is the nearest ancestor that already spans the phone (the
      // fullscreen layer), not a hash-named class that changes per release.
      let node = collapse.parentElement;
      while (node !== null && node !== document.body) {
        const rect = node.getBoundingClientRect();
        if (rect.width >= window.innerWidth * 0.85 && rect.height >= window.innerHeight * 0.5) {
          node.setAttribute("data-rdsh-rightpanel", "");
          watchRightPanel(node);
          return;
        }
        node = node.parentElement;
      }
    }

    let contextProbeBusy = false;
    let contextProbe = { percent: null, text: "", at: 0 };

    function contextFiguresText() {
      const panel = document.querySelector('[role="dialog"][class*="_panel"]');
      const figures = panel === null ? null : panel.querySelector('[class*="_figures"]');
      return figures === null ? "" : (figures.textContent || "");
    }

    function parseContextFigures(text) {
      const match = text.match(/(~?[\d.]+[KMB]?)\s*\/\s*(~?[\d.]+[KMB]?)/i);
      return match === null ? "" : `${match[1]}/${match[2]}`;
    }

    function contextUsedMax(button, percent) {
      const now = Date.now();
      // If the user has the panel open, read it without toggling anything.
      if (button.getAttribute("aria-expanded") === "true") {
        const text = parseContextFigures(contextFiguresText());
        if (text !== "") contextProbe = { percent, text, at: now };
        return text;
      }
      if (contextProbe.percent === percent && now - contextProbe.at < 5000) return contextProbe.text;
      if (contextProbeBusy) return contextProbe.percent === percent ? contextProbe.text : "";
      contextProbeBusy = true;
      document.documentElement.setAttribute("data-rdsh-context-probe", "");
      button.click();
      setTimeout(() => {
        const text = parseContextFigures(contextFiguresText());
        if (button.getAttribute("aria-expanded") === "true") button.click();
        contextProbe = { percent, text, at: Date.now() };
        contextProbeBusy = false;
        document.documentElement.removeAttribute("data-rdsh-context-probe");
        scheduleDecorate();
      }, 80);
      return contextProbe.percent === percent ? contextProbe.text : "";
    }

    let settingsArrows = null;
    let settingsTabResetPending = false;

    /** Reset the options scroller only after the new tab's section has been
     *  committed. Resetting on the click scrolls the old section first, which
     *  is the visible "flick" on iOS. */
    function observeSettingsOptions(modal) {
      const options = modal.querySelector('[class*="VOzbGW_options"]');
      if (options === null || options.hasAttribute("data-rdsh-options-observer")) return;
      options.setAttribute("data-rdsh-options-observer", "");
      const observer = new MutationObserver(() => {
        if (!settingsTabResetPending) return;
        settingsTabResetPending = false;
        if (options.scrollTop !== 0) options.scrollTop = 0;
      });
      observer.observe(options, { childList: true, subtree: true });
    }

    function settingsNavList() {
      const modal = document.querySelector('[data-shortcut-modal="settings"]');
      if (modal === null) return null;
      const nav = modal.querySelector("nav");
      const list = nav === null ? null : nav.querySelector('[class*="navList"]');
      return list === null || nav === null ? null : { modal, nav, list };
    }

    function positionSettingsArrows() {
      if (settingsArrows === null) return;
      const found = settingsNavList();
      if (found === null) {
        settingsArrows.left.hidden = true;
        settingsArrows.right.hidden = true;
        return;
      }
      const { list } = found;
      settingsArrows.list = list;
      const rect = list.getBoundingClientRect();
      const firstTab = list.querySelector("button");
      const tabRect = firstTab === null ? rect : firstTab.getBoundingClientRect();
      const top = `${Math.round(tabRect.top + (tabRect.height - 30) / 2)}px`;
      settingsArrows.left.style.left = `${Math.round(rect.left + 2)}px`;
      settingsArrows.left.style.top = top;
      settingsArrows.right.style.left = `${Math.round(rect.right - 32)}px`;
      settingsArrows.right.style.top = top;
      const max = Math.max(0, list.scrollWidth - list.clientWidth);
      const canLeft = list.scrollLeft > 2;
      const canRight = list.scrollLeft < max - 2;
      settingsArrows.left.hidden = !canLeft;
      settingsArrows.right.hidden = !canRight;
      list.toggleAttribute("data-rdsh-fade-left", canLeft);
      list.toggleAttribute("data-rdsh-fade-right", canRight);
    }

    function installSettingsNavArrows() {
      if (!narrow()) {
        if (settingsArrows !== null) {
          settingsArrows.left.hidden = true;
          settingsArrows.right.hidden = true;
        }
        return;
      }
      const found = settingsNavList();
      if (found === null) {
        if (settingsArrows !== null) {
          settingsArrows.left.hidden = true;
          settingsArrows.right.hidden = true;
        }
        return;
      }
      if (settingsArrows === null) {
        const make = (side) => {
          const button = document.createElement("button");
          button.type = "button";
          button.setAttribute("data-rdsh-settings-nav-arrow", side);
          button.setAttribute("aria-label", side === "left" ? "設定タブを左へスクロール" : "設定タブを右へスクロール");
          button.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${side === "left" ? "M10 3L5 8l5 5" : "M6 3l5 5-5 5"}"/></svg>`;
          button.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const list = settingsArrows === null ? null : settingsArrows.list;
            if (list === null) return;
            const amount = Math.max(140, list.clientWidth * 0.7);
            list.scrollBy({ left: side === "left" ? -amount : amount, behavior: "smooth" });
          });
          document.body.append(button);
          return button;
        };
        settingsArrows = { left: make("left"), right: make("right"), list: found.list, modal: found.modal };
      }
      const { list, modal } = found;
      if (settingsArrows.list !== list) {
        settingsArrows.list = list;
        settingsArrows.modal = modal;
      }
      if (!list.hasAttribute("data-rdsh-nav-scroll")) {
        list.setAttribute("data-rdsh-nav-scroll", "");
        list.addEventListener("scroll", positionSettingsArrows, { passive: true });
      }
      if (!list.hasAttribute("data-rdsh-nav-tabclick")) {
        list.setAttribute("data-rdsh-nav-tabclick", "");
        list.addEventListener("click", (event) => {
          if (event.target.closest("[data-rdsh-settings-nav-arrow]") !== null) return;
          if (event.target.closest("button") === null) return;
          settingsTabResetPending = true;
        }, true);
      }
      observeSettingsOptions(modal);
      positionSettingsArrows();
    }

    function decorateStatsDock() {
      const dock = document.querySelector("[data-rdsh-composer-dock]");
      if (dock === null) return;
      const buttons = [...dock.querySelectorAll("button")].filter((button) => button.getAttribute("aria-label") !== null);
      const ariaOf = (button) => button.getAttribute("aria-label") || "";
      const activity = buttons.find((button) => /turns?|steps?|ターン|ステップ/i.test(ariaOf(button)));
      const usage = buttons.find((button) => /cache hit|キャッシュ/i.test(ariaOf(button)));
      const context = buttons.find((button) => /context|コンテキスト/i.test(ariaOf(button)));

      const set = (button, text) => {
        if (button === undefined) return;
        if (text === "") button.removeAttribute("data-rdsh-stat-text");
        else if (button.getAttribute("data-rdsh-stat-text") !== text) button.setAttribute("data-rdsh-stat-text", text);
      };

      if (activity !== undefined) {
        const aria = ariaOf(activity);
        const numbers = aria.match(/\d[\d,.]*(?:\s*[KMB])?/gi) || [];
        const turns = numbers[0];
        const tok = numbers.length > 1 ? numbers[numbers.length - 1] : undefined;
        set(activity, turns === undefined
          ? ""
          : `${turns} turn${turns === "1" ? "" : "s"}${tok === undefined ? "" : ` · ${tok} tok/s`}`);
      }
      if (usage !== undefined) {
        const percents = [...ariaOf(usage).matchAll(/(\d+)%/g)];
        const hit = percents.length > 0 ? percents[percents.length - 1][1] : undefined;
        set(usage, hit === undefined ? "" : `Cache hit ${hit}%`);
      }
      if (context !== undefined) {
        const percent = ariaOf(context).match(/(\d+)%/);
        const usedMax = percent === null ? "" : contextUsedMax(context, percent[1]);
        set(context, percent === null ? "" : `${percent[1]}%${usedMax === "" ? "" : ` · ${usedMax}`}`);
      }
    }

    function decorateModelSearch() {
      if (!narrow()) return;
      const menu = document.querySelector('[class*="_7KE1Ra_menu"]');
      if (menu === null) return;
      const input = menu.querySelector("input");
      if (input === null) return;
      if (!input.hasAttribute("data-rdsh-model-search")) {
        input.setAttribute("data-rdsh-model-search", "");
        const row = input.closest('[class*="_7KE1Ra_searchRow"]') ?? input.parentElement;
        if (row !== null) {
          row.setAttribute("data-rdsh-model-search-row", "");
          // The picker focuses this field by itself when it opens the model
          // pane. Disabled inputs ignore .focus(), so opening the picker no
          // longer pulls focus (or the keyboard) into the search.
          row.addEventListener("pointerdown", () => {
            input.disabled = false;
            requestAnimationFrame(() => input.focus({ preventScroll: true }));
          }, true);
        }
      }
      if (!input.disabled) input.disabled = true;
      if (document.activeElement === input) input.blur();
    }

    function decorateTodoPanel() {
      if (!narrow()) return;
      const panel = document.querySelector('[data-testid="todo-panel"]');
      if (panel === null) return;
      for (const item of panel.querySelectorAll("li")) {
        const content = item.querySelector('[class*="_content"]');
        if (content === null) continue;
        const text = (content.textContent || "").trim();
        if (text === "") continue;
        item.setAttribute("data-rdsh-todo-item", "");
        item.setAttribute("data-rdsh-todo-text", text);
        const status = item.querySelector('[role="img"][aria-label]');
        if (status !== null) item.setAttribute("data-rdsh-todo-status", status.getAttribute("aria-label") || "");
        item.setAttribute("role", "button");
        item.setAttribute("tabindex", "0");
        item.setAttribute("title", text);
      }
    }

    function decorateGoalBar() {
      if (!narrow()) return;
      const bar = document.querySelector("[data-goal-bar]");
      if (bar === null) return;
      const objective = bar.querySelector('[class*="_objective"]');
      if (objective !== null) {
        const text = (objective.textContent || "").trim();
        if (text !== "") {
          objective.setAttribute("data-rdsh-goal-objective", "");
          objective.setAttribute("data-rdsh-goal-text", text);
          objective.setAttribute("role", "button");
          objective.setAttribute("tabindex", "0");
          objective.setAttribute("title", text);
        }
      }
      const actions = bar.querySelector('[class*="_actions"]');
      if (actions !== null) actions.setAttribute("data-rdsh-goal-actions", "");
      if (bar.querySelector('[class*="_editBar"]') !== null) bar.setAttribute("data-rdsh-goal-editing", "");
      else bar.removeAttribute("data-rdsh-goal-editing");
    }

    /** Labels a session shows before it has been named. */
    const UNTITLED = /^(?:new session|new chat|untitled|新しいセッション|新しいチャット|無題|未命名|新会话)$/i;
    /** Last title seen per target, so only the first naming animates. */
    const titleSeen = new Map();
    /** How many passes each target has played; a session is named twice. */
    const titlePasses = new Map();
    /** Passes allowed per session: the initial label, then the model's name. */
    const TITLE_PASSES = 2;
    /** When each target was last seen working, to recognise a generated name. */
    const titleWorkingAt = new Map();
    /** How long after a turn a generated name still counts as "just named". */
    const NAME_GRACE_MS = 45000;

    function untitled(text) {
      const value = (text || "").trim();
      return value === "" || UNTITLED.test(value);
    }

    /** Per-character delay while typing; punctuation and spaces pause longer. */
    const TYPE_MS = 44;
    const TYPE_PAUSE_MS = 130;
    /** Erasing is quicker than typing, the way a held backspace reads. */
    const ERASE_MS = 26;
    /** Beat between "empty" and the next name, so the erase is visible. */
    const RETYPE_GAP_MS = 240;

    /**
     * Write a session name over the real one, character by character.
     *
     * React owns the text node, so the real text is made transparent and a
     * positioned copy is animated on top: re-rendering mid-animation cannot
     * leave a half-written title behind, the accessible name never changes,
     * and the layer is removed when the last character lands.
     *
     * A session is named twice — an initial label, then the name the model
     * settles on — so the second pass erases the first one before typing, the
     * way a person would clear the line and start again.
     *
     * @param {Element} element - the title element React renders into.
     * @param {string} next - the name to end on.
     * @param {string} [previous] - the name to erase first.
     */
    /** The text React owns, ignoring the layer this module paints over it. */
    function sessionTitleText(element) {
      let out = "";
      for (const node of element.childNodes) {
        if (node.nodeType === 3) out += node.nodeValue || "";
        else if (node.nodeType === 1 && !node.hasAttribute("data-rdsh-typing-layer")) out += node.textContent || "";
      }
      return out.trim();
    }

    function animateSessionTitle(element, next, previous) {
      if (element.hasAttribute("data-rdsh-typing")) return null;
      element.setAttribute("data-rdsh-typing", "");
      const layer = document.createElement("span");
      layer.setAttribute("data-rdsh-typing-layer", "");
      layer.setAttribute("aria-hidden", "true");
      const caret = document.createElement("span");
      caret.setAttribute("data-rdsh-typing-caret", "");
      let timer = 0;
      let shown = "";
      const stop = () => {
        clearTimeout(timer);
        element.removeAttribute("data-rdsh-typing");
        layer.remove();
      };
      const paint = (value) => {
        shown = value;
        layer.textContent = value;
        layer.append(caret);
      };
      const typeNext = () => {
        let index = 0;
        const step = () => {
          index += 1;
          paint(next.slice(0, index));
          if (index >= next.length) {
            timer = setTimeout(stop, 1100);
            return;
          }
          const char = next[index - 1] || "";
          timer = setTimeout(step, /[。、．，,.!?！？・:;：；\s]/.test(char) ? TYPE_PAUSE_MS : TYPE_MS);
        };
        step();
      };
      const eraseThenType = () => {
        let index = previous.length;
        const step = () => {
          index -= 1;
          paint(previous.slice(0, Math.max(0, index)));
          if (index > 0) {
            timer = setTimeout(step, ERASE_MS);
            return;
          }
          timer = setTimeout(typeNext, RETYPE_GAP_MS);
        };
        step();
      };
      element.append(layer);
      if (typeof previous === "string" && previous !== "") eraseThenType();
      else typeNext();
      // What is on screen right now, so a name that arrives mid-animation can
      // erase it instead of appearing under the running one. `reattach` exists
      // because React writes the title with `textContent`, which drops the
      // layer: without it the real text shows for a frame and the animation
      // starts over from the full previous name.
      return {
        visible: () => shown,
        cancel: stop,
        reattach: () => {
          if (layer.isConnected) return;
          element.append(layer);
          layer.textContent = shown;
          layer.append(caret);
        },
      };
    }

    /** MutationObserver + the elements it watches, so titles retype promptly. */
    let titleTextWatch = null;
    let titleTextTargets = [];
    /** The running animation per target, so a newer name can replace it. */
    const titleAnimations = new Map();

    /**
     * Observe the title elements themselves.
     *
     * The main observer watches childList and a few attributes only: adding
     * characterData there would fire on every streamed transcript token. The
     * generated name arrives as a text change, so it needs its own tiny
     * observer, re-targeted whenever the decorated set changes.
     */
    function watchTitleText(elements) {
      const unchanged = elements.length === titleTextTargets.length
        && elements.every((element, index) => element === titleTextTargets[index]);
      if (unchanged) return;
      if (titleTextWatch === null) titleTextWatch = new MutationObserver(() => scheduleDecorate());
      titleTextWatch.disconnect();
      for (const element of elements) titleTextWatch.observe(element, { childList: true, characterData: true, subtree: true });
      titleTextTargets = elements;
    }

    /**
     * Mark the header title while the session it names is working.
     *
     * The sidebar row already animates, but on a phone the sidebar is usually
     * closed, so the header is the only place that can say "this session is
     * running". The running set comes from the session store: the DOM only
     * carries the id.
     */
    function decorateHeaderTitle() {
      if (!narrow()) return;
      const crumb = document.querySelector('[data-rdsh-crumbs] [class*="_crumbCurrent"]');
      if (crumb === null) return;
      crumb.setAttribute("data-rdsh-header-title", "");
      const host = document.querySelector("[data-conversation-session]");
      const id = host === null ? "" : (host.getAttribute("data-conversation-session") || "");
      const running = id !== "" && globalThis.__RDSH_MOBILE_UX_RUNNING__ instanceof Set
        && globalThis.__RDSH_MOBILE_UX_RUNNING__.has(id);
      crumb.toggleAttribute("data-rdsh-header-running", running);
    }

    function decorateSessionTitleTyping() {
      if (!narrow()) return;
      const running = globalThis.__RDSH_MOBILE_UX_RUNNING__ instanceof Set
        ? globalThis.__RDSH_MOBILE_UX_RUNNING__
        : new Set();
      const targets = [];
      const crumb = document.querySelector('[data-rdsh-crumbs] [class*="_crumbCurrent"]');
      const header = document.querySelector("[data-conversation-session]");
      const headerId = header === null ? "" : (header.getAttribute("data-conversation-session") || "");
      if (crumb !== null && headerId !== "") targets.push({ key: `head:${headerId}`, id: headerId, element: crumb, running: running.has(headerId) });
      for (const title of document.querySelectorAll("[data-rdsh-session-title]")) {
        const row = title.closest('[data-row-key^="session:"]');
        if (row === null) continue;
        const key = row.getAttribute("data-row-key") || "";
        const id = key.startsWith("session:") ? key.slice("session:".length) : key;
        targets.push({ key: `row:${key}`, id, element: title, running: row.hasAttribute("data-rdsh-running") });
      }
      watchTitleText(targets.map((entry) => entry.element));
      const now = Date.now();
      for (const { key, id, element, running: working } of targets) {
        if (element.hasAttribute("data-rdsh-typing")) {
          const active = titleAnimations.get(key);
          if (active === undefined) element.removeAttribute("data-rdsh-typing");
          else if (element.querySelector("[data-rdsh-typing-layer]") === null) active.reattach();
        }
        if (working) titleWorkingAt.set(key, now);
        // Read React's text, not the layer, so a name landing mid-animation is
        // still seen as a change: the label the model replaces arrives while the
        // fallback is usually still being typed.
        const text = sessionTitleText(element);
        const previous = titleSeen.get(key);
        if (text !== "") titleSeen.set(key, text);
        else if (previous === undefined) titleSeen.set(key, "");
        if (text === "") continue;
        // First sight is the baseline: a page reload must not retype history.
        if (previous === undefined || previous === text) continue;
        const passes = titlePasses.get(key) ?? 0;
        if (passes >= TITLE_PASSES) continue;
        // An unnamed session shows the working directory or its raw id in the
        // header, so "untitled" alone misses the case this animation is for.
        // A name is generated while the session works (or right after), and a
        // manual rename later does not qualify.
        const generated = working
          || untitled(previous)
          || previous === id
          || now - (titleWorkingAt.get(key) ?? 0) < NAME_GRACE_MS;
        // The first pass is the initial label. The second is the name the model
        // settles on, which arrives on its own schedule, so it is allowed
        // without the running window and erases the label first.
        if (passes === 0 && !generated) continue;
        titlePasses.set(key, passes + 1);
        // Why the running animation is cancelled rather than awaited: waiting
        // would reveal the new name the moment the layer is removed, and only
        // then start erasing it — a pop followed by a pointless animation.
        const active = titleAnimations.get(key);
        const eraseFrom = active === undefined ? (passes === 0 ? "" : previous) : active.visible();
        active?.cancel();
        const controller = animateSessionTitle(element, text, eraseFrom);
        if (controller === null) titleAnimations.delete(key);
        else titleAnimations.set(key, controller);
      }
    }

    /** Upward travel that counts as "flick the banner away". */
    const TOAST_SWIPE_PX = 32;

    /**
     * Let a notice be swiped up, the way an iOS banner is dismissed.
     *
     * The component owns its own lifetime and renders through a portal, so the
     * gesture only moves the element out of sight; its timer retires it as
     * usual. Nothing here touches React's tree.
     */
    function decorateToasts() {
      if (!narrow()) return;
      for (const toast of document.querySelectorAll('body > [role="alert"]')) {
        if (toast.hasAttribute("data-rdsh-toast")) continue;
        toast.setAttribute("data-rdsh-toast", "");
        let startX = 0;
        let startY = 0;
        let offset = 0;
        let tracking = false;
        const release = () => {
          tracking = false;
          offset = 0;
          toast.style.removeProperty("transform");
          toast.style.removeProperty("opacity");
        };
        toast.addEventListener("pointerdown", (event) => {
          if (event.pointerType === "mouse") return;
          tracking = true;
          startX = event.clientX;
          startY = event.clientY;
          offset = 0;
        });
        toast.addEventListener("pointermove", (event) => {
          if (!tracking) return;
          const dy = event.clientY - startY;
          const dx = Math.abs(event.clientX - startX);
          // Upwards only, and only while the gesture is clearly vertical.
          if (dy > 0 || Math.abs(dy) < dx) {
            offset = 0;
            return;
          }
          offset = dy;
          toast.style.transform = `translate(-50%, ${Math.round(dy)}px)`;
          toast.style.opacity = String(Math.max(0.15, 1 + dy / 140));
        });
        const finish = () => {
          if (!tracking) return;
          if (offset <= -TOAST_SWIPE_PX) {
            toast.setAttribute("data-rdsh-toast-dismissed", "");
            tracking = false;
            return;
          }
          release();
        };
        toast.addEventListener("pointerup", finish);
        toast.addEventListener("pointercancel", finish);
      }
    }

    function decorateQuestionCards() {
      for (const card of document.querySelectorAll('[class*="_card"]')) {
        if (card.querySelector('[class*="_options"], [class*="_strip"]') === null) continue;
        card.setAttribute("data-rdsh-question-card", "");
        const frame = card.closest('[class*="_frame"]');
        if (frame !== null) frame.setAttribute("data-rdsh-question-frame", "");
      }
    }

    function enforceNoZoomViewport() {
      let meta = document.querySelector('meta[name="viewport"]');
      if (meta === null) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "viewport");
        document.head.append(meta);
      }
      const content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
      if (meta.getAttribute("content") !== content) meta.setAttribute("content", content);
    }

    function decorateMoreTrigger() {
      const trigger = document.querySelector('[aria-label="Account menu"]');
      if (trigger === null) return;
      trigger.setAttribute("data-rdsh-more", "");
      // The visible control becomes a gear only on phones; keep the desktop
      // accessible name untouched.
      if (narrow()) {
        if (trigger.getAttribute("aria-label") !== "設定") trigger.setAttribute("aria-label", "設定");
      } else if (trigger.getAttribute("aria-label") === "設定") {
        trigger.setAttribute("aria-label", "Account menu");
      }
    }

    const ACTIVITY_ICONS = {
      shell: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.7" y="2.7" width="12.6" height="10.6" rx="2"/><path d="M4.4 6.2l2.3 1.8-2.3 1.8"/><path d="M8.4 10.2h3.3"/></svg>',
      subagent: '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="4.6" r="2.1"/><path d="M3.6 13.4c0-2.6 2-4.4 4.4-4.4s4.4 1.8 4.4 4.4"/><path d="M11.6 3.2a2.2 2.2 0 0 1 0 3.9"/></svg>',
    };

    /** Header shell/subagent chips become icon-only live indicators. */
    function decorateHeaderActivityChips() {
      if (!narrow()) return;
      // Drop the old "settings gear" conversion; settings now lives in the
      // sidebar panel list below Plugins / Automation tasks.
      for (const old of document.querySelectorAll("[data-rdsh-more]")) {
        old.removeAttribute("data-rdsh-more");
        if (old.getAttribute("aria-label") === "設定") old.setAttribute("aria-label", "Account menu");
      }
      const buttons = [...document.querySelectorAll("header button[aria-label]")]
        .filter((button) => /subagents?|background jobs?|shell command/i.test(button.getAttribute("aria-label") || ""));
      if (buttons.length === 0) return;
      const runningSubagents = Number(document.documentElement.getAttribute("data-rdsh-running-subagents") || "0") || 0;
      const sourceSpinner = [...document.querySelectorAll("header [class*='_spinner_']")]
        .find((spinner) => !spinner.hasAttribute("data-rdsh-activity-generated")) ?? null;
      for (const button of buttons) {
        const label = button.getAttribute("aria-label") || "";
        const kind = /subagent/i.test(label) ? "subagent" : "shell";
        button.setAttribute("data-rdsh-activity-chip", kind);
        const ownNative = [...button.querySelectorAll("svg[class*='_spinner_']")]
          .find((spinner) => !spinner.hasAttribute("data-rdsh-activity-generated")) ?? null;
        const active = kind === "subagent" ? runningSubagents > 0 : ownNative !== null;
        let spinner = button.querySelector("[data-rdsh-activity-spinner]");
        if (!active) {
          if (spinner !== null && spinner.hasAttribute("data-rdsh-activity-generated")) spinner.remove();
          spinner = null;
        }
        if (active && spinner === null) {
          if (ownNative !== null) {
            spinner = ownNative;
          } else if (sourceSpinner !== null && !button.contains(sourceSpinner)) {
            spinner = sourceSpinner.cloneNode(true);
            spinner.classList.remove("QsffPG_triggerDot");
            spinner.setAttribute("data-rdsh-activity-generated", "");
          } else {
            spinner = document.createElement("span");
            spinner.className = "rdsh-activity-ring";
            spinner.setAttribute("data-rdsh-activity-generated", "");
          }
          spinner.setAttribute("data-rdsh-activity-spinner", "");
          button.prepend(spinner);
        }
        if (button.querySelector("[data-rdsh-activity-icon]") === null) {
          const icon = document.createElement("span");
          icon.setAttribute("data-rdsh-activity-icon", "");
          icon.setAttribute("aria-hidden", "true");
          icon.innerHTML = ACTIVITY_ICONS[kind];
          button.append(icon);
        }
      }
      // The first chip can be decorated before the other chip has rendered its
      // native spinner. Upgrade our fallback once the native one exists.
      const native = document.querySelector("header svg[class*='_spinner_']:not([data-rdsh-activity-generated])");
      if (native !== null) {
        for (const fallback of document.querySelectorAll("header [data-rdsh-activity-spinner].rdsh-activity-ring")) {
          const replacement = native.cloneNode(true);
          replacement.classList.remove("QsffPG_triggerDot");
          replacement.setAttribute("data-rdsh-activity-spinner", "");
          replacement.setAttribute("data-rdsh-activity-generated", "");
          fallback.replaceWith(replacement);
        }
      }
    }

    /** Add a Settings row to the sidebar panel list, matching Plugins. */
    function openSettingsViaAccountMenu() {
      const trigger = document.querySelector('button[aria-label="Account menu"]')
        ?? document.querySelector('button[aria-label="設定"]');
      if (trigger === null) return;
      settingsPendingUntil = Date.now() + 2000;
      trigger.click();
      setTimeout(maybeOpenSettings, 30);
      setTimeout(maybeOpenSettings, 120);
      setTimeout(maybeOpenSettings, 300);
    }

    function decorateSidebarSettingsRow() {
      if (!narrow()) return;
      const nav = document.querySelector("nav.hHd-Xa_panelList");
      if (nav === null) return;
      // The account "More" row is not used on the phone.
      const account = document.querySelector('button[aria-label="Account menu"]')
        ?? [...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "More");
      if (account !== null) {
        const moreRow = account.closest('[class*="yHnPSG_anchor"]') ?? account.parentElement;
        moreRow?.setAttribute("data-rdsh-more-row", "");
      }
      const auto = nav.querySelector('button[aria-label="Automation tasks"]');
      let row = nav.querySelector("[data-rdsh-settings-row]");
      if (row === null) {
        row = document.createElement("button");
        row.type = "button";
        row.className = "hHd-Xa_panelRow";
        row.setAttribute("aria-label", "Settings");
        row.setAttribute("data-rdsh-settings-row", "");
        row.innerHTML = '<span class="hHd-Xa_panelGlyph" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.1"/><path d="M6.9 1.9h2.2l.35 1.5 1.28.74 1.45-.5 1.1 1.9-1.05 1.1.1 1.48 1.05 1.1-1.1 1.9-1.45-.5-1.28.74-.35 1.5H6.9l-.35-1.5-1.28-.74-1.45.5-1.1-1.9 1.05-1.1-.1-1.48-1.05-1.1 1.1-1.9 1.45.5 1.28-.74z"/></svg></span><span class="hHd-Xa_panelTitle hHd-Xa_wide">Settings</span>';
        row.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openSettingsViaAccountMenu();
        });
      }
      const anchor = auto ?? nav.querySelector('button[aria-label="Plugins"]');
      if (anchor !== null && anchor.nextElementSibling !== row) anchor.after(row);
      else if (nav.lastElementChild !== row) nav.append(row);
    }

    const ADD_LABEL = "画像やファイルを追加";
    const ADD_STOCK_LABEL = "Add files or run commands";
    const ADD_SELECTOR = `[data-rdsh-add], [aria-label="${ADD_LABEL}"], [aria-label="${ADD_STOCK_LABEL}"]`;

    function addButton() {
      // Structure first: the composer's only listbox trigger is the "+" button.
      // Labels are localised, so they are only the fallback.
      const composer = document.querySelector("[data-composer-input]");
      const card = composer === null ? null : composer.closest('[class*="_card"]');
      const structural = card === null ? null : card.querySelector('button[aria-haspopup="listbox"]');
      return structural || document.querySelector(ADD_SELECTOR);
    }

    function addButtonOf(target) {
      if (target === null || target === undefined || target.closest === undefined) return null;
      const button = target.closest("button");
      return button !== null && button === addButton() ? button : null;
    }

    function decorateComposer() {
      for (const model of document.querySelectorAll('button[aria-label^="Select model"]')) {
        model.setAttribute("data-rdsh-model-button", "");
      }
      const add = addButton();
      if (add === null) {
        document.documentElement.removeAttribute("data-rdsh-has-dock");
        return;
      }
      add.setAttribute("data-rdsh-add", "");
      if (narrow()) {
        if (add.getAttribute("aria-label") !== ADD_LABEL) add.setAttribute("aria-label", ADD_LABEL);
      } else if (add.getAttribute("aria-label") === ADD_LABEL) {
        add.setAttribute("aria-label", ADD_STOCK_LABEL);
      }
      const card = add.closest('[class*="_card"]');
      if (card === null || card.parentElement === null) {
        document.documentElement.removeAttribute("data-rdsh-has-dock");
        return;
      }
      card.parentElement.setAttribute("data-rdsh-composer-root", "");
      // The stats dock (turns / tok/s / cache hit / context %) is essential.
      // On a phone it moves out of the layout so the composer can sit as low
      // as possible, and fills the safe-area strip below the card instead of
      // leaving a blank band there.
      let hasDock = false;
      for (const sibling of card.parentElement.children) {
        if (sibling === card) continue;
        const stats = sibling.querySelector(
          'button[aria-label*="tok"], button[aria-label*="turns"], button[aria-label*="context"], button[aria-label*="ターン"], button[aria-label*="コンテキスト"]',
        );
        if (stats !== null) {
          sibling.setAttribute("data-rdsh-composer-dock", "");
          hasDock = true;
        } else {
          sibling.removeAttribute("data-rdsh-composer-dock");
        }
      }
      document.documentElement.toggleAttribute("data-rdsh-has-dock", hasDock);
    }

    function markScrollers() {
      if (!narrow()) return;
      for (const element of document.querySelectorAll("[data-rdsh-frame] div")) {
        if (element.hasAttribute("data-rdsh-scroll")) continue;
        if (element.scrollHeight <= element.clientHeight + 4) continue;
        const overflow = getComputedStyle(element).overflowY;
        if (overflow !== "auto" && overflow !== "scroll") continue;
        element.setAttribute("data-rdsh-scroll", "");
      }
    }

    let lastSlowAt = 0;

    function decorateFast() {
      const root = frame();
      if (root !== null) {
        root.setAttribute("data-rdsh-frame", "");
        // The app switches these columns to auto-placement while its sidebar is
        // open. Our drawer takes that column out of flow, so auto-placement
        // shifts everything one column left: the chat lands on the 0px column
        // and the empty right column fills the screen. Pin them instead.
        for (const child of root.children) {
          const cls = typeof child.className === "string" ? child.className : "";
          if (cls.includes("_centerCol")) child.setAttribute("data-rdsh-center-col", "");
          else if (cls.includes("_rightbarCol")) child.setAttribute("data-rdsh-rightbar-col", "");
        }
        const sidebar = document.querySelector('[data-slot="sidebar"]');
        if (sidebar && sidebar.parentElement) sidebar.parentElement.setAttribute("data-rdsh-sidebar", "");
        const open = !root.hasAttribute("data-sidebar-collapsed");
        if (open !== state.drawerOpen) emit({ drawerOpen: open });
        document.documentElement.setAttribute("data-rdsh-drawer", open ? "open" : "closed");
      }
      const header = document.querySelector("header[data-window-drag]");
      if (header !== null) header.setAttribute("data-rdsh-header", "");
      // Decorate the image lightbox on the same mutation that creates it. The
      // slow pass is throttled (900ms), which can leave a freshly opened
      // lightbox without the crop/safe-area hooks.
      decorateLightbox();
      decorateRightPanel();
      decorateCodePreview();
      decorateQuestionCards();
      decorateTodoPanel();
      decorateGoalBar();
      decorateHeaderTitle();
      decorateSessionTitleTyping();
      decorateToasts();
      decorateModelSearch();
      installSettingsNavArrows();
      decorateStatsDock();
      enforceNoZoomViewport();
      const crumbs = document.querySelector('nav[aria-label="Session hierarchy"]');
      if (crumbs !== null) crumbs.setAttribute("data-rdsh-crumbs", "");
      for (const slot of document.querySelectorAll('[data-slot="main.conversation"], [data-slot="conversation"]')) {
        slot.setAttribute("data-rdsh-conversation", "");
      }
      decorateSessionRows();
      decorateComposer();
      decorateHeaderActivityChips();
      decorateSidebarSettingsRow();
      // The right panel keeps its chrome mounted even while closed (it is
      // clipped by a zero-width column), so presence of its buttons says
      // nothing. The dock strip is the real signal: it sits on-screen only
      // while the panel is open.
      const hideListDisabled = hideDisabled();
      document.documentElement.toggleAttribute("data-rdsh-hide-settings", !hideListDisabled && narrow());
      applyHideList(hideListDisabled);
      maybeOpenSettings();
    }

    /**
     * Work that is too expensive for every mutation (style reads over the whole
     * transcript): keep it to about once a second.
     */
    function decorateTranscript() {
      const scroller = document.querySelector('[class*="scrollBody"]');
      if (scroller === null) return;
      for (const node of scroller.querySelectorAll('[class*="_scroll"], [class*="_column"]')) {
        const style = getComputedStyle(node);
        const left = parseFloat(style.paddingLeft) || 0;
        const right = parseFloat(style.paddingRight) || 0;
        if (left >= 24 && right >= 24 && node.getBoundingClientRect().width >= scroller.clientWidth * 0.8) {
          node.setAttribute("data-rdsh-transcript", "");
          const column = node.querySelector('[class*="_column"]');
          if (column !== null) column.setAttribute("data-rdsh-transcript-column", "");
          return;
        }
      }
    }

    function decorateUserBubbles() {
      for (const item of document.querySelectorAll('[data-chat-flow-kind="user"]')) {
        const stack = item.querySelector('[class*="userStack"]');
        if (stack !== null) stack.setAttribute("data-rdsh-user-stack", "");
        const bubble = item.querySelector('[class*="_bubble"]');
        if (bubble !== null) bubble.setAttribute("data-rdsh-user-bubble", "");
      }
    }

    function decorateSlow() {
      decorateEditCards();
      decorateRightPanel();
      decorateTranscript();
      decorateUserBubbles();
      markScrollers();
      ensureRightPanelFits();
    }

    function decorate() {
      decorateFast();
      const now = Date.now();
      if (now - lastSlowAt > 900) {
        lastSlowAt = now;
        decorateSlow();
      }
    }

    let scheduled = false;
    function scheduleDecorate() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        try {
          decorate();
        } catch (error) {
          console.error("[rdsh-mobile-ux] decorate failed", error);
        }
      });
    }

    // ---------------------------------------------------------------------
    // Drawer: floating button, backdrop, animation
    // ---------------------------------------------------------------------
    let fab = null;
    let backdrop = null;

    function toggleDrawer() {
      const button = document.querySelector('[aria-label="Open sidebar"], [aria-label="Collapse sidebar"]');
      if (button !== null) button.click();
    }

    function closeDrawer() {
      const frameElement = frame();
      if (frameElement !== null && !frameElement.hasAttribute("data-sidebar-collapsed")) {
        const collapse = document.querySelector('[aria-label="Collapse sidebar"]');
        if (collapse !== null) collapse.click();
      }
    }

    let currentSessionId = null;

    /** Tell the push host that the next turn belongs to this phone. */
    function markMobileSession() {
      if (!narrow() || currentSessionId === null) return;
      void fetch("/api/push/mobile-send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: currentSessionId }),
        keepalive: true,
      }).catch(() => {});
    }

    let notificationTotal = 0;

    function applyNotificationCount(count) {
      notificationTotal = Math.max(0, Math.floor(Number(count) || 0));
      if (fab === null) return;
      const badge = fab.querySelector(".rdsh-mux-fab-badge");
      if (badge !== null) {
        badge.textContent = notificationTotal === 0 ? "" : notificationTotal > 99 ? "99+" : String(notificationTotal);
        badge.toggleAttribute("data-visible", notificationTotal > 0);
      }
      fab.setAttribute("aria-label", notificationTotal > 0
        ? `セッション一覧を開く（未読・質問待ち ${notificationTotal}件）`
        : "セッション一覧を開く");
    }

    function countSessionStatuses(statuses, mainIds) {
      if (statuses === null || statuses === undefined || typeof statuses.entries !== "function") return 0;
      let count = 0;
      for (const [sessionId, status] of statuses.entries()) {
        if (mainIds !== null && !mainIds.has(sessionId)) continue;
        const kind = status?.pendingInteraction?.kind;
        const waiting = kind === "question" || kind === "approval" || kind === "plan-review";
        if (status?.completionUnread === true || waiting) count += 1;
      }
      return count;
    }

    function NotificationWatcher(props) {
      const useSessionStatus = props.useSessionStatus;
      const useSessions = props.useSessions;
      const hasHook = typeof useSessionStatus === "function";
      const hasSessions = typeof useSessions === "function";
      const statuses = hasHook ? useSessionStatus((value) => value) : null;
      const sessions = hasSessions ? useSessions((value) => value) : null;
      useEffect(() => {
        const byId = sessions !== null && sessions !== undefined ? sessions.byId : null;
        const mainIds = byId !== null && byId !== undefined && typeof byId === "object"
          ? new Set(Object.entries(byId).filter(([, row]) => row !== null && row !== undefined && row.origin !== "subagent").map(([id]) => id))
          : null;
        const total = countSessionStatuses(statuses, null);
        const main = countSessionStatuses(statuses, mainIds);
        applyNotificationCount(main);
        // How many subagent sessions are actually running right now. The header
        // subagent chip also exists for finished subagents, so its icon must
        // not spin unless this is above zero.
        let runningSubagents = 0;
        const runningIds = new Set();
        if (byId !== null && byId !== undefined && typeof byId === "object" && statuses !== null && statuses !== undefined && typeof statuses.get === "function") {
          for (const [id, row] of Object.entries(byId)) {
            if (row === null || row === undefined || statuses.get(id)?.running !== true) continue;
            runningIds.add(id);
            if (row.origin === "subagent") runningSubagents += 1;
          }
        }
        globalThis.__RDSH_MOBILE_UX_RUNNING__ = runningIds;
        document.documentElement.setAttribute("data-rdsh-running-subagents", String(runningSubagents));
        document.documentElement.toggleAttribute("data-rdsh-badge-hook", hasHook);
        document.documentElement.toggleAttribute("data-rdsh-sessions-hook", hasSessions);
        globalThis.__RDSH_MOBILE_UX_BADGE__ = { total, main, subagents: Math.max(0, total - main), runningSubagents, mainIds: mainIds === null ? null : [...mainIds] };
        scheduleDecorate();
      }, [statuses, sessions, hasHook, hasSessions]);
      return null;
    }

    function installDrawer() {
      fab = document.createElement("button");
      fab.type = "button";
      fab.className = "rdsh-mux-fab";
      fab.setAttribute("aria-label", "セッション一覧を開く");
      fab.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 6.5h16M4 12h16M4 17.5h16"/></svg><span class="rdsh-mux-fab-badge" aria-hidden="true"></span>';
      fab.addEventListener("click", toggleDrawer);

      backdrop = document.createElement("div");
      backdrop.className = "rdsh-mux-backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.addEventListener("click", closeDrawer);

      document.body.append(backdrop, fab);
    }

    // ---------------------------------------------------------------------
    // Attach sheet: on a phone the "+" only offers images and files
    // ---------------------------------------------------------------------
    let attachSheet = null;
    let attachBackdrop = null;
    let toastTimer = 0;

    function closeAttachSheet() {
      attachSheet?.remove();
      attachBackdrop?.remove();
      attachSheet = null;
      attachBackdrop = null;
    }

    function mobileToast(text) {
      let toast = document.querySelector(".rdsh-mux-toast");
      if (toast === null) {
        toast = document.createElement("div");
        toast.className = "rdsh-mux-toast";
        toast.setAttribute("role", "status");
        document.body.append(toast);
      }
      toast.textContent = text;
      toast.setAttribute("data-show", "");
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast.remove(), 2800);
    }

    function pickFiles(kind) {
      closeAttachSheet();
      const add = addButton();
      const card = add === null ? null : add.closest('[class*="_card"]');
      const input = (card === null ? null : card.querySelector('input[type="file"]'))
        || document.querySelector('input[type="file"]');
      if (input === null || input.disabled) {
        mobileToast("添付できるファイル入力がありません");
        return;
      }
      // iOS reads accept when the picker opens, so set it for this one gesture
      // and put the input back afterwards.
      const previous = input.getAttribute("accept");
      input.setAttribute("accept", kind === "image" ? "image/*" : "");
      let restored = false;
      const restore = () => {
        if (restored) return;
        restored = true;
        window.removeEventListener("focus", restore);
        if (previous === null) input.removeAttribute("accept");
        else input.setAttribute("accept", previous);
      };
      input.addEventListener("change", restore, { once: true });
      // The picker returns focus when it closes, including on cancel.
      window.addEventListener("focus", restore);
      setTimeout(restore, 60000);
      input.value = "";
      input.click();
    }

    function sheetIcon(kind) {
      if (kind === "image") {
        return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="M4 17l5-4.5 4 3.5 3-2.5 4 3.5"/></svg>';
      }
      return '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3.5H7.5A2.5 2.5 0 0 0 5 6v12a2.5 2.5 0 0 0 2.5 2.5h9A2.5 2.5 0 0 0 19 18V8.5z"/><path d="M14 3.5V8.5H19"/></svg>';
    }

    function sheetRow(kind, label, hint, run) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rdsh-mux-sheet-row";
      button.innerHTML = `<span class="rdsh-mux-sheet-icon">${sheetIcon(kind)}</span><span class="rdsh-mux-sheet-label"></span><span class="rdsh-mux-sheet-hint"></span>`;
      button.querySelector(".rdsh-mux-sheet-label").textContent = label;
      button.querySelector(".rdsh-mux-sheet-hint").textContent = hint;
      button.addEventListener("click", run);
      return button;
    }

    function openAttachSheet() {
      if (attachSheet !== null) {
        closeAttachSheet();
        return;
      }
      // If the user was typing, put the keyboard away so the sheet is visible
      // and the composer is not focused behind it.
      const active = document.activeElement;
      if (active !== null && active !== undefined && typeof active.blur === "function"
        && typeof active.closest === "function" && active.closest("[data-composer-input]") !== null) {
        active.blur();
      }
      const backdrop = document.createElement("div");
      backdrop.className = "rdsh-mux-sheet-backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.addEventListener("click", closeAttachSheet);

      const sheet = document.createElement("div");
      sheet.className = "rdsh-mux-sheet";
      sheet.setAttribute("role", "dialog");
      sheet.setAttribute("aria-label", "画像またはファイルを追加");
      sheet.append(
        sheetRow("image", "画像を選ぶ", "写真ライブラリ", () => pickFiles("image")),
        sheetRow("file", "ファイルを選ぶ", "ファイルApp", () => pickFiles("file")),
      );
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.className = "rdsh-mux-sheet-cancel";
      cancel.textContent = "キャンセル";
      cancel.addEventListener("click", closeAttachSheet);
      sheet.append(cancel);

      document.body.append(backdrop, sheet);
      attachSheet = sheet;
      attachBackdrop = backdrop;
    }

    /** The composer focuses the editor on mousedown; that opens the keyboard. */
    function onMouseDownCapture(event) {
      if (!narrow()) return;
      if (addButtonOf(event.target) === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    // ---------------------------------------------------------------------
    // Scroll diagnostics (devtools): which element actually moves?
    // ---------------------------------------------------------------------
    const lastScrolls = [];

    function recordScroll(event) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const style = getComputedStyle(target);
      lastScrolls.push({
        at: Date.now(),
        tag: target.tagName,
        cls: String(target.className).slice(0, 120),
        id: target.id,
        scrollTop: Math.round(target.scrollTop),
        scrollHeight: target.scrollHeight,
        clientHeight: target.clientHeight,
        overflowY: style.overflowY,
      });
      if (lastScrolls.length > 12) lastScrolls.shift();
    }

    function scrollables() {
      const list = [];
      for (const element of document.querySelectorAll("*")) {
        if (element.scrollHeight <= element.clientHeight + 2) continue;
        const style = getComputedStyle(element);
        if (style.overflowY !== "auto" && style.overflowY !== "scroll") continue;
        list.push({
          tag: element.tagName,
          cls: String(element.className).slice(0, 120),
          id: element.id,
          scrollTop: Math.round(element.scrollTop),
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
          overflowY: style.overflowY,
          position: style.position,
        });
      }
      return list;
    }

    function scrollChain() {
      const list = [];
      let node = document.querySelector("[data-composer-input]") || document.querySelector('[class*="scrollBody"]');
      while (node !== null && node !== document.documentElement) {
        const style = getComputedStyle(node);
        if (node.scrollHeight > node.clientHeight + 2 || style.overflowY === "auto" || style.overflowY === "scroll") {
          list.push({
            tag: node.tagName,
            cls: String(node.className).slice(0, 120),
            scrollTop: Math.round(node.scrollTop),
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
            overflowY: style.overflowY,
          });
        }
        node = node.parentElement;
      }
      return list;
    }

    // ---------------------------------------------------------------------
    // Focus: opening a session must not steal the composer
    // ---------------------------------------------------------------------
    let allowFocusElement = null;
    let allowFocusUntil = 0;

    function textBoxOf(element) {
      if (!(element instanceof Element)) return null;
      const field = element.closest('input, textarea, [contenteditable="true"]');
      if (field === null) return null;
      if (field.tagName === "INPUT") {
        const type = (field.getAttribute("type") || "text").toLowerCase();
        if (["button", "submit", "reset", "checkbox", "radio", "range", "file", "color", "image", "hidden"].includes(type)) return null;
      }
      if (field.disabled === true || field.readOnly === true) return null;
      return field;
    }

    function onFocusPointer(event) {
      if (!narrow()) return;
      const field = textBoxOf(event.target);
      allowFocusElement = field;
      allowFocusUntil = field === null ? 0 : Date.now() + 1500;
    }

    // iOS Safari reports a null relatedTarget for focus moves that happen
    // inside a popover (notably the model picker focusing its search input).
    // The picker's root onBlur then closes the menu. Swallow that focusout so
    // React never sees it; outside taps still close through mousedown.
    function onModelFocusOut(event) {
      if (!narrow()) return;
      const target = event.target;
      if (target === null || target === undefined || target.closest === undefined) return;
      const root = target.closest('[class*="_7KE1Ra_root"]');
      const menu = document.querySelector('[class*="_7KE1Ra_menu"]');
      if (menu === null) return;
      if (root === null && !menu.contains(target)) return;
      const related = event.relatedTarget;
      if (related !== null && related !== undefined) {
        const inside = root?.contains(related) === true || menu.contains(related);
        if (!inside) return;
      }
      event.stopPropagation();
    }

    function onFocusInGuard(event) {
      if (!narrow()) return;
      const field = textBoxOf(event.target);
      if (field === null) return;
      // Popovers (the model picker's search, dialogs, etc.) focus their own
      // inputs programmatically. Blurring those closes the popover because the
      // menu's onBlur sees no related focus target.
      if (field.closest('[role="menu"], [role="dialog"], [role="listbox"], [class*="_7KE1Ra_menu"], .xterm, [class*="xterm"]') !== null) return;
      if (field === allowFocusElement && Date.now() <= allowFocusUntil) return;
      // Deferred: Safari/the app re-focuses synchronously from its onFocus
      // handler, so an immediate blur() recurses until the stack overflows.
      setTimeout(() => {
        if (document.activeElement === field) field.blur();
      }, 0);
    }

    function isComposer(element) {
      if (element === null || element === undefined) return false;
      return element.closest !== undefined && element.closest('[contenteditable="true"], textarea, [data-slot="chat.composer"], [class*="composer"]') !== null;
    }

    function blurComposer() {
      const active = document.activeElement;
      if (isComposer(active) && typeof active.blur === "function") active.blur();
    }

    // ---------------------------------------------------------------------
    // Session rows: tap opens, long press drags
    // ---------------------------------------------------------------------
    let tapCandidate = null;
    /** The row whose long press opened its menu, so the release click is eaten. */
    let menuOpenedUntil = 0;
    /** Long-press: held still this long and it opens the row menu. */
    const LONG_PRESS_MS = 480;
    /** Movement past this many pixels turns the gesture into a drag instead. */
    const LONG_PRESS_SLOP_PX = 12;

    /**
     * The row's own "..." trigger.
     *
     * Structure first: upstream class names are hashed, but the actions
     * container is the only one holding buttons inside a session row.
     */
    function sessionMenuButton(row) {
      const scoped = row.querySelector('[class*="_rowActions"] button');
      if (scoped !== null) return scoped;
      return [...row.querySelectorAll("button")].find((button) => /actions|操作/i.test(button.getAttribute("aria-label") || "")) ?? null;
    }

    function cancelLongPress() {
      if (longPressTimer !== 0) {
        clearTimeout(longPressTimer);
        longPressTimer = 0;
      }
    }

    function fireLongPress() {
      const candidate = tapCandidate;
      longPressTimer = 0;
      if (candidate === null || candidate.cancelled || candidate.fired) return;
      const button = sessionMenuButton(candidate.row);
      if (button === null) return;
      candidate.fired = true;
      candidate.cancelled = true;
      // A row that is neither selected nor hovered hides its actions, so the
      // trigger measures 0x0 and the menu portal opens at the top-left corner.
      // Reveal it for the click and keep it measurable while React positions
      // the portal; the app's own menu-open class takes over from there.
      // A long press must not leave the system's own affordances behind: iOS can
      // have started a selection and its callout before the timer fired.
      try {
        globalThis.getSelection?.()?.removeAllRanges();
      } catch { /* selection API unavailable */ }
      candidate.row.setAttribute("data-rdsh-row-menu", "");
      setTimeout(() => candidate.row.removeAttribute("data-rdsh-row-menu"), 1500);
      // Open the menu first: the arm window below also swallows clicks, and
      // arming it before this click would eat the very click that opens it.
      button.click();
      // The release still synthesises a click on the row, which would open the
      // session on top of the menu. Generous because a held finger can stay
      // down, and one-shot so the next real tap is unaffected.
      menuOpenedUntil = Date.now() + 4000;
    }

    let longPressTimer = 0;

    /** A row click that lands on a control inside the row is that control's. */
    function controlInsideRow(target) {
      const control = target.closest && target.closest("button, [role='button'], [role='menuitem'], input, textarea");
      return control !== null && control !== undefined && control.closest('[data-row-key^="session:"]') !== null;
    }

    function onPointerDown(event) {
      if (!narrow()) return;
      // xterm keeps its real input in a visually hidden textarea. Focusing it
      // from the tap/pointerdown gesture is what asks iOS for the keyboard.
      const terminal = event.target.closest && event.target.closest(".xterm, [class*='xterm']");
      if (terminal !== null) {
        const input = terminal.querySelector("textarea.xterm-helper-textarea, textarea");
        if (input !== null) input.focus({ preventScroll: true });
      }
      const send = event.target.closest && event.target.closest('[data-rdsh-composer-root] [class*="primary"]');
      if (send !== null && send !== undefined && send.disabled !== true && !/stop|停止/i.test(send.getAttribute("aria-label") || "")) {
        markMobileSession();
      }
      const row = event.target.closest && event.target.closest('[data-row-key^="session:"]');
      if (row === null || row === undefined) return;
      if (event.pointerType === "mouse") return;
      if (controlInsideRow(event.target)) return;
      tapCandidate = { row, at: Date.now(), x: event.clientX, y: event.clientY, cancelled: false, fired: false };
      // A held finger opens the menu; a moving one reorders, which is the
      // gesture the app already owns.
      cancelLongPress();
      longPressTimer = setTimeout(fireLongPress, LONG_PRESS_MS);
    }

    /** Movement cancels the long press and leaves the drag to the app. */
    function onPointerMove(event) {
      const candidate = tapCandidate;
      if (candidate === null || longPressTimer === 0) return;
      if (Math.abs(event.clientX - candidate.x) + Math.abs(event.clientY - candidate.y) > LONG_PRESS_SLOP_PX) cancelLongPress();
    }

    function onPointerUp(event) {
      cancelLongPress();
      const candidate = tapCandidate;
      if (candidate === null) return;
      tapCandidate = null;
      const moved = Math.abs(event.clientX - candidate.x) + Math.abs(event.clientY - candidate.y) > 14;
      if (candidate.cancelled || moved || Date.now() - candidate.at > 500) return;
      // Chrome can spend a touch on a native drag attempt and never synthesise
      // the click. If no click landed shortly after the finger lifted, replay
      // exactly one on the row so a short tap always opens the session.
      setTimeout(() => {
        if (candidate.fired) return;
        candidate.row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      }, 260);
    }

    function onDragStartCapture(event) {
      cancelLongPress();
      if (tapCandidate !== null) tapCandidate.cancelled = true;
      const row = event.target.closest && event.target.closest('[data-row-key^="session:"]');
      if (row !== null && row !== undefined) row.setAttribute("data-rdsh-dragging", "");
    }

    function onDragEndCapture(event) {
      const row = event.target.closest && event.target.closest('[data-row-key^="session:"]');
      if (row !== null && row !== undefined) row.removeAttribute("data-rdsh-dragging");
    }

    /** Mobile long-press must only reorder; the app's dblclick rename is off. */
    function onSessionTitleDoubleClick(event) {
      if (!narrow()) return;
      if (event.target.closest === undefined || event.target.closest("[data-rdsh-session-title]") === null) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    /** Suppress the iOS text callout/context menu on the session title. */
    function onSessionContextMenu(event) {
      if (!narrow()) return;
      if (event.target.closest === undefined) return;
      if (event.target.closest("[data-rdsh-session-title], [data-rdsh-session]") === null) return;
      event.preventDefault();
    }

    /**
     * Nearest horizontally scrolled ancestor, or null.
     *
     * A rightward swipe that starts on content already scrolled to the right
     * belongs to that content, not to the sheet's close gesture.
     */
    function scrolledLeftAncestor(target) {
      let node = target;
      while (node !== null && node !== undefined && node !== document.body) {
        if (node.nodeType === 1) {
          const style = getComputedStyle(node);
          if ((style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollLeft > 1) return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    // Edge swipe from the left opens the session drawer; from the right it
    // pulls the preview/right sidebar (the app's own "Open right sidebar").
    // While the preview is open the left-to-right gesture closes it instead.
    let edgeSwipe = null;
    function onEdgeSwipeStart(event) {
      if (!narrow() || event.touches.length !== 1) return;
      if (document.querySelector("[data-rdsh-lightbox], [data-rdsh-crop-overlay], [data-shortcut-modal=settings]") !== null) return;
      const touch = event.touches[0];
      const target = event.target;
      const fromRight = touch.clientX >= window.innerWidth - 36;
      const drawerOpen = document.documentElement.getAttribute("data-rdsh-drawer") === "open";
      const panelOpen = document.documentElement.hasAttribute("data-rdsh-rightpanel-open");
      // While the preview is open, a rightward swipe anywhere on it goes back
      // to the chat, the way a pushed iOS screen does. This is checked before
      // the edge rules below, which would otherwise return first.
      if (panelOpen && !drawerOpen) {
        if (target instanceof Element) {
          if (scrolledLeftAncestor(target) !== null) return;
          if (target.closest("input, textarea, [contenteditable=true]") !== null) return;
        }
        edgeSwipe = { x: touch.clientX, y: touch.clientY, fromRight: false, closesPanel: true };
        return;
      }
      if (fromRight) {
        // The drawer owns the screen while it is open: a swipe inside it must
        // not pull the preview over the session list.
        if (drawerOpen) return;
      } else {
        // ...and the left edge only opens the session list when nothing else
        // has the screen.
        if (drawerOpen) return;
        if (touch.clientX > 36) return;
      }
      if (target instanceof Element && target.closest("button, a, input, textarea, [role=button], [contenteditable=true]") !== null) return;
      edgeSwipe = { x: touch.clientX, y: touch.clientY, fromRight };
    }
    function onEdgeSwipeMove(event) {
      if (edgeSwipe === null || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dx = touch.clientX - edgeSwipe.x;
      const dy = touch.clientY - edgeSwipe.y;
      if (edgeSwipe.closesPanel === true) {
        if (dx < 64 || Math.abs(dy) > Math.abs(dx)) return;
        edgeSwipe = null;
        if (event.cancelable) event.preventDefault();
        document.querySelector('[aria-label="Collapse right sidebar"]')?.click();
        return;
      }
      if (edgeSwipe.fromRight) {
        if (dx > -64 || Math.abs(dy) > Math.abs(dx)) return;
        edgeSwipe = null;
        if (event.cancelable) event.preventDefault();
        document.querySelector('[aria-label="Open right sidebar"]')?.click();
        return;
      }
      if (dx < 64 || Math.abs(dy) > Math.abs(dx)) return;
      edgeSwipe = null;
      if (event.cancelable) event.preventDefault();
      toggleDrawer();
    }
    function onEdgeSwipeEnd() { edgeSwipe = null; }

    // ---------------------------------------------------------------------
    // Input: Enter inserts a newline unless the user opts into sending
    // ---------------------------------------------------------------------
    function composerEditor(target) {
      if (target === null || target === undefined || target.closest === undefined) return null;
      return target.closest('[contenteditable="true"], textarea');
    }

    /** A popup that owns Enter (slash commands, workspace picker, menus). */
    function openPopup() {
      for (const element of document.querySelectorAll('[role="listbox"], [role="menu"]')) {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) return element;
      }
      return null;
    }

    /**
     * Insert one soft line break through the editor's own beforeinput path.
     * A synthetic Shift+Enter works on Chrome but not on iOS: the software
     * keyboard reports keyCode 229, so the app's keymap treats the synthetic
     * chord as an active composition and swallows it. `insertLineBreak` is
     * handled by Lexical as plain JS, independent of key trust or keyCode.
     */
    function insertLineBreak(editor) {
      if (editor.tagName === "TEXTAREA") {
        const start = editor.selectionStart ?? editor.value.length;
        const end = editor.selectionEnd ?? start;
        editor.setRangeText("\n", start, end, "end");
        editor.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
      try {
        editor.dispatchEvent(new InputEvent("beforeinput", {
          inputType: "insertLineBreak",
          bubbles: true,
          cancelable: true,
        }));
      } catch {
        const event = new Event("beforeinput", { bubbles: true, cancelable: true });
        event.inputType = "insertLineBreak";
        editor.dispatchEvent(event);
      }
      // Do not insert a native <br> here as a "fallback": Lexical applies
      // beforeinput on the next update, so a synchronous execCommand inserts a
      // second break and desynchronises the editor state.
    }

    function onKeyDownCapture(event) {
      if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      const editor = composerEditor(event.target);
      if (editor === null) return;
      // Only the message composer. A rename field or another contenteditable
      // keeps its own Enter behaviour (commit, newline, …).
      if (editor.closest("[data-composer-input]") === null) return;
      // The app marks the root while an IME composition owns Return; that
      // Return belongs to the IME (confirm the conversion), not to us.
      if (editor.closest("[data-composer-composing]") !== null) return;
      // A selected command chip owns Enter (remove or expand it).
      if (editor.querySelector("[data-selected]") !== null) return;
      // While a menu is open, Enter selects its highlighted row.
      if (openPopup() !== null) return;
      if (state.enterToSend) {
        markMobileSession();
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      insertLineBreak(editor);
    }

    // ---------------------------------------------------------------------
    // Overscroll: no document rubber-band at the ends of a scroll container
    // ---------------------------------------------------------------------
    let touchStart = null;

    function scrollableAncestor(target) {
      let node = target;
      while (node !== null && node !== undefined && node !== document.body) {
        if (node.nodeType === 1) {
          const style = getComputedStyle(node);
          if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 2) return node;
        }
        node = node.parentElement;
      }
      return null;
    }

    function onTouchStart(event) {
      if (event.touches.length !== 1) {
        touchStart = null;
        return;
      }
      touchStart = { y: event.touches[0].clientY, x: event.touches[0].clientX };
    }

    function onTouchMove(event) {
      if (touchStart === null || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dy = touch.clientY - touchStart.y;
      const dx = touch.clientX - touchStart.x;
      touchStart = { y: touch.clientY, x: touch.clientX };
      if (Math.abs(dy) <= Math.abs(dx)) return;
      const target = event.target;
      if (target !== null && target.closest !== undefined && target.closest("textarea, input")) return;
      const scroller = scrollableAncestor(target);
      if (scroller === null) {
        if (event.cancelable) event.preventDefault();
        return;
      }
      const atTop = scroller.scrollTop <= 0;
      const atBottom = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      if ((dy > 0 && atTop) || (dy < 0 && atBottom)) {
        if (event.cancelable) event.preventDefault();
      }
    }

    // ---------------------------------------------------------------------
    // Click routing: session open, title popover, one-tap settings
    // ---------------------------------------------------------------------
    let settingsPendingUntil = 0;

    function maybeOpenSettings() {
      if (settingsPendingUntil === 0) return;
      if (Date.now() > settingsPendingUntil) {
        settingsPendingUntil = 0;
        return;
      }
      const menu = document.querySelector("[role='menu']");
      if (menu === null) return;
      const item = [...menu.querySelectorAll("[role='menuitem']")].find((entry) => /^Settings$|^設定$/.test(labelOf(entry)));
      if (item === undefined) return;
      settingsPendingUntil = 0;
      item.click();
    }

    function closeDetailPopover() {
      document.querySelector(".rdsh-mux-detail")?.remove();
    }

    function showDetailPopover(anchor, title, text, meta) {
      closeDetailPopover();
      if (text === null || text === undefined || text === "") return;
      const pop = document.createElement("div");
      pop.className = "rdsh-mux-detail";
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", title);
      const head = document.createElement("div");
      head.className = "rdsh-mux-detail-head";
      const name = document.createElement("span");
      name.className = "rdsh-mux-detail-title";
      name.textContent = title;
      head.append(name);
      if (meta !== null && meta !== undefined && meta !== "") {
        const badge = document.createElement("span");
        badge.className = "rdsh-mux-detail-meta";
        badge.textContent = meta;
        head.append(badge);
      }
      const body = document.createElement("div");
      body.className = "rdsh-mux-detail-body";
      body.textContent = text;
      pop.append(head, body);
      document.body.append(pop);
      const rect = anchor.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 24);
      pop.style.width = `${width}px`;
      const height = pop.getBoundingClientRect().height;
      let top = rect.top - height - 8;
      if (top < 12) top = Math.min(window.innerHeight - height - 12, rect.bottom + 8);
      pop.style.top = `${Math.round(Math.max(12, top))}px`;
      pop.style.left = `${Math.round(Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)))}px`;
      const dismiss = (event) => {
        if (!pop.contains(event.target)) closeDetailPopover();
      };
      setTimeout(() => document.addEventListener("pointerdown", dismiss), 0);
    }

    function showTitlePopover(crumbs) {
      document.querySelector(".rdsh-mux-titlepop")?.remove();
      const text = (crumbs.textContent || "").trim();
      if (text === "") return;
      const popover = document.createElement("div");
      popover.className = "rdsh-mux-titlepop";
      popover.setAttribute("role", "status");
      popover.textContent = text;
      const rect = crumbs.getBoundingClientRect();
      const header = document.querySelector("header[data-window-drag]");
      const belowHeader = header === null ? rect.bottom : header.getBoundingClientRect().bottom;
      popover.style.top = `${Math.round(Math.max(rect.bottom + 8, belowHeader + 4))}px`;
      const width = Math.min(320, window.innerWidth - 24);
      popover.style.width = `${width}px`;
      popover.style.left = `${Math.round(Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)))}px`;
      document.body.append(popover);
      const dismiss = () => popover.remove();
      setTimeout(dismiss, 2600);
      document.addEventListener("pointerdown", dismiss, { once: true });
    }

    function onClickCapture(event) {
      const target = event.target;
      if (target === null || target.closest === undefined) return;

      // xterm's helper textarea is the actual input; a click gesture focusing it
      // asks iOS to show the keyboard.
      if (narrow()) {
        const terminal = target.closest(".xterm, [class*='xterm']");
        if (terminal !== null) {
          const input = terminal.querySelector("textarea.xterm-helper-textarea, textarea");
          if (input !== null) input.focus({ preventScroll: true });
        }
      }
      // Fallback for keyboard activation of the send/queue button.
      if (narrow()) {
        const primary = target.closest && target.closest('[data-rdsh-composer-root] [class*="primary"]');
        if (primary !== null && primary !== undefined && primary.disabled !== true && !/stop|停止/i.test(primary.getAttribute("aria-label") || "")) {
          markMobileSession();
        }
      }
      // Phone "+": open the OS file/photo picker directly. Commands live in "/".
      if (addButtonOf(target) !== null && narrow()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        pickFiles("any");
        return;
      }
      // Todo rows and the goal objective are truncated in the dock; tapping
      // opens a read-only popover with the full text.
      const todoItem = target.closest("[data-rdsh-todo-item]");
      if (todoItem !== null && narrow()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        showDetailPopover(todoItem, "Todo", todoItem.getAttribute("data-rdsh-todo-text"), todoItem.getAttribute("data-rdsh-todo-status"));
        return;
      }
      const goalObjective = target.closest("[data-rdsh-goal-objective]");
      if (goalObjective !== null && narrow()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const goalBar = goalObjective.closest("[data-goal-bar]");
        const goalLabel = goalBar === null ? null : goalBar.querySelector('[class*="_label"]');
        showDetailPopover(goalObjective, "Goal", goalObjective.getAttribute("data-rdsh-goal-text"), goalLabel === null ? null : goalLabel.textContent.trim());
        return;
      }
      // Right sidebar: its class does not change on open/close, so re-read the
      // computed visibility after the click has settled.
      if (rightPanelNode !== null) {
        // The slide transition can outlive the click; re-read after it settles.
        setTimeout(syncRightPanelOpen, 60);
        setTimeout(syncRightPanelOpen, 350);
        setTimeout(syncRightPanelOpen, 900);
      }

      const row = target.closest('[data-row-key^="session:"]');
      if (row !== null && narrow()) {
        // Only the release click is a target: the click this module sends to
        // the row's own "..." trigger starts inside its actions, and eating that
        // one left every long press after the first without a menu.
        if (Date.now() < menuOpenedUntil && target.closest('[class*="_rowActions"]') === null) {
          menuOpenedUntil = 0;
          event.preventDefault();
          event.stopImmediatePropagation();
          return;
        }
        if (controlInsideRow(target)) return;
        if (tapCandidate !== null) tapCandidate.fired = true;
        // Close after the row's own handler has opened the session.
        setTimeout(closeDrawer, 0);
        return;
      }

      if (target.closest('[data-shortcut-modal="settings"]') !== null) return;

      const crumbs = target.closest("[data-rdsh-crumbs]");
      if (crumbs !== null && narrow()) {
        showTitlePopover(crumbs);
        return;
      }

      const more = target.closest("[data-rdsh-more]");
      if (more !== null && narrow()) {
        if (globalThis.__RDSH_MOBILE_UX__ && globalThis.__RDSH_MOBILE_UX__.autoSettings === false) return;
        settingsPendingUntil = Date.now() + 2000;
        setTimeout(maybeOpenSettings, 30);
        setTimeout(maybeOpenSettings, 120);
      }
    }

    function onKeyDown(event) {
      if (event.key === "Escape") {
        document.querySelector(".rdsh-mux-titlepop")?.remove();
        closeDetailPopover();
        closeAttachSheet();
        return;
      }
      if (!narrow() || (event.key !== "Enter" && event.key !== " ")) return;
      const target = event.target;
      if (target === null || target === undefined || target.closest === undefined) return;
      const todoItem = target.closest("[data-rdsh-todo-item]");
      if (todoItem !== null) {
        event.preventDefault();
        showDetailPopover(todoItem, "Todo", todoItem.getAttribute("data-rdsh-todo-text"), todoItem.getAttribute("data-rdsh-todo-status"));
        return;
      }
      const goalObjective = target.closest("[data-rdsh-goal-objective]");
      if (goalObjective !== null) {
        event.preventDefault();
        const goalBar = goalObjective.closest("[data-goal-bar]");
        const goalLabel = goalBar === null ? null : goalBar.querySelector('[class*="_label"]');
        showDetailPopover(goalObjective, "Goal", goalObjective.getAttribute("data-rdsh-goal-text"), goalLabel === null ? null : goalLabel.textContent.trim());
      }
    }

    // ---------------------------------------------------------------------
    // Session color frame: a "3-dot menu" item plus a small palette
    // ---------------------------------------------------------------------
    function frameIcon() {
      return h("svg", {
        width: 16, height: 16, viewBox: "0 0 16 16", fill: "none",
        stroke: "currentColor", strokeWidth: 1, "aria-hidden": "true",
      },
        h("rect", { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2.5 }),
        h("rect", { x: 5.5, y: 5.5, width: 5, height: 5, rx: 1.2 }),
        h("circle", { cx: 12.5, cy: 3.5, r: 1.2, fill: "currentColor", stroke: "none" }));
    }

    function closeFramePalette() {
      document.querySelector(".rdsh-frame-pop")?.remove();
      document.querySelector(".rdsh-frame-backdrop")?.remove();
    }

    function showFramePalette(sessionId, anchor) {
      closeFramePalette();
      const pop = document.createElement("div");
      pop.className = "rdsh-frame-pop";
      pop.setAttribute("role", "dialog");
      pop.setAttribute("aria-label", "セッションの枠色");
      const current = sessionFrames[sessionId];
      const title = document.createElement("div");
      title.className = "rdsh-frame-pop-title";
      title.textContent = "枠の色";
      const swatches = document.createElement("div");
      swatches.className = "rdsh-frame-swatches";
      for (const color of FRAME_COLORS) {
        const swatch = document.createElement("button");
        swatch.type = "button";
        swatch.className = "rdsh-frame-swatch";
        swatch.style.background = color.value;
        swatch.setAttribute("aria-label", color.label);
        swatch.setAttribute("data-current", String(current === color.value));
        swatch.addEventListener("click", () => {
          saveSessionFrame(sessionId, color.value);
          closeFramePalette();
          mobileToast(`枠の色を${color.label}にしました`);
        });
        swatches.append(swatch);
      }
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "rdsh-frame-clear";
      clear.textContent = "枠を外す";
      clear.addEventListener("click", () => {
        saveSessionFrame(sessionId, null);
        closeFramePalette();
        mobileToast("枠を外しました");
      });
      pop.append(title, swatches, clear);
      document.body.append(pop);
      const rect = pop.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const anchorRect = anchor instanceof Element ? anchor.getBoundingClientRect() : (anchor ?? null);
      const left = anchorRect === null ? 16 : Math.max(8, Math.min(anchorRect.right - width, window.innerWidth - width - 8));
      const top = anchorRect === null ? window.innerHeight - height - 24 : Math.max(8, Math.min(anchorRect.bottom + 8, window.innerHeight - height - 24));
      pop.style.left = `${Math.round(left)}px`;
      pop.style.top = `${Math.round(top)}px`;
      const backdrop = document.createElement("div");
      backdrop.className = "rdsh-frame-backdrop";
      backdrop.setAttribute("aria-hidden", "true");
      backdrop.addEventListener("click", closeFramePalette);
      document.body.append(backdrop);
    }

    function ColorFrameMenuItem(props) {
      const sessionId = props.sessionId;
      const menuState = typeof props.useMenuOpenState === "function" ? props.useMenuOpenState() : null;
      const setMenuOpen = Array.isArray(menuState) ? menuState[1] : null;
      if (typeof sessionId !== "string") return null;
      return h("button", {
        type: "button",
        role: "menuitem",
        className: "rdsh-frame-menu-item",
        onClick: (event) => {
          event.preventDefault();
          event.stopPropagation();
          const anchorRect = event.currentTarget.getBoundingClientRect();
          if (typeof setMenuOpen === "function") setMenuOpen(false);
          setTimeout(() => showFramePalette(sessionId, anchorRect), 0);
        },
      }, h("span", { className: "rdsh-frame-menu-icon", "aria-hidden": "true" }, frameIcon()), h("span", null, "色枠"));
    }

    // ---------------------------------------------------------------------
    // Image lightbox: safe-area close, swipe-down dismiss, simple crop
    // ---------------------------------------------------------------------
    const CROP_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 2v14a1 1 0 0 0 1 1h14"/><path d="M2 7h14a1 1 0 0 1 1 1v14"/></svg>';
    const CROP_HANDLE_CORNERS = ["nw", "ne", "sw", "se"];

    function lightboxDialog() {
      // Do not key this off the dialog's localized aria-label: with the UI in
      // Japanese ("元の画像のプレビュー") the crop/safe-area hooks never attached.
      for (const dialog of document.querySelectorAll('div[role="dialog"]')) {
        if (dialog.hasAttribute("data-rdsh-crop-overlay")) continue;
        if (dialog.hasAttribute("data-shortcut-modal")) continue;
        if (dialog.querySelector('[class*="_stage_"]') !== null && dialog.querySelector("img") !== null) return dialog;
      }
      for (const dialog of document.querySelectorAll('div[role="dialog"]')) {
        if (dialog.hasAttribute("data-rdsh-crop-overlay")) continue;
        if (dialog.hasAttribute("data-shortcut-modal")) continue;
        if (dialog.querySelector("img") !== null && dialog.querySelector('button[class*="_close_"]') !== null) return dialog;
      }
      return null;
    }

    function attachLightboxSwipe(dialog) {
      if (dialog.hasAttribute("data-rdsh-swipe")) return;
      dialog.setAttribute("data-rdsh-swipe", "");
      const stage = dialog.querySelector('[class*="_stage_"]');
      const close = dialog.querySelector('[class*="_close_"]');
      if (stage === null || close === null) return;
      let start = null;
      const reset = () => {
        start = null;
        stage.style.transition = "transform .18s ease, opacity .18s ease";
        stage.style.transform = "";
        stage.style.opacity = "";
        setTimeout(() => { stage.style.transition = ""; }, 200);
      };
      dialog.addEventListener("touchstart", (event) => {
        if (dialog.querySelector("[data-rdsh-crop-overlay]") !== null) return;
        if (event.touches.length !== 1) return;
        if (event.target.closest("button") !== null) return;
        const touch = event.touches[0];
        start = { x: touch.clientX, y: touch.clientY, dy: 0 };
        stage.style.transition = "none";
      }, { passive: true });
      dialog.addEventListener("touchmove", (event) => {
        if (start === null || event.touches.length !== 1) return;
        const touch = event.touches[0];
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (dy <= 0 || Math.abs(dy) <= Math.abs(dx)) {
          return;
        }
        event.preventDefault();
        start.dy = dy;
        stage.style.transform = `translateY(${Math.round(dy)}px)`;
        stage.style.opacity = String(Math.max(0.25, 1 - dy / 500));
      }, { passive: false });
      dialog.addEventListener("touchend", () => {
        if (start === null) return;
        const dy = start.dy;
        if (dy > 90) {
          start = null;
          close.click();
          stage.style.transform = "";
          stage.style.opacity = "";
          stage.style.transition = "";
        } else {
          reset();
        }
      }, { passive: true });
      dialog.addEventListener("touchcancel", reset, { passive: true });
    }

    const imageEditRecords = new Map();

    /** Locate the composer thumbnail that owns this lightbox image. */
    function composerImageFor(src) {
      const root = document.querySelector('[data-rdsh-composer-root]');
      if (root === null || typeof src !== "string" || src === "") return null;
      for (const img of root.querySelectorAll("img")) {
        if ((img.currentSrc || img.src) !== src) continue;
        const item = img.closest('[class*="_imageItem"]');
        return { src, img, item, remove: item?.querySelector('button[aria-label^="Remove image"]') ?? null };
      }
      return null;
    }

    function readAsDataUrl(blob) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => resolve("");
        reader.readAsDataURL(blob);
      });
    }

    async function srcToDataUrl(src) {
      const response = await fetch(src);
      return readAsDataUrl(await response.blob());
    }

    function attachFileToComposer(file) {
      const input = document.querySelector('[data-rdsh-composer-root] input[type="file"]')
        ?? document.querySelector('input[type="file"]');
      if (input === null) return false;
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }

    function openCrop(dialog) {
      if (document.querySelector("[data-rdsh-crop-overlay]") !== null) return;
      const source = dialog.querySelector("img");
      if (source === null) return;
      const src = source.currentSrc || source.src;
      const composer = composerImageFor(src);
      let record = imageEditRecords.get(src) ?? null;
      if (record === null && composer !== null) {
        record = { originalSrc: src, originalData: null, currentSrc: src, rotation: 0, cropNorm: null };
        imageEditRecords.set(src, record);
      }
      const editSrc = record?.originalData ?? record?.originalSrc ?? src;
      const initialRotation = record?.rotation ?? 0;
      const initialCrop = record?.cropNorm ?? null;
      const overlay = document.createElement("div");
      overlay.className = "rdsh-crop-overlay";
      overlay.setAttribute("data-rdsh-crop-overlay", "");
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute("aria-label", "画像をトリミング");
      overlay.innerHTML = `
        <div class="rdsh-crop-head">
          <strong>画像をトリミング</strong>
          <div class="rdsh-crop-head-actions">
            <button type="button" class="rdsh-crop-rotate" data-rotate="-90" aria-label="左に90度回転"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg></button>
            <button type="button" class="rdsh-crop-rotate" data-rotate="90" aria-label="右に90度回転"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/></svg></button>
            <button type="button" class="rdsh-crop-close" aria-label="トリミングを閉じる">×</button>
          </div>
        </div>
        <div class="rdsh-crop-stage"><div class="rdsh-crop-wrap"><img class="rdsh-crop-image" alt="" draggable="false"><div class="rdsh-crop-box"><span class="rdsh-crop-handle" data-corner="nw"></span><span class="rdsh-crop-handle" data-corner="ne"></span><span class="rdsh-crop-handle" data-corner="sw"></span><span class="rdsh-crop-handle" data-corner="se"></span></div></div></div>
        <div class="rdsh-crop-actions"><button type="button" class="rdsh-crop-cancel">キャンセル</button><button type="button" class="rdsh-crop-save">クエリに追加</button></div>`;
      const image = overlay.querySelector(".rdsh-crop-image");
      const wrap = overlay.querySelector(".rdsh-crop-wrap");
      const stage = overlay.querySelector(".rdsh-crop-stage");
      const box = overlay.querySelector(".rdsh-crop-box");
      const save = overlay.querySelector(".rdsh-crop-save");
      const close = () => closeCrop();
      overlay.querySelector(".rdsh-crop-close").addEventListener("click", () => closeCrop());
      overlay.querySelector(".rdsh-crop-cancel").addEventListener("click", () => closeCrop());
      const state = { x: 0, y: 0, w: 0, h: 0 };
      let cropNorm = initialCrop === null ? null : { ...initialCrop };
      let move = null;
      let rotation = 0;
      let rotatedUrl = null;
      let baseReady = false;
      let initialRotationApplied = false;
      const base = new Image();
      base.onload = () => { baseReady = true; maybeApplyInitialRotation(); };
      base.onerror = () => { baseReady = false; };
      base.src = editSrc;
      const render = () => {
        box.style.left = `${state.x}px`;
        box.style.top = `${state.y}px`;
        box.style.width = `${state.w}px`;
        box.style.height = `${state.h}px`;
      };
      const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
      const syncNorm = () => {
        const iw = image.clientWidth;
        const ih = image.clientHeight;
        if (iw === 0 || ih === 0 || state.w <= 0 || state.h <= 0) return;
        cropNorm = { x: state.x / iw, y: state.y / ih, w: state.w / iw, h: state.h / ih };
      };
      const fit = () => {
        const iw = image.naturalWidth;
        const ih = image.naturalHeight;
        const sw = stage.clientWidth;
        const sh = stage.clientHeight;
        if (iw === 0 || ih === 0 || sw === 0 || sh === 0) return;
        const availW = Math.max(1, sw - 24);
        const availH = Math.max(1, sh - 24);
        const scale = Math.min(availW / iw, availH / ih);
        const width = Math.max(1, Math.round(iw * scale));
        const height = Math.max(1, Math.round(ih * scale));
        wrap.style.width = `${width}px`;
        wrap.style.height = `${height}px`;
        image.style.width = `${width}px`;
        image.style.height = `${height}px`;
        if (cropNorm === null) {
          // Start with the full image: the four handles sit on its corners.
          state.x = 0; state.y = 0;
          state.w = width; state.h = height;
          cropNorm = { x: 0, y: 0, w: 1, h: 1 };
        } else {
          const x = clamp(cropNorm.x * width, 0, Math.max(0, width - 1));
          const y = clamp(cropNorm.y * height, 0, Math.max(0, height - 1));
          state.x = x;
          state.y = y;
          state.w = clamp(cropNorm.w * width, 1, width - x);
          state.h = clamp(cropNorm.h * height, 1, height - y);
        }
        render();
      };
      const onResize = () => fit();
      window.addEventListener("resize", onResize);
      image.addEventListener("load", () => {
        fit();
        maybeApplyInitialRotation();
      });
      image.src = editSrc;
      if (image.complete) fit();
      requestAnimationFrame(fit);

      const applyRotation = (delta, rotateCrop = true) => {
        if (!baseReady || base.naturalWidth === 0) return;
        // Rotate the crop rectangle with the image so the same content stays
        // selected. Normalized coordinates are orientation-independent.
        const norm = cropNorm ?? { x: 0, y: 0, w: 1, h: 1 };
        const step = ((delta % 360) + 360) % 360;
        if (rotateCrop && step === 90) {
          cropNorm = { x: 1 - (norm.y + norm.h), y: norm.x, w: norm.h, h: norm.w };
        } else if (rotateCrop && step === 270) {
          cropNorm = { x: norm.y, y: 1 - (norm.x + norm.w), w: norm.h, h: norm.w };
        }
        rotation = (rotation + delta + 360) % 360;
        const canvas = document.createElement("canvas");
        const sideways = rotation % 180 !== 0;
        canvas.width = sideways ? base.naturalHeight : base.naturalWidth;
        canvas.height = sideways ? base.naturalWidth : base.naturalHeight;
        const context = canvas.getContext("2d");
        context.translate(canvas.width / 2, canvas.height / 2);
        context.rotate(rotation * Math.PI / 180);
        context.drawImage(base, -base.naturalWidth / 2, -base.naturalHeight / 2);
        canvas.toBlob((blob) => {
          if (blob === null) return;
          if (rotatedUrl !== null) URL.revokeObjectURL(rotatedUrl);
          rotatedUrl = URL.createObjectURL(blob);
          image.src = rotatedUrl;
          if (image.complete) fit();
          requestAnimationFrame(fit);
        }, "image/png");
      };
      const maybeApplyInitialRotation = () => {
        if (initialRotationApplied || !baseReady || initialRotation === 0) return;
        initialRotationApplied = true;
        applyRotation(initialRotation, false);
      };
      for (const button of overlay.querySelectorAll("[data-rotate]")) {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          applyRotation(Number(button.getAttribute("data-rotate")));
        });
      }
      const closeCrop = () => {
        window.removeEventListener("resize", onResize);
        if (rotatedUrl !== null) URL.revokeObjectURL(rotatedUrl);
        overlay.remove();
      };
      const onMove = (event) => {
        if (move === null) return;
        const dx = event.clientX - move.sx;
        const dy = event.clientY - move.sy;
        if (move.kind === "move") {
          state.x = clamp(move.x + dx, 0, image.clientWidth - state.w);
          state.y = clamp(move.y + dy, 0, image.clientHeight - state.h);
        } else {
          let left = move.x;
          let top = move.y;
          let right = move.x + move.w;
          let bottom = move.y + move.h;
          if (move.corner.includes("e")) right = clamp(right + dx, left + 48, image.clientWidth);
          if (move.corner.includes("s")) bottom = clamp(bottom + dy, top + 48, image.clientHeight);
          if (move.corner.includes("w")) left = clamp(left + dx, 0, right - 48);
          if (move.corner.includes("n")) top = clamp(top + dy, 0, bottom - 48);
          state.x = left; state.y = top; state.w = right - left; state.h = bottom - top;
        }
        render();
        syncNorm();
      };
      box.addEventListener("pointerdown", (event) => {
        if (event.target.closest(".rdsh-crop-handle") !== null) return;
        event.preventDefault();
        move = { kind: "move", sx: event.clientX, sy: event.clientY, x: state.x, y: state.y, w: state.w, h: state.h };
        box.setPointerCapture(event.pointerId);
      });
      for (const handle of box.querySelectorAll(".rdsh-crop-handle")) {
        handle.addEventListener("pointerdown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          move = { kind: "resize", corner: handle.getAttribute("data-corner"), sx: event.clientX, sy: event.clientY, x: state.x, y: state.y, w: state.w, h: state.h };
          handle.setPointerCapture(event.pointerId);
        });
      }
      box.addEventListener("pointermove", onMove);
      box.addEventListener("pointerup", () => { move = null; });
      box.addEventListener("pointercancel", () => { move = null; });
      save.addEventListener("click", async () => {
        if (state.w <= 0 || state.h <= 0) return;
        const scaleX = image.naturalWidth / image.clientWidth;
        const scaleY = image.naturalHeight / image.clientHeight;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(state.w * scaleX));
        canvas.height = Math.max(1, Math.round(state.h * scaleY));
        const context = canvas.getContext("2d");
        context.drawImage(image, state.x * scaleX, state.y * scaleY, state.w * scaleX, state.h * scaleY, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
        if (blob === null) return;
        syncNorm();
        if (record !== null) {
          record.rotation = rotation;
          record.cropNorm = cropNorm === null ? null : { ...cropNorm };
        }
        const file = new File([blob], `crop-${Date.now()}.png`, { type: "image/png" });
        const closePreview = () => {
          dialog.querySelector('button[class*="_close_"]')?.click();
        };
        try {
          if (record !== null) {
            if (record.originalData === null) {
              try {
                record.originalData = await srcToDataUrl(record.originalSrc);
              } catch {
                record.originalData = record.originalSrc;
              }
            }
            const oldSrc = record.currentSrc;
            const current = composerImageFor(oldSrc);
            current?.remove?.click();
            if (!attachFileToComposer(file)) {
              mobileToast("クエリに画像を追加できませんでした");
              return;
            }
            const name = file.name;
            let tries = 0;
            const timer = setInterval(() => {
              const root = document.querySelector('[data-rdsh-composer-root]');
              const remove = root === null ? null : [...root.querySelectorAll("button")]
                .find((button) => button.getAttribute("aria-label") === `Remove image ${name}`);
              const img = remove?.closest('[class*="_imageItem"]')?.querySelector("img") ?? null;
              if (img !== null) {
                clearInterval(timer);
                const newSrc = img.currentSrc || img.src;
                imageEditRecords.delete(oldSrc);
                record.currentSrc = newSrc;
                imageEditRecords.set(newSrc, record);
              } else if (++tries > 50) {
                clearInterval(timer);
              }
            }, 100);
            mobileToast("編集した画像をクエリに反映しました");
          } else {
            if (!attachFileToComposer(file)) {
              mobileToast("クエリに画像を追加できませんでした");
              return;
            }
            mobileToast("トリミングした画像をクエリに追加しました");
          }
          close();
          closePreview();
        } catch {
          mobileToast("クエリに画像を追加できませんでした");
        }
      });
      document.body.append(overlay);
    }

    function decorateLightbox() {
      const dialog = lightboxDialog();
      if (dialog === null) return;
      if (!dialog.hasAttribute("data-rdsh-lightbox")) dialog.setAttribute("data-rdsh-lightbox", "");
      if (dialog.querySelector("[data-rdsh-crop-button]") === null) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("data-rdsh-crop-button", "");
        button.setAttribute("aria-label", "画像をトリミング");
        button.innerHTML = CROP_ICON;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          openCrop(dialog);
        });
        dialog.append(button);
      }
      attachLightboxSwipe(dialog);
    }

    // ---------------------------------------------------------------------
    // Notifications (Web Push in the installed app)
    // ---------------------------------------------------------------------
    function urlBase64ToUint8Array(base64) {
      const padding = "=".repeat((4 - (base64.length % 4)) % 4);
      const normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
      const raw = atob(normalized);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      return bytes;
    }

    async function notificationStatus() {
      if (typeof Notification === "undefined" || !("serviceWorker" in navigator)) {
        return { supported: false, permission: "unsupported", subscribed: false, ready: false };
      }
      let subscribed = false;
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = registration === null || registration === undefined ? null : await registration.pushManager.getSubscription();
        subscribed = subscription !== null && subscription !== undefined;
      } catch {
        subscribed = false;
      }
      return {
        supported: true,
        permission: Notification.permission,
        subscribed,
        ready: navigator.serviceWorker.controller !== null,
      };
    }

    async function refreshNotificationStatus() {
      emit({ notifications: await notificationStatus() });
    }

    async function enableNotifications() {
      if (typeof Notification === "undefined") throw new Error("このブラウザは通知に対応していません");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("通知の許可が得られませんでした");
      const registration = await navigator.serviceWorker.ready;
      const response = await fetch("/api/push/vapid", { cache: "no-store" });
      if (!response.ok) throw new Error("通知サーバーがありません（dsh-notify-push が必要です）");
      const { publicKey } = await response.json();
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing === null
        ? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) })
        : existing;
      const saved = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // `origin` becomes the VAPID contact for pushes: Apple rejects
        // mailto:root@localhost with 403 BadJwtToken, but accepts the app's own
        // https origin.
        body: JSON.stringify({ subscription: subscription.toJSON(), label: navigator.userAgent, origin: location.origin }),
      });
      if (!saved.ok) throw new Error(`購読の登録に失敗しました (${saved.status})`);
      await refreshNotificationStatus();
    }

    async function disableNotifications() {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = registration === null || registration === undefined ? null : await registration.pushManager.getSubscription();
      if (subscription !== null) {
        try {
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
        } catch {
          /* the browser-side unsubscribe below still removes the endpoint */
        }
        await subscription.unsubscribe();
      }
      await refreshNotificationStatus();
    }

    async function sendTestNotification() {
      // A local showNotification always succeeds, so it proves nothing about
      // the push path. Ask the host to push for real, and fall back to the
      // local notification only when the host has no such route.
      let pushed = null;
      try {
        const response = await fetch("/api/push/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // Carrying the id makes the test banner tappable: it opens the same
          // session a real notification would.
          body: JSON.stringify({ sessionId: currentSessionId ?? "" }),
        });
        if (response.status !== 404 && response.status !== 405) {
          pushed = await response.json();
        }
      } catch {
        pushed = null;
      }
      if (pushed !== null) {
        const result = Array.isArray(pushed.results) ? pushed.results[0] : null;
        if (pushed.ok === true) return;
        const detail = result === null || result === undefined
          ? String(pushed.error ?? "不明なエラー")
          : `${result.status || "-"} ${result.error ?? ""}`.trim();
        throw new Error(`プッシュが拒否されました（${detail}）`);
      }
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration === null || registration === undefined) throw new Error("サービスワーカーが未登録です");
      await registration.showNotification("DSH のテスト通知", {
        body: "通知が有効です。エージェントが質問したときにここへ届きます。",
        icon: "pwa/icon-192.png",
        badge: "pwa/badge-96.png",
        tag: "rdsh-mobile-ux:test",
      });
    }

    // ---------------------------------------------------------------------
    // UI: Settings section
    // ---------------------------------------------------------------------
    /** Numbers that distinguish the iOS 26 native gap from the safe-area chin. */
    function readViewportMetrics() {
      const viewport = window.visualViewport;
      const screenHeight = window.screen && Number.isFinite(window.screen.height) ? Math.round(window.screen.height) : 0;
      const innerHeight = Math.round(window.innerHeight);
      const rootStyle = getComputedStyle(document.documentElement);
      return {
        screenHeight,
        innerHeight,
        clientHeight: document.documentElement.clientHeight,
        visualHeight: viewport ? Math.round(viewport.height) : 0,
        visualOffset: viewport ? Math.round(viewport.offsetTop) : 0,
        gap: screenHeight > 0 ? screenHeight - innerHeight : null,
        standalone: window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches,
        nativeGap: document.documentElement.hasAttribute("data-rdsh-native-gap"),
        safeTop: rootStyle.getPropertyValue("--rdsh-safe-top").trim() || "0px",
        safeBottom: rootStyle.getPropertyValue("--rdsh-safe-bottom").trim() || "0px",
      };
    }

    function PermissionLabel(status) {
      if (!status.supported) return "このブラウザは非対応";
      if (status.permission === "granted") return status.subscribed ? "有効（購読済み）" : "許可済み（未購読）";
      if (status.permission === "denied") return "ブロックされています（ブラウザ設定から許可）";
      return "未許可";
    }

    function MobileSection() {
      const s = useStore();
      const [message, setMessage] = useState("");
      const [busy, setBusy] = useState(false);
      const [disabled, setDisabled] = useState(hideDisabled());
      const [extra, setExtra] = useState(readHideExtra().join("\n"));
      const [metrics, setMetrics] = useState(readViewportMetrics);
      const [scrollTick, setScrollTick] = useState(0);

      useEffect(() => {
        void refreshNotificationStatus();
      }, []);

      useEffect(() => {
        const refresh = () => setMetrics(readViewportMetrics());
        const viewport = window.visualViewport;
        viewport?.addEventListener("resize", refresh);
        viewport?.addEventListener("scroll", refresh);
        window.addEventListener("resize", refresh);
        window.addEventListener("orientationchange", refresh);
        refresh();
        return () => {
          viewport?.removeEventListener("resize", refresh);
          viewport?.removeEventListener("scroll", refresh);
          window.removeEventListener("resize", refresh);
          window.removeEventListener("orientationchange", refresh);
        };
      }, []);

      const run = async (action, success) => {
        setBusy(true);
        setMessage("");
        try {
          await action();
          setMessage(success);
        } catch (error) {
          setMessage(String((error && error.message) || error));
        } finally {
          setBusy(false);
          scheduleDecorate();
        }
      };

      const saveExtra = () => {
        const labels = extra.split("\n").map((line) => line.trim()).filter((line) => line !== "");
        try {
          localStorage.setItem(HIDE_EXTRA_KEY, JSON.stringify(labels));
        } catch {
          /* private mode: the list only lives for this page */
        }
        scheduleDecorate();
        setMessage("非表示リストを保存しました。");
      };

      const toggleDisabled = (value) => {
        setDisabled(value);
        try {
          if (value) localStorage.setItem(HIDE_OVERRIDE_KEY, "1");
          else localStorage.removeItem(HIDE_OVERRIDE_KEY);
        } catch {
          /* ignore */
        }
        scheduleDecorate();
      };

      return h(
        "section",
        { className: "rdsh-mux-section" },
        h(
          "div",
          { className: "rdsh-mux-card" },
          h("h3", { className: "rdsh-mux-title" }, "モバイルUI"),
          h("p", { className: "rdsh-mux-desc" }, "スマホ幅の表示と操作を整えます。設定はこのブラウザに保存されます。"),
          h("p", { className: "rdsh-mux-note" }, "＋ は画像とファイルの添付だけを開きます（コマンドは / から）。"),
          h(
            "dl",
            { className: "rdsh-mux-rows" },
            h("dt", null, "レイアウト"),
            h("dd", null, s.narrow ? "スマホ幅（ドロワー表示）" : "デスクトップ幅"),
            h("dt", null, "セッション一覧"),
            h("dd", null, s.drawerOpen ? "開いています" : "閉じています"),
            h("dt", null, "通知"),
            h("dd", null, PermissionLabel(s.notifications)),
            h("dt", null, "UIビルド"),
            h("dd", null, BUILD),
          ),
          h(
            "div",
            { className: "rdsh-mux-actions" },
            h("button", {
              type: "button",
              className: "rdsh-mux-primary",
              disabled: busy || !s.notifications.supported,
              onClick: () => run(enableNotifications, "通知を有効にしました。"),
            }, s.notifications.permission === "granted" ? "通知を再登録" : "通知を有効にする"),
            h("button", {
              type: "button",
              disabled: busy || s.notifications.permission !== "granted",
              onClick: () => run(sendTestNotification, "テスト通知を送りました（プッシュ経由）。"),
            }, "テスト通知"),
            s.notifications.permission === "granted"
              ? h("button", {
                type: "button",
                disabled: busy,
                onClick: () => run(disableNotifications, "通知を解除しました。"),
              }, "通知を解除")
              : null,
          ),
          s.notifications.permission === "denied"
            ? h("p", { className: "rdsh-mux-note" }, "通知がブロックされています。ブラウザのサイト設定 → 通知 を「許可」に変更してください。")
            : null,
          h("p", { className: "rdsh-mux-note" }, "回答終了時と質問時に通知します。メインエージェントのみ、このスマホから送ったターンだけが対象です。"),
          message !== "" ? h("p", { className: "rdsh-mux-note" }, message) : null,
        ),
        h(
          "div",
          { className: "rdsh-mux-card" },
          h("h3", { className: "rdsh-mux-title" }, "画面の高さ"),
          h("p", { className: "rdsh-mux-desc" }, "ホーム画面のアプリで下に空白が出るときの確認用です。"),
          h(
            "dl",
            { className: "rdsh-mux-rows" },
            h("dt", null, "screen.height"),
            h("dd", null, String(metrics.screenHeight)),
            h("dt", null, "innerHeight"),
            h("dd", null, String(metrics.innerHeight)),
            h("dt", null, "clientHeight"),
            h("dd", null, String(metrics.clientHeight)),
            h("dt", null, "visualViewport"),
            h("dd", null, `${metrics.visualHeight}（offset ${metrics.visualOffset}）`),
            h("dt", null, "差分"),
            h("dd", null, metrics.gap === null ? "—" : `${metrics.gap}px`),
            h("dt", null, "standalone"),
            h("dd", null, metrics.standalone ? "はい" : "いいえ"),
            h("dt", null, "セーフエリア"),
            h("dd", null, `上 ${metrics.safeTop} / 下 ${metrics.safeBottom}`),
            h("dt", null, "ネイティブ余白"),
            h("dd", null, metrics.nativeGap ? "あり（内側の下余白を0に補正）" : "なし"),
          ),
          h("p", { className: "rdsh-mux-note" }, "差分が47〜62px前後なら iOS 26 のネイティブフレームです。下の帯はページの外なので、内側の下余白を0にして最小化しています。"),
          h(
            "div",
            { className: "rdsh-mux-actions" },
            h("button", { type: "button", onClick: () => setMetrics(readViewportMetrics()) }, "再測定"),
          ),
        ),
        h(
          "div",
          { className: "rdsh-mux-card", "data-scroll-tick": scrollTick },
          h("h3", { className: "rdsh-mux-title" }, "スクロール"),
          h("p", { className: "rdsh-mux-desc" }, "外側をスクロールしてからここを開くと、最後に動いた要素が分かります。"),
          h(
            "div",
            { className: "rdsh-mux-actions" },
            h("button", {
              type: "button",
              onClick: () => {
                lastScrolls.length = 0;
                setScrollTick((value) => value + 1);
              },
            }, "記録をクリア"),
            h("button", { type: "button", onClick: () => setScrollTick((value) => value + 1) }, "更新"),
          ),
          h("p", { className: "rdsh-mux-label" }, "最後にスクロールした要素"),
          lastScrolls.length === 0
            ? h("p", { className: "rdsh-mux-note" }, "（まだ記録がありません）")
            : h("ul", { className: "rdsh-mux-scroll-list" },
              lastScrolls.slice(-6).reverse().map((entry, index) => h(
                "li",
                { key: `${entry.at}:${index}` },
                `${entry.tag} ${entry.cls || "(classなし)"} — scrollTop ${entry.scrollTop} / ${entry.overflowY}`,
              )),
            ),
          h("p", { className: "rdsh-mux-label" }, "いまスクロール可能な要素"),
          h("ul", { className: "rdsh-mux-scroll-list" },
            scrollables().slice(0, 8).map((entry, index) => h(
              "li",
              { key: `${entry.cls}:${index}` },
              `${entry.tag} ${entry.cls || "(classなし)"} — ${entry.scrollTop} / ${entry.scrollHeight} (${entry.overflowY})`,
            )),
          ),
        ),
        h(
          "div",
          { className: "rdsh-mux-card" },
          h("h3", { className: "rdsh-mux-title" }, "非表示にした操作"),
          h("p", { className: "rdsh-mux-desc" }, "スマホでは使えない操作（エディタ／ターミナルで開く、フィードバック、サインインなど）を隠しています。"),
          h(
            "div",
            { className: "rdsh-mux-chips" },
            s.hidden.length === 0
              ? h("span", { className: "rdsh-mux-chip" }, "（現在は該当なし）")
              : s.hidden.map((label) => h("span", { className: "rdsh-mux-chip", key: label }, label)),
          ),
          h(
            "label",
            { className: "rdsh-mux-check" },
            h("input", { type: "checkbox", checked: disabled, onChange: (event) => toggleDisabled(event.target.checked) }),
            "非表示をやめる（デバッグ用）",
          ),
          h("div", null,
            h("div", { className: "rdsh-mux-label" }, "追加で非表示にするラベル（1行1件）"),
            h("textarea", {
              value: extra,
              rows: 3,
              spellCheck: false,
              onChange: (event) => setExtra(event.target.value),
              className: "rdsh-mux-textarea",
            }),
          ),
          h("div", { className: "rdsh-mux-actions" },
            h("button", { type: "button", onClick: saveExtra }, "保存して反映"),
          ),
        ),
        h(InputSection),
        typeof globalThis.__RDSH_PWA_SETTINGS_SECTION__ === "function"
          ? h(globalThis.__RDSH_PWA_SETTINGS_SECTION__)
          : null,
        s.bootError !== "" ? h("p", { className: "rdsh-mux-note" }, `起動時エラー: ${s.bootError}`) : null,
      );
    }

    function InputSection() {
      const s = useStore();
      return h(
        "section",
        { className: "rdsh-mux-section" },
        h(
          "div",
          { className: "rdsh-mux-card" },
          h("h3", { className: "rdsh-mux-title" }, "入力"),
          h("p", { className: "rdsh-mux-desc" }, "メッセージ入力欄で Enter を押したときの動作を選びます。"),
          h(
            "label",
            { className: "rdsh-mux-check" },
            h("input", {
              type: "checkbox",
              checked: s.enterToSend,
              onChange: (event) => writeEnterToSend(event.target.checked),
            }),
            "Enterで送信する（OFFなら改行）",
          ),
          h("p", { className: "rdsh-mux-note" }, s.enterToSend
            ? "現在: Enter で送信、Shift+Enter で改行。"
            : "現在: Enter で改行。送信は送信ボタンから（Shift+Enter も改行）。"),
        ),
      );
    }

    function LiveSpeed({ sessionId }) {
      const [speed, setSpeed] = useState(null);
      useEffect(() => {
        currentSessionId = typeof sessionId === "string" && sessionId !== "" ? sessionId : null;
        return () => {
          if (currentSessionId === sessionId) currentSessionId = null;
        };
      }, [sessionId]);
      useEffect(() => {
        if (!sessionId) {
          setSpeed(null);
          return undefined;
        }
        let active = true;
        const update = async () => {
          try {
            const response = await fetch(`/api/rdsh-mobile-ux/live-speed?sessionId=${encodeURIComponent(sessionId)}`, { cache: "no-store" });
            if (!response.ok) {
              if (active) setSpeed(null);
              return;
            }
            const data = await response.json();
            if (active) setSpeed(Number.isFinite(data?.tps) && data.tps > 0 ? Math.round(data.tps) : null);
          } catch {
            if (active) setSpeed(null);
          }
        };
        void update();
        const timer = window.setInterval(() => void update(), 500);
        return () => {
          active = false;
          window.clearInterval(timer);
        };
      }, [sessionId]);
      if (speed === null) return null;
      return h("span", {
        className: "rdsh-mux-live-speed",
        title: "v100 出力速度（ストリーム差分からの概算）",
        "aria-label": `v100 推定速度 ${speed} tok/s`,
      }, `≈ ${speed} tok/s`);
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------
    const CSS = `
.rdsh-mux-live-speed { color: var(--dsw-alias-label-secondary, #a1a1aa); font-size: 11px; white-space: nowrap; }
.rdsh-mux-fab {
  position: fixed; left: 8px; top: calc(env(safe-area-inset-top, 0px) + 8px);
  width: 40px; height: 40px; border: 0; border-radius: 12px; z-index: 40;
  display: none; align-items: center; justify-content: center;
  color: var(--dsw-alias-label-primary, #f9fafb);
  background: var(--dsw-alias-bg-module-platform, #26262a);
  box-shadow: 0 4px 16px rgba(0,0,0,.28);
  -webkit-tap-highlight-color: transparent; cursor: pointer;
}
.rdsh-mux-fab:active { transform: scale(.96); }
.rdsh-mux-fab-badge {
  position: absolute; top: -5px; right: -5px;
  min-width: 18px; height: 18px; padding: 0 4px;
  border-radius: 9px; box-sizing: border-box;
  background: #ff3b30; color: #fff;
  font: 700 10px/14px -apple-system, BlinkMacSystemFont, "Hiragino Sans", sans-serif;
  text-align: center; white-space: nowrap;
  border: 2px solid var(--dsw-alias-bg-base, #151517);
  box-shadow: 0 1px 4px rgba(0,0,0,.4);
  display: none; pointer-events: none;
}
.rdsh-mux-fab-badge[data-visible] { display: block; }
[data-rdsh-session-frame] {
  box-shadow: inset 0 0 0 2px var(--rdsh-session-frame) !important;
}
.rdsh-frame-menu-item {
  width: 100%; display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; border: 0; border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-primary, #f9fafb);
  font: inherit; font-size: 13px; text-align: left; cursor: pointer;
}
.rdsh-frame-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }
.rdsh-frame-menu-icon { display: grid; place-items: center; width: 16px; height: 16px; opacity: .9; }
.rdsh-frame-backdrop { position: fixed; inset: 0; z-index: 900; background: transparent; }
.rdsh-frame-pop {
  position: fixed; z-index: 901; width: 252px; box-sizing: border-box;
  padding: 12px; border-radius: 14px;
  background: #2a2a2e; color: var(--dsw-alias-label-primary, #f9fafb);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  box-shadow: 0 14px 40px rgba(0,0,0,.5);
}
.rdsh-frame-pop-title { font-size: 12px; color: var(--dsw-alias-label-secondary, #cfd3d6); margin-bottom: 10px; }
.rdsh-frame-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.rdsh-frame-swatch {
  width: 30px; height: 30px; border-radius: 999px !important;
  border: 2px solid transparent; padding: 0; cursor: pointer;
}
.rdsh-frame-swatch[data-current="true"] { border-color: #fff; box-shadow: 0 0 0 2px #2a2a2e, 0 0 0 3px #fff; }
.rdsh-frame-clear {
  width: 100%; margin-top: 12px; padding: 8px 10px;
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16)); border-radius: 8px;
  background: transparent; color: var(--dsw-alias-label-primary, #f9fafb);
  font: inherit; font-size: 12px; cursor: pointer;
}

.rdsh-mux-backdrop {
  position: fixed; inset: 0; z-index: 45; display: none;
  /* A light dim so the drawer reads as the active surface. No fade: the
     dimming is a state change, and fading it looked like a second sheet
     sliding in behind the drawer. */
  background: rgba(0,0,0,.35); opacity: 0; pointer-events: none;
}

.rdsh-mux-detail {
  position: fixed; z-index: 990; box-sizing: border-box;
  padding: 10px 12px 12px; border-radius: 12px;
  background: #2a2a2e !important;
  color: var(--dsw-alias-label-primary, #f9fafb);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  box-shadow: var(--dsw-elevation-prominent, 0 10px 30px rgba(0,0,0,.45));
  font-size: 13px; line-height: 1.55; overflow-wrap: anywhere;
  max-height: min(50dvh, 380px); overflow-y: auto;
  animation: rdsh-mux-pop .14s ease-out;
}
.rdsh-mux-detail-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.rdsh-mux-detail-title {
  font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary, #a1a1aa);
}
.rdsh-mux-detail-meta {
  font-size: 11px; color: var(--dsw-alias-label-tertiary, #a1a1aa);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  border-radius: 999px; padding: 1px 6px;
}
.rdsh-mux-detail-body { white-space: pre-wrap; }

.rdsh-mux-titlepop {
  position: fixed; z-index: 980; box-sizing: border-box;
  padding: 10px 12px; border-radius: 12px;
  background: #2a2a2e !important;
  color: var(--dsw-alias-label-primary, #f9fafb);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  box-shadow: var(--dsw-elevation-prominent, 0 10px 30px rgba(0,0,0,.45));
  font-size: 13px; line-height: 1.5; overflow-wrap: anywhere;
  animation: rdsh-mux-pop .14s ease-out;
}
@keyframes rdsh-mux-pop { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: none } }

/* Image lightbox: keep the close/crop controls below the camera housing,
   shrink the image into the remaining safe area, and darken the backdrop. */
[data-rdsh-lightbox] { background: rgba(0,0,0,.96) !important; }
[data-rdsh-lightbox] [class*="_mask_"] { background: rgba(0,0,0,.96) !important; }
[data-rdsh-lightbox] [class*="_close_"] {
  z-index: 5;
  top: calc(env(safe-area-inset-top, 0px) + 12px) !important;
  right: 16px !important;
  width: 40px !important; height: 40px !important;
  border-radius: 50% !important;
  background: rgba(44,44,46,.95) !important;
}
[data-rdsh-lightbox] [class*="_image_"] {
  max-height: calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 104px) !important;
  max-width: calc(100vw - 24px) !important;
}
[data-rdsh-crop-button] {
  position: absolute; z-index: 5; top: calc(env(safe-area-inset-top, 0px) + 12px); left: 16px;
  width: 40px; height: 40px; border: 0; border-radius: 50%;
  background: rgba(44,44,46,.95); color: #f9fafb;
  display: grid; place-items: center; z-index: 2; padding: 0;
}
.rdsh-crop-overlay {
  position: fixed; inset: 0; z-index: 1200;
  display: flex; flex-direction: column;
  background: #000; color: #f9fafb;
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
}
.rdsh-crop-head {
  position: relative; z-index: 3;
  flex: 0 0 auto; height: 52px; padding: 0 12px 0 16px;
  display: flex; align-items: center; justify-content: space-between;
  font-size: 15px;
}
.rdsh-crop-close {
  width: 40px; height: 40px; border: 0; border-radius: 50%;
  background: rgba(44,44,46,.95); color: #f9fafb; font-size: 22px; line-height: 1;
}
.rdsh-crop-head-actions { display: flex; align-items: center; gap: 4px; }
.rdsh-crop-rotate {
  width: 40px; height: 40px; border: 0; border-radius: 50%;
  background: rgba(44,44,46,.95); color: #f9fafb;
  display: grid; place-items: center; padding: 0;
}
.rdsh-crop-stage {
  flex: 1 1 auto; min-height: 0; display: flex;
  align-items: center; justify-content: center; padding: 12px;
}
.rdsh-crop-wrap { position: relative; line-height: 0; max-width: 100%; max-height: 100%; }
.rdsh-crop-image {
  display: block; max-width: 100%; max-height: 100%;
  user-select: none; -webkit-user-select: none; -webkit-user-drag: none;
}
.rdsh-crop-box {
  position: absolute; box-sizing: border-box;
  border: 1.5px solid #fff; cursor: move; touch-action: none;
  box-shadow: 0 0 0 9999px rgba(0,0,0,.55);
}
.rdsh-crop-box::before {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background-image:
    linear-gradient(to right, transparent calc(33.33% - .5px), rgba(255,255,255,.35) calc(33.33% - .5px), rgba(255,255,255,.35) calc(33.33% + .5px), transparent calc(33.33% + .5px), transparent calc(66.66% - .5px), rgba(255,255,255,.35) calc(66.66% - .5px), rgba(255,255,255,.35) calc(66.66% + .5px), transparent calc(66.66% + .5px)),
    linear-gradient(to bottom, transparent calc(33.33% - .5px), rgba(255,255,255,.35) calc(33.33% - .5px), rgba(255,255,255,.35) calc(33.33% + .5px), transparent calc(33.33% + .5px), transparent calc(66.66% - .5px), rgba(255,255,255,.35) calc(66.66% - .5px), rgba(255,255,255,.35) calc(66.66% + .5px), transparent calc(66.66% + .5px));
}
.rdsh-crop-handle {
  position: absolute; width: 24px; height: 24px; box-sizing: border-box;
  border: 2px solid #fff; border-radius: 50%;
  background: rgba(0,0,0,.35); touch-action: none;
}
.rdsh-crop-handle[data-corner="nw"] { left: -12px; top: -12px; cursor: nwse-resize; }
.rdsh-crop-handle[data-corner="ne"] { right: -12px; top: -12px; cursor: nesw-resize; }
.rdsh-crop-handle[data-corner="sw"] { left: -12px; bottom: -12px; cursor: nesw-resize; }
.rdsh-crop-handle[data-corner="se"] { right: -12px; bottom: -12px; cursor: nwse-resize; }
.rdsh-crop-actions {
  position: relative; z-index: 3;
  flex: 0 0 auto; display: flex; gap: 10px; padding: 12px 16px;
}
.rdsh-crop-actions button {
  flex: 1 1 0; height: 46px; border: 0; border-radius: 12px;
  font: inherit; font-size: 15px; font-weight: 600;
}
.rdsh-crop-cancel { background: #2c2c2e; color: #f9fafb; }
.rdsh-crop-save { background: #f9fafb; color: #151517; }

/* Phone attach sheet: two rows, no command menu, no keyboard. */
.rdsh-mux-sheet-backdrop {
  position: fixed; inset: 0; z-index: 950;
  background: rgba(0,0,0,.45);
  animation: rdsh-mux-fade .16s ease-out;
}
.rdsh-mux-sheet {
  position: fixed; z-index: 951; box-sizing: border-box;
  left: 8px; right: 8px;
  bottom: calc(max(env(safe-area-inset-bottom, 0px), var(--rdsh-safe-bottom, 0px)) + 8px);
  padding: 6px; border-radius: 16px;
  background: var(--dsw-specific-menu, #2a2a2e);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  box-shadow: var(--dsw-elevation-prominent, 0 12px 36px rgba(0,0,0,.5));
  color: var(--dsw-alias-label-primary, #f9fafb);
  animation: rdsh-mux-sheet-in .2s cubic-bezier(.22,.8,.26,1);
}
.rdsh-mux-sheet-row {
  display: flex; align-items: center; gap: 12px; box-sizing: border-box;
  width: 100%; min-height: 52px; padding: 0 10px;
  border: 0; border-radius: 12px; background: transparent;
  color: inherit; font: inherit; text-align: left; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.rdsh-mux-sheet-row:active { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }
.rdsh-mux-sheet-icon {
  display: flex; align-items: center; justify-content: center; flex: none;
  width: 36px; height: 36px; border-radius: 10px;
  background: var(--dsw-alias-bg-module-platform, #353638);
  color: var(--dsw-alias-label-primary, #f9fafb);
}
.rdsh-mux-sheet-label { flex: 1; font-size: 15px; }
.rdsh-mux-sheet-hint { flex: none; font-size: 12px; color: var(--dsw-alias-label-tertiary, #adb2b8); }
.rdsh-mux-sheet-cancel {
  display: block; box-sizing: border-box; width: 100%; min-height: 46px; margin-top: 6px;
  border: 0; border-radius: 12px; cursor: pointer;
  background: var(--dsw-alias-bg-module-platform, #353638);
  color: var(--dsw-alias-label-primary, #f9fafb);
  font: inherit; font-size: 15px;
}
.rdsh-mux-sheet-cancel:active { opacity: .8; }
@keyframes rdsh-mux-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes rdsh-mux-sheet-in { from { opacity: 0; transform: translateY(12px) } to { opacity: 1; transform: none } }

.rdsh-mux-toast {
  position: fixed; z-index: 960; left: 50%;
  bottom: calc(max(env(safe-area-inset-bottom, 0px), var(--rdsh-safe-bottom, 0px)) + 104px);
  max-width: calc(100vw - 48px); box-sizing: border-box;
  padding: 9px 14px; border-radius: 999px;
  background: rgba(20,20,22,.94); color: var(--dsw-alias-label-primary, #f9fafb);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  font-size: 13px; line-height: 1.4; text-align: center; pointer-events: none;
  opacity: 0; transform: translateX(-50%) translateY(6px);
  transition: opacity .16s ease, transform .16s ease;
}
.rdsh-mux-toast[data-show] { opacity: 1; transform: translateX(-50%); }

.rdsh-mux-section { display: flex; flex-direction: column; gap: 12px; color: var(--dsw-alias-label-primary, #f9fafb); }
.rdsh-mux-card {
  border: .5px solid var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l3, rgba(255,255,255,.12)));
  background: var(--dsw-alias-settings-card-fill, transparent);
  border-radius: 12px; padding: 12px 14px;
  display: flex; flex-direction: column; gap: 10px;
}
.rdsh-mux-title { margin: 0; font-size: 16px; font-weight: 500; }
.rdsh-mux-desc { margin: 0; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #adb2b8); }
.rdsh-mux-rows { display: grid; grid-template-columns: max-content minmax(0,1fr); gap: 6px 14px; margin: 0; font-size: 13px; }
.rdsh-mux-rows dt { color: var(--dsw-alias-label-secondary, #cfd3d6); }
.rdsh-mux-rows dd { margin: 0; overflow-wrap: anywhere; }
.rdsh-mux-scroll-list {
  margin: 0; padding-left: 16px;
  display: flex; flex-direction: column; gap: 3px;
  font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-label-secondary, #cfd3d6);
}
.rdsh-mux-scroll-list li { overflow-wrap: anywhere; }
.rdsh-mux-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.rdsh-mux-actions button, .rdsh-mux-card > button {
  font: inherit; font-size: 13px; min-height: 34px; padding: 0 14px; border-radius: 9px; cursor: pointer;
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
  background: transparent; color: var(--dsw-alias-label-primary, #f9fafb);
}
.rdsh-mux-actions button:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08)); }
.rdsh-mux-actions button.rdsh-mux-primary {
  border-color: transparent;
  background: var(--dsw-alias-button-primary-fill, #f9fafb);
  color: var(--dsw-alias-label-primary-foreground, #151517);
}
.rdsh-mux-actions button:disabled { opacity: .45; cursor: default; }
.rdsh-mux-note { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary, #adb2b8); }
.rdsh-mux-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.rdsh-mux-chip { font-size: 12px; padding: 3px 9px; border-radius: 999px; background: var(--dsw-alias-bg-module-platform, #353638); color: var(--dsw-alias-label-secondary, #cfd3d6); }
.rdsh-mux-check { display: flex; align-items: center; gap: 8px; font-size: 13px; }
.rdsh-mux-label { font-size: 12px; font-weight: 600; margin-bottom: 4px; color: var(--dsw-alias-label-secondary, #cfd3d6); }
.rdsh-mux-textarea {
  box-sizing: border-box; width: 100%; font: inherit; font-size: 13px; padding: 6px 8px;
  border-radius: 8px; resize: vertical;
  background: var(--dsw-alias-bg-module-platform, #353638);
  color: var(--dsw-alias-label-primary, #f9fafb);
  border: .5px solid var(--dsw-alias-border-l3, rgba(255,255,255,.16));
}

/* Running session: animate the label itself, never the whole row. */
html:not([data-rdsh-anim="none"]) [data-rdsh-running] [data-rdsh-status] { display: none !important; }
[data-rdsh-running] [data-rdsh-session-title] {
  position: relative; border-radius: 8px; isolation: isolate;
}
[data-rdsh-running] [data-rdsh-session-title]::before {
  content: ""; position: absolute; inset: -3px -6px; z-index: -1; border-radius: 8px;
  background: linear-gradient(100deg, rgba(122,170,255,0) 10%, rgba(122,170,255,.45) 42%, rgba(167,139,250,.40) 58%, rgba(122,170,255,0) 90%);
  background-size: 220% 100%;
  animation: rdsh-mux-aurora 3.6s ease-in-out infinite;
  filter: blur(4px); opacity: .95;
}
[data-rdsh-running] [data-rdsh-session-title]::after {
  content: ""; position: absolute; left: -7px; top: 4px; bottom: 4px; width: 2px; border-radius: 2px;
  background: linear-gradient(180deg, #7aaaff, #a78bfa);
  box-shadow: 0 0 8px rgba(122,170,255,.7);
  animation: rdsh-mux-pulse 2.4s ease-in-out infinite;
}
@keyframes rdsh-mux-aurora {
  0% { background-position: 120% 0; opacity: .35 }
  50% { background-position: -20% 0; opacity: .9 }
  100% { background-position: -120% 0; opacity: .35 }
}
@keyframes rdsh-mux-pulse { 0%,100% { opacity: .45 } 50% { opacity: 1 } }
/* Variant: a quiet breathing label with a left activity bar. */
html[data-rdsh-anim="breathing"] [data-rdsh-running] [data-rdsh-session-title]::before {
  background: none; filter: none; opacity: 0;
}
html[data-rdsh-anim="breathing"] [data-rdsh-running] [data-rdsh-session-title] {
  animation: rdsh-mux-breathe 5.6s ease-in-out infinite;
}
@keyframes rdsh-mux-breathe {
  0%, 100% { color: var(--dsw-alias-label-primary, #f9fafb); text-shadow: none }
  50% { color: var(--dsw-alias-label-secondary, #cfd3d6); text-shadow: 0 0 10px rgba(122,170,255,.35) }
}

/* Variant B of mockups/animation-outline.html. The animated layer is a
   normal transform rotation, not an @property angle inside a conic-gradient.
   Safari/iOS reliably animates transforms; custom-property interpolation in
   background images is the part that stayed static. */
html[data-rdsh-anim="outline"] [data-rdsh-running] [data-rdsh-session-title]::before,
html[data-rdsh-anim="outline"] [data-rdsh-running] [data-rdsh-session-title]::after { display: none !important; }
html[data-rdsh-anim="outline"] [data-rdsh-ring-row] {
  --rdsh-ring-fill: #1b1b1c;
  position: relative !important;
  isolation: isolate;
  overflow: hidden;
  border: 0 !important;
  border-radius: 12px !important;
  box-sizing: border-box;
  background: var(--rdsh-ring-fill) !important;
}
html[data-rdsh-anim="outline"] [data-rdsh-ring-row]::before {
  content: "";
  position: absolute;
  left: 50%; top: 50%;
  width: 170%; aspect-ratio: 1;
  z-index: 0;
  background: conic-gradient(
    from 0deg,
    rgba(122,170,255,0) 0deg,
    rgba(122,170,255,0) 215deg,
    rgba(122,170,255,.14) 235deg,
    rgba(140,185,255,.68) 268deg,
    #cfe0ff 292deg,
    rgba(122,170,255,.3) 315deg,
    rgba(122,170,255,0) 336deg,
    rgba(122,170,255,0) 360deg
  );
  transform: translate(-50%, -50%) rotate(0deg);
  animation: rdsh-ring-rotate 2.8s linear infinite;
  pointer-events: none;
}
html[data-rdsh-anim="outline"] [data-rdsh-ring-row]::after {
  content: "";
  position: absolute;
  inset: 2px;
  z-index: 0;
  border-radius: 10px;
  background: var(--rdsh-ring-fill);
  pointer-events: none;
}
html[data-rdsh-anim="outline"] [data-rdsh-ring-row] > * {
  position: relative;
  z-index: 1;
}
/* Yellow only while a running session is also the open one. */
html[data-rdsh-anim="outline"] [data-rdsh-ring-row][aria-selected="true"] {
  --rdsh-ring-fill: #2d2d2e;
}
html[data-rdsh-anim="outline"] [data-rdsh-ring-row][aria-selected="true"]::before {
  background: conic-gradient(
    from 0deg,
    rgba(255,209,102,0) 0deg,
    rgba(255,209,102,0) 215deg,
    rgba(255,209,102,.14) 235deg,
    rgba(255,224,130,.68) 268deg,
    #fff3c4 292deg,
    rgba(255,209,102,.3) 315deg,
    rgba(255,209,102,0) 336deg,
    rgba(255,209,102,0) 360deg
  );
}
html[data-rdsh-anim="outline"] [data-rdsh-ring-row]:hover:not([aria-selected="true"]) {
  --rdsh-ring-fill: #242425;
}
html[data-rdsh-anim="outline"] [data-rdsh-ring-row]:not([data-rdsh-session-frame]) {
  box-shadow: none !important;
}
/* An idle session that is merely open: a plain frame and a slightly lighter
   fill, with no sweep, so "open" and "working" stay distinguishable. */
html[data-rdsh-anim="outline"] [data-rdsh-open-row]:not([data-rdsh-ring-row]) {
  background: #232324 !important;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.2) !important;
  border-radius: 12px !important;
}
html[data-rdsh-anim="outline"] [data-rdsh-open-row]:not([data-rdsh-ring-row]):hover {
  background: #29292b !important;
}
/* A row with a user-chosen colour frame keeps that frame: only the fill moves. */
html[data-rdsh-anim="outline"] [data-rdsh-open-row][data-rdsh-session-frame]:not([data-rdsh-ring-row]) {
  box-shadow: inset 0 0 0 2px var(--rdsh-session-frame) !important;
}

/* The open session's title carries its running state: a light, slow sweep
   through the glyphs so a phone (where the sidebar is closed) still shows
   activity. The gradient is 3x the text and the position stays inside 0-100%,
   which is exactly the range that keeps it covering the element: a wider
   travel slides the highlight off the text and leaves the title invisible. */
@supports ((-webkit-background-clip: text) or (background-clip: text)) {
  [data-rdsh-header-title][data-rdsh-header-running] {
    background-image: linear-gradient(100deg,
      var(--dsw-alias-label-primary, #f9fafb) 0%,
      var(--dsw-alias-label-primary, #f9fafb) 38%,
      #dbe7ff 47%,
      #eef4ff 50%,
      #dbe7ff 53%,
      var(--dsw-alias-label-primary, #f9fafb) 62%,
      var(--dsw-alias-label-primary, #f9fafb) 100%);
    background-size: 300% 100%;
    background-repeat: no-repeat;
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    animation: rdsh-header-sheen 5.2s ease-in-out infinite;
  }
}
@keyframes rdsh-header-sheen {
  0% { background-position: 100% 0 }
  38% { background-position: 0% 0 }
  100% { background-position: 0% 0 }
}
@media (prefers-reduced-motion: reduce) {
  [data-rdsh-header-title][data-rdsh-header-running] {
    animation: none !important;
    background-image: none;
    -webkit-text-fill-color: currentColor;
  }
}

/* Notices: swipe up to dismiss. The component keeps pointer-events off so an
   announcement cannot intercept clicks; re-enable them only on our hook, which
   only exists while the gesture is available. */
[data-rdsh-toast] { pointer-events: auto; touch-action: none; }
[data-rdsh-toast][data-rdsh-toast-dismissed] {
  transform: translate(-50%, -170%) !important;
  opacity: 0 !important;
  pointer-events: none !important;
  transition: transform .24s cubic-bezier(.4, 0, 1, 1), opacity .24s linear !important;
}

/* A generated session name: animated over the (transparent) real text. */
[data-rdsh-typing] {
  position: relative;
  color: transparent !important;
  -webkit-text-fill-color: transparent !important;
  /* The running sheen paints the glyphs with a background, so an invisible
     fill is not enough: without this the real (new) text stays on screen and
     the erase reads as a caret moving over a name that never goes away. */
  background-image: none !important;
  -webkit-background-clip: border-box !important;
  background-clip: border-box !important;
}
[data-rdsh-typing-layer] {
  position: absolute;
  inset: 0;
  box-sizing: border-box;
  padding: inherit;
  color: var(--dsw-alias-label-primary, #f9fafb);
  -webkit-text-fill-color: currentColor;
  white-space: nowrap;
  overflow: hidden;
  pointer-events: none;
}
[data-rdsh-typing-caret] {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 1px;
  vertical-align: -0.14em;
  background: currentColor;
  animation: rdsh-typing-blink .8s steps(1, end) infinite;
}
@keyframes rdsh-typing-blink { 0%, 49% { opacity: 1 } 50%, 100% { opacity: 0 } }
@media (prefers-reduced-motion: reduce) {
  [data-rdsh-typing-caret] { animation: none !important; }
}
@keyframes rdsh-ring-rotate {
  to { transform: translate(-50%, -50%) rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  html[data-rdsh-anim="outline"] [data-rdsh-ring-row]::before { animation: none !important; }
}
html[data-rdsh-anim="none"] [data-rdsh-running] [data-rdsh-session-title]::before,
html[data-rdsh-anim="none"] [data-rdsh-running] [data-rdsh-session-title]::after { display: none; }

@media (prefers-reduced-motion: reduce) {
  [data-rdsh-running] [data-rdsh-session-title]::before { animation: none; opacity: .4 }
  [data-rdsh-running] [data-rdsh-session-title]::after { animation: none }
  html[data-rdsh-anim="breathing"] [data-rdsh-running] [data-rdsh-session-title] { animation: none; color: var(--dsw-alias-label-primary, #f9fafb) }
}

/* Safe-area insets measured at runtime: apply them even when the browser's
   display-mode query does not report standalone (iOS home-screen apps). */
html[data-rdsh-safe-top] #root { box-sizing: border-box; padding-top: env(safe-area-inset-top, 0px); }
html[data-rdsh-safe-bottom] #root { box-sizing: border-box; padding-bottom: env(safe-area-inset-bottom, 0px); }
/* iOS 26 standalone native gap: the home indicator is in the unpainted strip
   below the web view, so an inner bottom safe-area pad only widens the blank. */
html[data-rdsh-native-gap][data-rdsh-safe-bottom] #root { padding-bottom: 0 !important; }

@media (max-width: 767px) {
  /* The mockup proved 100% is the layout viewport (844) while the native web
     view is 797 on iOS 26; the body could pan 47px. 100dvh is the web view
     height, and the grid makes the app fill exactly that one row. */
  html, body {
    height: 100dvh !important;
    min-height: 100dvh !important;
    overflow: hidden !important;
    overscroll-behavior: none !important;
  }
  body { display: grid !important; grid-template-rows: 100dvh !important; }
  #root { height: 100% !important; min-height: 0 !important; box-sizing: border-box !important; }
  [data-rdsh-scroll] { overscroll-behavior-y: contain; }

  /* One slide for both sheets, so opening and closing read the same whether
     the session list or the preview moves. 300ms / standard easing is the
     app's own "slow" token, which the panel already used. */
  html {
    --rdsh-slide-ms: 300ms;
    --rdsh-slide-ease: cubic-bezier(.4, 0, .2, 1);
  }
  /* The preview's slide lives on its dock host. The trailing visibility step
     is the app's own: it keeps the element painted until the slide-out ends,
     and is dropped while open so it appears at once. */
  [data-dockkit-host] {
    transition: transform var(--rdsh-slide-ms) var(--rdsh-slide-ease), visibility 0s linear var(--rdsh-slide-ms) !important;
  }
  [data-sidebar-right-open] [data-dockkit-host] {
    transition: transform var(--rdsh-slide-ms) var(--rdsh-slide-ease) !important;
  }

  /* The drawer floats above the chat; the grid never gives it a column. */
  [data-rdsh-frame] { grid-template-columns: 0 minmax(0, 1fr) 0 !important; }
  [data-rdsh-frame]:not([data-sidebar-collapsed]) [data-rdsh-center-col] { grid-column: 2 !important; }
  [data-rdsh-frame]:not([data-sidebar-collapsed]) [data-rdsh-rightbar-col] { grid-column: 3 !important; }
  [data-rdsh-frame][data-rightbar-fullscreen] { grid-template-columns: 0 minmax(0, 1fr) 0 !important; }
  [data-rdsh-sidebar] {
    position: fixed !important; inset: 0 auto 0 0 !important;
    box-sizing: border-box;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
    width: 280px !important; max-width: 86vw; height: 100dvh !important; min-height: 100dvh;
    z-index: 50; overflow: hidden;
    transform: translateX(-104%);
    transition: transform var(--rdsh-slide-ms) var(--rdsh-slide-ease), box-shadow var(--rdsh-slide-ms) var(--rdsh-slide-ease);
    will-change: transform; background: var(--dsw-alias-bg-base, #1b1b1d);
  }
  /* The drop shadow lifts the drawer off the chat. It was removed once as the
     suspected "dark thing sliding in from the left"; the real cause was the
     chat column collapsing to 0px, which let an empty 390px column cover the
     screen. With that fixed the shadow is safe, and the dimmed backdrop keeps
     it from being the only separation. */
  html[data-rdsh-drawer="open"] [data-rdsh-sidebar] {
    transform: translateX(0);
    box-shadow: 24px 0 56px rgba(0,0,0,.5);
  }
  html[data-rdsh-drawer="open"] .rdsh-mux-backdrop { display: block; opacity: 1; pointer-events: auto; }
  .rdsh-mux-fab { display: flex; }
  html[data-rdsh-drawer="open"] .rdsh-mux-fab { display: none; }

  /* More trigger becomes a one-tap settings button. It is an overlay in the
     sidebar footer so the connection status keeps the full row. */
  [data-rdsh-more-row] { display: none !important; }
  [data-rdsh-more] > * { display: none !important; }
  [class*="yHnPSG_anchor"]:has([data-rdsh-more]) { position: relative; }
  [data-rdsh-more] {
    position: absolute !important;
    right: 4px; top: 50%;
    width: 36px !important; height: 36px !important; min-width: 0 !important;
    padding: 0 !important; margin: 0 !important;
    display: grid !important; place-items: center !important;
    border: .5px solid rgba(255,255,255,.14) !important;
    border-radius: 50% !important;
    background: rgba(44,44,46,.92) !important;
    box-shadow: 0 2px 8px rgba(0,0,0,.25);
    z-index: 6;
    transform: translateY(-50%);
    opacity: 0; pointer-events: none;
    transition: opacity .15s ease, background .15s ease;
  }
  [data-rdsh-more]:hover { background: rgba(70,70,74,.98) !important; }
  [data-rdsh-more]:active { transform: translateY(-50%) scale(.94); }
  [data-rdsh-sidebar]:hover [data-rdsh-more],
  [class*="yHnPSG_anchor"]:has([data-rdsh-more]):hover [data-rdsh-more],
  [class*="yHnPSG_anchor"]:has([data-rdsh-more]):focus-within [data-rdsh-more],
  [data-rdsh-more]:focus-visible {
    opacity: 1; pointer-events: auto;
  }
  [data-rdsh-more]::after {
    content: ""; width: 18px; height: 18px; display: block; margin: auto;
    background: currentColor;
    -webkit-mask: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7'%3E%3Ccircle cx='12' cy='12' r='3.2'/%3E%3Cpath d='M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z'/%3E%3C/svg%3E") center / contain no-repeat;
    mask: url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.7'%3E%3Ccircle cx='12' cy='12' r='3.2'/%3E%3Cpath d='M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z'/%3E%3C/svg%3E") center / contain no-repeat;
  }

  [data-rdsh-hidden],
  [data-rdsh-setting-hidden],
  [data-rdsh-settings-tab-hidden] { display: none !important; }
  [data-rdsh-settings-nav-arrow] {
    position: fixed; z-index: 1006; width: 30px; height: 30px;
    display: grid; place-items: center; padding: 0;
    border: .5px solid rgba(255,255,255,.16); border-radius: 50%;
    background: rgba(44,44,46,.94); color: var(--dsw-alias-label-primary, #f9fafb);
    box-shadow: 0 3px 12px rgba(0,0,0,.4);
    -webkit-tap-highlight-color: transparent;
  }
  [data-rdsh-settings-nav-arrow][hidden] { display: none !important; }
  [data-rdsh-settings-nav-arrow]:hover { background: rgba(70,70,74,.98); }
  [data-rdsh-settings-nav-arrow]:active { transform: scale(.94); }
  [data-rdsh-settings-nav-arrow] svg { width: 16px; height: 16px; }
  /* The stats dock (turns / tok/s / cache hit / context %) stays visible, but
     moves out of the composer's layout. The card can then sit in the safe-area
     strip instead of leaving a blank band below it, and the stats fill that
     strip. */
  html[data-rdsh-has-dock][data-rdsh-safe-bottom] #root { padding-bottom: 0 !important; }
  html[data-rdsh-has-dock] [data-rdsh-composer-root] {
    position: relative;
    padding-bottom: 31px !important; /* 27px dock + 4px */
  }
  [data-rdsh-composer-dock] {
    position: absolute !important;
    left: 16px; right: 16px; bottom: 4px;
    height: 27px; box-sizing: border-box;
    padding: 0 !important;
    align-items: center;
    z-index: 8;
    background: var(--dsw-alias-bg-base, #151517);
  }
  [data-rdsh-composer-dock] button {
    font-size: 11px !important;
    padding: 1px 2px !important;
    gap: 3px !important;
  }
  /* The app label includes steps / total tokens; show only the four requested
     values, with no ellipsis. */
  html[data-rdsh-context-probe] [role="dialog"][class*="_panel"] {
    visibility: hidden !important;
    pointer-events: none !important;
  }
  [data-rdsh-stat-text] > span { display: none !important; }
  [data-rdsh-stat-text]::after {
    content: attr(data-rdsh-stat-text);
    white-space: nowrap;
    font: inherit;
    color: inherit;
  }
  /* Three pills plus their icons stay on one row, centered inside the same
     16px gutters as the composer and transcript. */
  [data-rdsh-composer-dock] { gap: 2px !important; justify-content: center !important; }
  [data-rdsh-transcript] {
    padding-left: 16px !important;
    padding-right: 16px !important;
  }
  /* Keep the reasoning effort (Max etc.) visible; only the model name shrinks. */
  [data-rdsh-model-button] [class*="triggerLabel"] {
    flex: 1 1 auto !important;
    min-width: 0 !important;
  }
  [data-rdsh-model-button] [class*="triggerEffort"] {
    flex: 0 0 auto !important;
    width: auto !important;
    max-width: none !important;
    min-width: auto !important;
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  }
  [data-rdsh-transcript-column] {
    width: 349px !important;
    max-width: 100% !important;
    margin-left: auto !important;
    margin-right: auto !important;
  }
  [data-chat-flow-kind="turn-tail"] [class*="_header"] {
    padding-top: 6px !important;
    padding-bottom: 6px !important;
  }
  [data-chat-flow-kind="turn-tail"] [class*="_row"] {
    padding-top: 4px !important;
    padding-bottom: 4px !important;
  }
  /* The app caps a user bubble at 70.2% of the row. A little more room and
     padding makes the query bubble easier to read without touching replies. */
  [data-rdsh-user-stack] { max-width: 78% !important; }
  @media (max-width: 380px) {
    [data-rdsh-composer-dock] { gap: 0 !important; }
    [data-rdsh-composer-dock] button { font-size: 10px !important; padding: 1px 2px !important; }
  }
  /* Overlay UI belongs on top of the drawer's own chrome, not across it. */
  html[data-rdsh-drawer="open"] .rdsh-pwa-install,
  html[data-rdsh-drawer="open"] .rdsh-pwa-card { display: none; }
  /* The right sidebar menu owns the screen; the floating hamburger would sit
     on top of it (and keep its hover state). */
  html[data-rdsh-rightpanel-open] .rdsh-mux-fab { display: none !important; }

  /* Sessions: give the label the room the row actions used to take. */
  [data-rdsh-session] { padding-inline: 6px !important; }
  [data-rdsh-session] [data-rdsh-session-title] { margin-right: 4px !important; }
  [data-rdsh-row-minor] { display: none !important; }
  [data-rdsh-status-empty] { display: none; }
  [data-rdsh-header-chip] > span:nth-child(2) { display: none; }
  [data-rdsh-header-chip] > svg:last-child { display: none; }
  [data-rdsh-header] [class*="_titleCluster"] { min-width: 0; flex: 1 1 auto; }
  /* Pin the activity chips to the right edge of the header. Without this the
     actions block sits directly after the title, so a short session name drags
     both chips left with it. */
  [data-rdsh-header] [class*="_headerActions"] { margin-left: auto !important; }
  [data-rdsh-header] [class*="_crumbs"] { min-width: 48px; overflow: hidden; text-overflow: ellipsis; }
  [data-rdsh-session] [class*="_rowActions"] { display: flex; }
  /* Keep the row's own menu-open class in the exception list: without it the
     trigger is hidden while the portal measures it. */
  [data-rdsh-session]:not([aria-selected="true"]):not(:focus-within):not([class*="_menuOpen"]):not([data-rdsh-row-menu]) [class*="_rowActions"] { display: none; }

  /* Composer input dock (Todo, Goal, other pre-composer panels): 16px gutters. */
  [data-testid="todo-panel"],
  [class*="nLMEza_dock"],
  [data-slot="conversation.input.dock"] > * {
    width: calc(100% - 32px) !important;
    max-width: calc(100% - 32px) !important;
    margin-left: auto !important;
    margin-right: auto !important;
  }
  [class*="nLMEza_bar"] { max-width: 100% !important; }

  [data-rdsh-session][data-rdsh-row-menu] [class*="_rowActions"] { display: flex !important; }

  /* The long press belongs to the row menu, not to the system: no text
     selection and no iOS callout ("Copy", "Look Up", …) while holding a row.
     The app sets user-select on the row itself, but not on its children, and
     never disables the callout. */
  [data-rdsh-session],
  [data-rdsh-session] * {
    -webkit-user-select: none !important;
    user-select: none !important;
    -webkit-touch-callout: none !important;
  }

  /* Todo rows / goal objective open a full-text popover on tap. */
  [data-rdsh-todo-item],
  [data-rdsh-goal-objective] { cursor: pointer; }
  [data-rdsh-todo-item]:active,
  [data-rdsh-goal-objective]:active { opacity: .72; }

  /* Goal edit mode: stack save/cancel so the inline editor gets the width. */
  [data-rdsh-goal-editing] { align-items: stretch !important; }
  [data-rdsh-goal-editing] [data-rdsh-goal-actions] {
    flex-direction: column !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 2px !important;
  }
  [data-rdsh-goal-editing] [data-rdsh-goal-actions] > * { flex: none !important; }

  /* Shell/subagent header chips: icon + the same live spinner ring, no text. */
  [data-rdsh-activity-chip] {
    position: relative !important;
    width: 30px !important; height: 30px !important; min-width: 30px !important;
    padding: 0 !important; border-radius: 50% !important;
    display: grid !important; place-items: center !important;
    gap: 0 !important;
    color: var(--dsw-alias-label-secondary, #9ca3af);
    -webkit-tap-highlight-color: transparent;
  }
  [data-rdsh-activity-chip]:hover { background: rgba(255,255,255,.06); }
  [data-rdsh-activity-chip] > span:not([data-rdsh-activity-icon]):not([data-rdsh-activity-spinner]) { display: none !important; }
  [data-rdsh-activity-chip] > svg:not([data-rdsh-activity-spinner]) { display: none !important; }
  [data-rdsh-activity-chip] [data-rdsh-activity-spinner] {
    position: absolute !important; inset: 3px !important;
    width: 24px !important; height: 24px !important;
    margin: auto !important; pointer-events: none;
  }
  [data-rdsh-activity-chip] [data-rdsh-activity-spinner] svg { width: 100% !important; height: 100% !important; }
  [data-rdsh-activity-chip] [data-rdsh-activity-icon] {
    position: relative; z-index: 1; width: 13px; height: 13px;
    display: grid; place-items: center;
  }
  [data-rdsh-activity-chip] [data-rdsh-activity-icon] svg { width: 13px; height: 13px; }
  .rdsh-activity-ring {
    display: block; border: 1.6px solid rgba(255,255,255,.16);
    border-top-color: var(--dsw-alias-state-success-primary, #22c55e);
    border-radius: 50%;
    animation: rdsh-activity-spin 1s linear infinite;
  }
  @keyframes rdsh-activity-spin { to { transform: rotate(360deg); } }

  /* Settings: full screen, stacked navigation, nothing narrowed. */
  /* Close lives on the top row with the Settings title, as a round button. */
  [data-shortcut-modal="settings"] [class*="VOzbGW_close"] {
    position: fixed !important;
    top: calc(env(safe-area-inset-top, 0px) + 12px) !important;
    right: 12px !important;
    width: 36px !important; height: 36px !important;
    padding: 0 !important;
    display: grid !important; place-items: center !important;
    border: .5px solid rgba(255,255,255,.14) !important;
    border-radius: 50% !important;
    background: rgba(44,44,46,.92) !important;
    color: var(--dsw-alias-label-primary) !important;
    box-shadow: 0 2px 8px rgba(0,0,0,.25);
    z-index: 1007 !important;
  }
  [data-shortcut-modal="settings"] [class*="VOzbGW_close"]:hover { background: rgba(70,70,74,.98) !important; }
  [data-shortcut-modal="settings"] [class*="VOzbGW_close"] svg { width: 18px !important; height: 18px !important; }

  /* Tab names fade toward a scrollable edge, so the floating arrows never
     sit on top of a hard-cut label. The flags are set by positionSettingsArrows. */
  [data-shortcut-modal="settings"] [class*="VOzbGW_navList"][data-rdsh-fade-left] {
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 64px);
    mask-image: linear-gradient(to right, transparent 0, #000 64px);
  }
  [data-shortcut-modal="settings"] [class*="VOzbGW_navList"][data-rdsh-fade-right] {
    -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 72px), transparent 100%);
    mask-image: linear-gradient(to right, #000 calc(100% - 72px), transparent 100%);
  }
  [data-shortcut-modal="settings"] [class*="VOzbGW_navList"][data-rdsh-fade-left][data-rdsh-fade-right] {
    -webkit-mask-image: linear-gradient(to right, transparent 0, #000 64px, #000 calc(100% - 72px), transparent 100%);
    mask-image: linear-gradient(to right, transparent 0, #000 64px, #000 calc(100% - 72px), transparent 100%);
  }

  /* The settings panel is fully opaque on a phone; the blurred mask was the
     source of the iOS flash on each tab repaint. */
  [data-shortcut-modal="settings"] [class*="VOzbGW_mask"] {
    -webkit-backdrop-filter: none !important;
    backdrop-filter: none !important;
  }
  [data-shortcut-modal="settings"],
  [data-shortcut-modal="settings"] [class*="VOzbGW_options"] {
    -webkit-transform: translateZ(0);
    transform: translateZ(0);
    -webkit-backface-visibility: hidden;
    backface-visibility: hidden;
  }

  [data-shortcut-modal="settings"] {
    position: absolute !important;
    inset: 0 !important;
    width: 100% !important;
    max-width: none !important;
    height: 100% !important;
    max-height: none !important;
    border-radius: 0 !important;
    box-sizing: border-box !important;
    flex-direction: column;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  [data-shortcut-modal="settings"] > nav {
    width: 100%; padding: 16px 12px 0; gap: 8px;
    border-bottom: .5px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));
  }
  [data-shortcut-modal="settings"] > nav > div:last-child {
    flex-direction: row; overflow-x: auto; overflow-y: hidden; gap: 6px;
    margin-top: 10px; padding-bottom: 10px;
    scrollbar-width: none;
    border-top: .5px solid var(--dsw-alias-border-l2, rgba(255,255,255,.12));
  }
  [data-shortcut-modal="settings"] > nav > div:last-child::-webkit-scrollbar { display: none; }
  [data-shortcut-modal="settings"] > nav > div:last-child button { flex: none; }
  [data-shortcut-modal="settings"] > nav + div { min-height: 0; }
  /* The close is fixed to the title row now; the old header row only held
     "Open configuration file" (a desktop action). Collapse it so the content
     begins directly at the tab strip. */
  [data-shortcut-modal="settings"] > nav + div > div:first-child {
    height: 0 !important; min-height: 0 !important; padding: 0 !important;
    overflow: visible;
  }
  [data-shortcut-modal="settings"] > nav + div > div:first-child [class*="VOzbGW_actions"] { display: none !important; }
  [data-shortcut-modal="settings"] > nav + div > div:last-child { padding: 0 12px 16px; }

  /* Settings: theme tiles side by side, never crushed. */
  [data-shortcut-modal="settings"] [class*="_8HJdBW_group"] { align-items: stretch !important; }
  [data-shortcut-modal="settings"] [class*="_8HJdBW_cubeRow"] {
    flex-direction: row !important; flex-wrap: nowrap !important;
    height: auto !important; align-items: stretch !important; gap: 8px !important;
  }
  [data-shortcut-modal="settings"] [class*="_8HJdBW_cubeRow"] > * {
    flex: 1 1 0 !important; width: auto !important; min-width: 0 !important;
    height: auto !important; min-height: 88px !important;
    padding: 12px 6px !important; box-sizing: border-box !important;
  }
  [data-shortcut-modal="settings"] [class*="_8HJdBW_cubeRow"] > * > * { max-width: 100%; }

  /* Hide the PC-only rows before their tab paints, so switching back to
     General never flashes them. Sounds stays: it is useful in the PWA too. */
  html[data-rdsh-hide-settings] [data-shortcut-modal="settings"] .nhfO0a_setting,
  html[data-rdsh-hide-settings] [data-shortcut-modal="settings"] [class*="Pt1bsG_row"],
  html[data-rdsh-hide-settings] [data-shortcut-modal="settings"] [class*="dswsnd-row"]:has([class*="dswsnd-actions"]) { display: none !important; }

  /* Settings: no accidental horizontal scrolling in tab panels. */
  [data-shortcut-modal="settings"] [class*="VOzbGW_options"] {
    overflow-x: hidden !important;
    scrollbar-gutter: stable;
  }
  [data-shortcut-modal="settings"] [class*="rtSEdW_section"],
  [data-shortcut-modal="settings"] [class*="rtSEdW_group"],
  [data-shortcut-modal="settings"] [class*="rtSEdW_cards"],
  [data-shortcut-modal="settings"] [class*="rtSEdW_card"],
  [data-shortcut-modal="settings"] [class*="rtSEdW_cardFoot"] {
    min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important;
  }
  [data-shortcut-modal="settings"] [class*="rtSEdW_cardFoot"] { flex-wrap: wrap !important; overflow: hidden; }
  [data-shortcut-modal="settings"] [class*="rtSEdW_iconButton"] { overflow: hidden; }

  /* Settings > Models: shrink provider names, never collide with actions. */
  [data-shortcut-modal="settings"] [class*="zGbnIq_rowCard"] { min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important; }
  [data-shortcut-modal="settings"] [class*="zGbnIq_rowHead"] { min-width: 0 !important; gap: 8px !important; }
  [data-shortcut-modal="settings"] [class*="zGbnIq_rowIdentity"] { min-width: 0 !important; overflow: hidden; }
  [data-shortcut-modal="settings"] [class*="zGbnIq_rowName"] { min-width: 0 !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  [data-shortcut-modal="settings"] [class*="zGbnIq_rowActions"] { flex-shrink: 0; gap: 6px; }
  [data-shortcut-modal="settings"] [class*="zGbnIq_rowActions"] button { padding-left: 10px !important; padding-right: 10px !important; }

  /* Model picker: value never runs into the chevron. */
  [class*="_7KE1Ra_menu"] { max-width: calc(100vw - 24px) !important; box-sizing: border-box !important; }
  [class*="_7KE1Ra_cell"] { min-width: 0 !important; gap: 8px !important; }
  [class*="_7KE1Ra_cell"] > span:last-of-type { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  [data-rdsh-model-search]:disabled { opacity: 1 !important; cursor: text; }

  /* Agent question / plan review card: use the same 16px gutter and 349px
     column as the transcript instead of the desktop card paddings. */
  [data-rdsh-question-frame] {
    padding-left: 16px !important; padding-right: 16px !important;
    padding-bottom: 10px !important;
  }
  [data-rdsh-question-frame] > [data-rdsh-question-card] {
    width: 100% !important; max-width: 349px !important; margin-left: auto !important; margin-right: auto !important;
  }
  [data-rdsh-question-card] [class*="_header"] { padding: 12px 12px 0 16px !important; }
  [data-rdsh-question-card] [class*="_strip"] { padding: 10px 12px !important; }
  [data-rdsh-question-card] [class*="_summary"] { padding: 12px 16px !important; }
  [data-rdsh-question-card] [class*="_options"] { padding: 4px 8px !important; }
  [data-rdsh-question-card] [class*="_option"],
  [data-rdsh-question-card] [class*="_customRow"] { padding: 8px !important; }
  [data-rdsh-question-card] [class*="_footer"] { padding: 8px 10px 10px !important; }
  [data-rdsh-question-card] [class*="_customBlock"] { margin-left: 8px !important; margin-right: 8px !important; }

  /* iOS zooms any focused field below 16px; this is a PWA and needs no zoom. */
  html, body { touch-action: manipulation; }
  input, textarea, [contenteditable="true"] {
    font-size: 16px !important;
    touch-action: manipulation;
  }

  /* Edit summary: tighter rows. */
  [data-rdsh-edit-header] { height: 44px !important; min-height: 44px !important; padding: 4px 10px !important; }
  [data-rdsh-edit-row] { height: 26px !important; padding-top: 2px !important; padding-bottom: 2px !important; }

  /* Right panel: never wider than the phone, wide tables scroll inside it. */
  [data-rdsh-rightpanel] {
    max-width: 100vw !important; overflow-x: hidden;
    box-sizing: border-box;
    padding-top: 0 !important;
    padding-bottom: calc(env(safe-area-inset-bottom, 0px) + var(--rdsh-native-gap-px, 0px)) !important;
  }
  /* The preview's close control is drawn as a panel glyph, which reads as
     "collapse this pane" rather than "leave the preview". Swap it for an X,
     the same glyph the tab close buttons already use. */
  [data-rdsh-rightpanel] [aria-label="Collapse right sidebar"] svg,
  [aria-label="Collapse right sidebar"] svg { display: none !important; }
  [aria-label="Collapse right sidebar"]::before {
    content: ""; width: 16px; height: 16px; display: block;
    background: currentColor;
    -webkit-mask: var(--rdsh-close-mask) center / contain no-repeat;
    mask: var(--rdsh-close-mask) center / contain no-repeat;
  }
  html { --rdsh-close-mask: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><path d='M3.6 3.6 12.4 12.4M12.4 3.6 3.6 12.4' stroke='black' stroke-width='1.7' stroke-linecap='round'/></svg>"); }

  /* The preview sheet covers the app header; keeping the mobile header in flow
     left a dead band above the full-screen preview. */
  html[data-rdsh-rightpanel-open] header[data-rdsh-header] { display: none !important; }
  [data-rdsh-rightpanel] table { display: block; overflow-x: auto; max-width: 100%; }
  [data-rdsh-rightpanel] pre { max-width: 100%; }

  /* Code files: wrap every line, including a single long token (URLs,
     minified lines). Wrapping only at spaces left those overflowing, which
     turned the viewer into a free two-axis scroller.
     The lines are their own boxes: .line carries
     "white-space: var(--dsl-code-block-line-white-space, pre)", so styling
     pre alone left them unwrapped (and the horizontal lock clipped them). */
  /* Do NOT style the code element: the newline text nodes between the .line
     spans live there, and giving them pre-wrap painted an empty row between
     every line (19px -> 38px). The lines carry their own content. */
  [data-rdsh-rightpanel] [data-textpreview-body] pre,
  [data-rdsh-rightpanel] [data-textpreview-body] pre .line {
    white-space: pre-wrap !important;
    overflow-wrap: anywhere !important;
    word-break: break-word !important;
  }
  /* ...and the code scroller itself keeps no sideways travel. */
  [data-rdsh-code-scroll] { overflow-x: hidden !important; }
  /* Wrapping is forced above, so the viewer's own toggle no longer changes
     anything. Hide it rather than leave a control that does nothing. */
  [data-rdsh-rightpanel] [data-textpreview-tool="wrap"] { display: none !important; }

  /* The native strip already contains the home indicator. */
  html[data-rdsh-native-gap] [data-rdsh-sidebar],
  html[data-rdsh-native-gap] [data-rdsh-rightpanel],
  html[data-rdsh-native-gap] [data-shortcut-modal="settings"] { padding-bottom: 0 !important; }
  html[data-rdsh-native-gap] .rdsh-mux-sheet { bottom: 4px; }
}
`;

    // ---------------------------------------------------------------------
    // Wiring
    // ---------------------------------------------------------------------
    let booted = false;

    function ensureRightPanelFits() {
      if (!narrow()) return;
      const enter = document.querySelector('[aria-label="Enter fullscreen"]');
      if (enter !== null) {
        // A docked panel squeezes the chat on a phone: promote it once.
        if (enter.getAttribute("data-rdsh-auto-fired") !== "1") {
          enter.setAttribute("data-rdsh-auto-fired", "1");
          enter.click();
        }
      }
    }

    function boot(ctx) {
      if (booted) return;
      booted = true;

      ctx.effect(() => {
        const style = document.createElement("style");
        style.setAttribute("data-rdsh-mux-style", "");
        style.textContent = CSS;
        document.head.append(style);

        installDrawer();
        document.documentElement.setAttribute("data-rdsh-anim", ANIMATION);

        const observer = new MutationObserver(scheduleDecorate);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-label", "aria-selected", "data-state", "draggable"] });

        document.addEventListener("pointerdown", onPointerDown, true);
        document.addEventListener("pointermove", onPointerMove, true);
        document.addEventListener("focusout", onModelFocusOut, true);
        document.addEventListener("pointerup", onPointerUp, true);
        document.addEventListener("mousedown", onMouseDownCapture, true);
        document.addEventListener("click", onClickCapture, true);
        // Window capture runs before the app's document-level key adapter. That
        // adapter treats a keyCode 229 Return as IME input and consumes it, so a
        // listener on document never gets the chance to insert a newline.
        window.addEventListener("keydown", onKeyDownCapture, true);
        document.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
        document.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
        document.addEventListener("scroll", recordScroll, true);
        measureSafeArea();
        const onResize = () => {
          // Do not close the attach sheet here: opening it blurs the composer,
          // and the resulting keyboard-close resize would remove it instantly.
          measureSafeArea();
        };
        window.addEventListener("resize", onResize);
        window.addEventListener("orientationchange", onResize);
        patchCommandUi(ctx);
        document.addEventListener("dragstart", onDragStartCapture, true);
        document.addEventListener("dragend", onDragEndCapture, true);
        document.addEventListener("dblclick", onSessionTitleDoubleClick, true);
        document.addEventListener("contextmenu", onSessionContextMenu, true);
        document.addEventListener("touchstart", onEdgeSwipeStart, true);
        document.addEventListener("touchmove", onEdgeSwipeMove, { capture: true, passive: false });
        document.addEventListener("touchend", onEdgeSwipeEnd, true);
        document.addEventListener("touchcancel", onEdgeSwipeEnd, true);
        document.addEventListener("keydown", onKeyDown);
        document.addEventListener("pointerdown", onFocusPointer, true);
        document.addEventListener("focusin", onFocusInGuard, true);
        if (narrow()) {
          const initial = textBoxOf(document.activeElement);
          if (initial !== null) setTimeout(() => { if (document.activeElement === initial) initial.blur(); }, 0);
        }
        const media = window.matchMedia(NARROW_QUERY);
        const onMedia = () => {
          emit({ narrow: media.matches });
          scheduleDecorate();
        };
        media.addEventListener("change", onMedia);

        scheduleDecorate();
        void refreshNotificationStatus();

        globalThis.__RDSH_MOBILE_UX__ = {
          get state() { return { ...state }; },
          get badgeCount() { return notificationTotal; },
          applyNotificationCount,
          build: BUILD,
          get lastScrolls() { return [...lastScrolls]; },
          scrollables,
          scrollChain,
          autoSettings: true,
          decorate: scheduleDecorate,
          closeDrawer,
          openDrawer: toggleDrawer,
          enableNotifications,
          sendTestNotification,
        };

        return () => {
          observer.disconnect();
          document.removeEventListener("pointerdown", onPointerDown, true);
          document.removeEventListener("pointerup", onPointerUp, true);
          document.removeEventListener("mousedown", onMouseDownCapture, true);
          document.removeEventListener("click", onClickCapture, true);
          window.removeEventListener("keydown", onKeyDownCapture, true);
          document.removeEventListener("touchstart", onTouchStart, true);
          document.removeEventListener("touchmove", onTouchMove, true);
          document.removeEventListener("scroll", recordScroll, true);
          window.removeEventListener("resize", onResize);
          window.removeEventListener("orientationchange", onResize);
          document.removeEventListener("dragstart", onDragStartCapture, true);
          document.removeEventListener("dragend", onDragEndCapture, true);
          document.removeEventListener("dblclick", onSessionTitleDoubleClick, true);
          document.removeEventListener("contextmenu", onSessionContextMenu, true);
          document.removeEventListener("touchstart", onEdgeSwipeStart, true);
          document.removeEventListener("touchmove", onEdgeSwipeMove, true);
          document.removeEventListener("touchend", onEdgeSwipeEnd, true);
          document.removeEventListener("touchcancel", onEdgeSwipeEnd, true);
          document.removeEventListener("keydown", onKeyDown);
          document.removeEventListener("pointerdown", onFocusPointer, true);
          document.removeEventListener("focusin", onFocusInGuard, true);
          media.removeEventListener("change", onMedia);
          style.remove();
          rightPanelWatch?.disconnect();
          rightPanelIO?.disconnect();
          rightPanelWatch = null;
          rightPanelIO = null;
          rightPanelNode = null;
          settingsArrows?.left.remove();
          settingsArrows?.right.remove();
          settingsArrows = null;
          document.documentElement.removeAttribute("data-rdsh-rightpanel-open");
          document.documentElement.removeAttribute("data-rdsh-anim");
          fab?.remove();
          backdrop?.remove();
          fab = null;
          backdrop = null;
          delete globalThis.__RDSH_MOBILE_UX__;
          booted = false;
        };
      }, "rdsh-mobile-ux: phone layout");
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        try {
          boot(ctx);
        } catch (error) {
          console.error("[rdsh-mobile-ux] boot failed", error);
          emit({ bootError: String((error && error.message) || error) });
        }
        ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({
          name: "sidebar.workspaces.session.menu.item",
          id: "rdsh-color-frame",
          order: 150,
        }, ColorFrameMenuItem));
        ctx.slots.inject("shell.overlay", () => ctx.slots.register({
          name: "shell.overlay",
          id: "rdsh-mobile-ux-notifications",
          order: 92,
        }, NotificationWatcher));
        ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
          name: "conversation.composer.dock",
          id: "rdsh-mobile-ux-live-speed",
          order: 2,
          inject: (sessionId) => ({ sessionId }),
        }, LiveSpeed));
        ctx.slots.inject("settings.section", () => ctx.slots.register({
          name: "settings.section",
          id: "mobile-ux",
          order: 81,
          label: () => "モバイル",
        }, MobileSection));
        ctx.slots.inject("settings.section", () => ctx.slots.register({
          name: "settings.section",
          id: "mobile-ux-input",
          order: 82,
          label: () => "入力",
        }, InputSection));
      },
    };
  },
});
