const aiBrowserSession = {
  open: false,
  active: false,
  url: "about:blank",
  title: "New Tab",
  loading: false,
  screenshot: "",
  lastAction: "idle",
  lastHighlight: null,
  actions: [],
  domSummary: [],
  logs: [],
  canGoBack: false,
  canGoForward: false,
  proxyPort: 0,
  stealth: false,
  browserLabel: "",
  installing: false,
  installStatus: "",
};

const aiBrowserRuntime = {
  playwright: null,
  browser: null,
  context: null,
  page: null,
  cdp: null,
  executablePath: "",
  browserLabel: "",
  proxyPort: 0,
  bypassProxy: false,
  stealth: false,
  launchStealth: false,
  appliedStealth: false,
  consoleLogs: [],
  networkRequests: new Map(),
  harEntries: [],
  harStartedAt: "",
  lastFrameAt: 0,
  emitFn: null,
  inputCaptureTimer: null,
  installChild: null,
  closing: false,
  launchPromise: null,
  installPromise: null,
};

const AI_BROWSER_EMOJI_ZWJ_RE = /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u2600-\u27BF])(?:\uFE0F|\uFE0E|[\u{1F3FB}-\u{1F3FF}])?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u2600-\u27BF])(?:\uFE0F|\uFE0E|[\u{1F3FB}-\u{1F3FF}])?)+/gu;
const AI_BROWSER_EMOJI_KEYCAP_RE = /[0-9#*]\uFE0F?\u20E3/gu;
const AI_BROWSER_EMOJI_SUPP_RE = /[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/gu;
const AI_BROWSER_EMOJI_PICT_RE = /\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?/gu;
const AI_BROWSER_EMOJI_PRES_RE = /\p{Emoji_Presentation}(?:\uFE0F|\uFE0E)?/gu;
const AI_BROWSER_EMOJI_BMP_RE = /[\u231A-\u23FF\u2600-\u27BF\u2B05-\u2B55][\uFE0E\uFE0F]?|[\u2139\u2194-\u21AA\u24C2\u25AA-\u25FE\u2934-\u2935\u3030\u303D\u3297\u3299]\uFE0F|[\uFE0E\uFE0F\u20E3]/gu;

function aiBrowserStripEmojis(text) {
  const raw = String(text ?? "");
  const cleaned =
    typeof aiStripAllEmojis === "function"
      ? aiStripAllEmojis(raw, true)
      : raw
          .replace(AI_BROWSER_EMOJI_ZWJ_RE, "")
          .replace(AI_BROWSER_EMOJI_KEYCAP_RE, "")
          .replace(AI_BROWSER_EMOJI_SUPP_RE, "")
          .replace(AI_BROWSER_EMOJI_PICT_RE, "")
          .replace(AI_BROWSER_EMOJI_PRES_RE, "")
          .replace(AI_BROWSER_EMOJI_BMP_RE, "")
          .replace(/[\uD800-\uDFFF]/g, "");
  return cleaned.replace(/[ \t]{2,}/g, " ").trim();
}

function aiBrowserClampHighlight(box, label, action) {
  if (!box || !Number.isFinite(Number(box.x)) || !Number.isFinite(Number(box.y))) return null;
  const rawW = Number(box.width ?? box.w ?? 0);
  const rawH = Number(box.height ?? box.h ?? 0);
  if (rawW <= 0 || rawH <= 0) return null;
  const x = Math.max(0, Math.min(1279, Math.round(Number(box.x))));
  const y = Math.max(0, Math.min(799, Math.round(Number(box.y))));
  const width = Math.max(4, Math.min(1280 - x, Math.round(rawW)));
  const height = Math.max(4, Math.min(800 - y, Math.round(rawH)));
  return {
    x,
    y,
    width,
    height,
    action: aiBrowserStripEmojis(String(action || "")) || "action",
    target: aiBrowserStripEmojis(String(label || "")).slice(0, 60),
    timestamp: Date.now(),
  };
}

function aiBrowserParseQueryString(urlStr) {
  try {
    const parsed = new URL(String(urlStr || ""));
    const out = [];
    for (const [name, value] of parsed.searchParams.entries()) {
      out.push({ name, value });
    }
    return out;
  } catch {
    return [];
  }
}

const AI_BROWSER_SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
]);

function aiBrowserRedactHarHeaders(headers) {
  const out = [];
  if (Array.isArray(headers)) {
    for (const h of headers) {
      if (!h || !h.name) continue;
      const name = String(h.name);
      const sensitive = AI_BROWSER_SENSITIVE_HEADERS.has(name.toLowerCase());
      out.push({ name, value: sensitive ? "[REDACTED]" : String(h.value ?? "") });
    }
    return out;
  }
  if (headers && typeof headers === "object") {
    for (const [name, value] of Object.entries(headers)) {
      const sensitive = AI_BROWSER_SENSITIVE_HEADERS.has(name.toLowerCase());
      out.push({ name, value: sensitive ? "[REDACTED]" : String(value ?? "") });
    }
  }
  return out;
}

function aiBrowserStealthInitScript() {
  return () => {
    try {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined, configurable: true });
    } catch {}
    try {
      if (!navigator.languages || navigator.languages.length === 0) {
        Object.defineProperty(navigator, "languages", { get: () => ["en-US", "en"], configurable: true });
      }
    } catch {}
    try {
      if (!navigator.plugins || navigator.plugins.length === 0) {
        Object.defineProperty(navigator, "plugins", {
          get: () => [
            { name: "Chrome PDF Plugin", filename: "internal-pdf-viewer", description: "Portable Document Format" },
            { name: "Chrome PDF Viewer", filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai", description: "" },
            { name: "Native Client", filename: "internal-nacl-plugin", description: "" },
          ],
          configurable: true,
        });
      }
    } catch {}
    try {
      if (!window.chrome) {
        Object.defineProperty(window, "chrome", {
          value: { runtime: {}, app: { isInstalled: false } },
          configurable: true,
        });
      }
    } catch {}
    try {
      if (navigator.permissions && typeof navigator.permissions.query === "function") {
        const origQuery = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (parameters) =>
          parameters && parameters.name === "notifications"
            ? Promise.resolve({ state: typeof Notification !== "undefined" ? Notification.permission : "default" })
            : origQuery(parameters);
      }
    } catch {}
  };
}

function aiBrowserStealthUserAgent() {
  if (process.platform === "darwin") {
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  if (process.platform === "linux") {
    return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  }
  return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
}

function aiBrowserBuildHarLog(opts = {}) {
  const limit = Math.max(1, Math.min(500, Number(opts.limit) || 500));
  const filter = String(opts.urlFilter || "").trim().toLowerCase();
  const filtered = filter
    ? aiBrowserRuntime.harEntries.filter((entry) => String(entry?.request?.url || "").toLowerCase().includes(filter))
    : aiBrowserRuntime.harEntries;
  return {
    log: {
      version: "1.2",
      creator: { name: "Wide AI Browser", version: "1.0" },
      pages: [
        {
          startedDateTime: aiBrowserRuntime.harStartedAt || new Date().toISOString(),
          id: "page_1",
          title: aiBrowserStripEmojis(aiBrowserSession.title || aiBrowserSession.url || "New Tab") || "New Tab",
          pageTimings: { onContentLoad: -1, onLoad: -1 },
        },
      ],
      entries: filtered.slice(-limit),
    },
  };
}

function aiBrowserBroadcast(payload) {
  if (typeof aiBrowserRuntime.emitFn === "function") {
    try {
      aiBrowserRuntime.emitFn(payload);
      return;
    } catch {
      aiBrowserRuntime.emitFn = null;
    }
  }
  try {
    if (typeof broadcast === "function") {
      broadcast("ai:event", payload);
    }
  } catch {
    void 0;
  }
}

function aiBrowserRequirePlaywright() {
  if (aiBrowserRuntime.playwright) return aiBrowserRuntime.playwright;
  const candidates = ["playwright-core"];
  try {
    const base = typeof appRoot === "function" ? appRoot() : node_path.resolve(__dirname, "..", "..");
    candidates.push(node_path.join(base, "node_modules", "playwright-core"));
  } catch {
    void 0;
  }
  candidates.push(node_path.join(process.cwd(), "node_modules", "playwright-core"));
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      if (mod && mod.chromium) {
        aiBrowserRuntime.playwright = mod;
        return mod;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`playwright-core is not available: ${String(lastError?.message || lastError || "not found")}`);
}

function aiBrowserDetectInstalled() {
  const candidates = [];
  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || node_path.join(node_os.homedir(), "AppData", "Local");
    candidates.push(
      { label: "Google Chrome", kind: "chrome", path: node_path.join(pf, "Google", "Chrome", "Application", "chrome.exe") },
      { label: "Google Chrome", kind: "chrome", path: node_path.join(pf86, "Google", "Chrome", "Application", "chrome.exe") },
      { label: "Google Chrome", kind: "chrome", path: node_path.join(local, "Google", "Chrome", "Application", "chrome.exe") },
      { label: "Microsoft Edge", kind: "edge", path: node_path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe") },
      { label: "Microsoft Edge", kind: "edge", path: node_path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe") },
      { label: "Microsoft Edge", kind: "edge", path: node_path.join(local, "Microsoft", "Edge", "Application", "msedge.exe") },
      { label: "Brave", kind: "brave", path: node_path.join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe") },
      { label: "Brave", kind: "brave", path: node_path.join(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe") },
      { label: "Chromium", kind: "chromium", path: node_path.join(local, "Chromium", "Application", "chrome.exe") }
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      { label: "Google Chrome", kind: "chrome", path: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" },
      { label: "Microsoft Edge", kind: "edge", path: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" },
      { label: "Brave", kind: "brave", path: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" },
      { label: "Chromium", kind: "chromium", path: "/Applications/Chromium.app/Contents/MacOS/Chromium" }
    );
  } else {
    candidates.push(
      { label: "Google Chrome", kind: "chrome", path: "/usr/bin/google-chrome" },
      { label: "Google Chrome", kind: "chrome", path: "/usr/bin/google-chrome-stable" },
      { label: "Chromium", kind: "chromium", path: "/usr/bin/chromium" },
      { label: "Chromium", kind: "chromium", path: "/usr/bin/chromium-browser" },
      { label: "Microsoft Edge", kind: "edge", path: "/usr/bin/microsoft-edge" },
      { label: "Brave", kind: "brave", path: "/usr/bin/brave-browser" }
    );
  }

  for (const item of candidates) {
    try {
      if (item.path && node_fs.existsSync(item.path)) {
        return { installed: true, executablePath: item.path, kind: item.kind, label: item.label };
      }
    } catch {
      void 0;
    }
  }

  try {
    const pw = aiBrowserRequirePlaywright();
    const bundled = pw.chromium.executablePath();
    if (bundled && node_fs.existsSync(bundled)) {
      return { installed: true, executablePath: bundled, kind: "playwright", label: "Chromium" };
    }
  } catch {
    void 0;
  }

  return { installed: false, executablePath: "", kind: "", label: "" };
}

function aiBrowserCliPath() {
  const roots = [];
  try {
    const base = typeof appRoot === "function" ? appRoot() : node_path.resolve(__dirname, "..", "..");
    roots.push(node_path.join(base, "node_modules", "playwright-core", "cli.js"));
  } catch {
    void 0;
  }
  roots.push(node_path.join(process.cwd(), "node_modules", "playwright-core", "cli.js"));
  for (const candidate of roots) {
    if (node_fs.existsSync(candidate)) return candidate;
  }
  return "";
}

async function aiBrowserInstallChromium(emit) {
  if (aiBrowserRuntime.installPromise) return aiBrowserRuntime.installPromise;
  const cli = aiBrowserCliPath();
  if (!cli) {
    return { ok: false, error: "playwright-core installer CLI was not found." };
  }

  aiBrowserSession.installing = true;
  aiBrowserSession.installStatus = "Downloading Chromium browser runtime...";
  aiBrowserBroadcast({
    type: "browser_action",
    action: "status",
    url: aiBrowserSession.url,
    title: "Installing Chromium",
    status: aiBrowserSession.installStatus,
    installing: true,
    timestamp: Date.now(),
  });
  if (typeof emit === "function") {
    try { emit({ type: "status", text: aiBrowserSession.installStatus }); } catch {}
  }

  aiBrowserRuntime.installPromise = new Promise((resolve) => {
    let settled = false;
    const child = node_child_process.spawn(process.execPath, [cli, "install", "chromium"], {
      windowsHide: true,
      env: { ...process.env, CI: "1" },
    });
    aiBrowserRuntime.installChild = child;
    let output = "";
    const finish = (res) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      aiBrowserRuntime.installChild = null;
      aiBrowserSession.installing = false;
      resolve(res);
    };
    const timeoutTimer = setTimeout(() => {
      try { killProcessTree(child); } catch {}
      aiBrowserSession.installStatus = "Chromium installation timed out after 180s.";
      finish({ ok: false, error: aiBrowserSession.installStatus });
    }, 180000);
    timeoutTimer.unref?.();
    const pushLine = (chunk) => {
      const text = chunk.toString("utf8");
      output = (output + text).slice(-16384);
      const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const last = lines[lines.length - 1];
      if (last) {
        aiBrowserSession.installStatus = last.slice(0, 140);
        try {
          if (typeof broadcast === "function") {
            broadcast("ai:browserProgress", { status: aiBrowserSession.installStatus, installing: true });
          }
        } catch {
          void 0;
        }
      }
    };
    child.stdout?.on("data", pushLine);
    child.stderr?.on("data", pushLine);
    child.on("error", (err) => {
      aiBrowserSession.installStatus = String(err.message || err);
      finish({ ok: false, error: aiBrowserSession.installStatus });
    });
    child.on("close", (code) => {
      const detected = aiBrowserDetectInstalled();
      if (code === 0 && detected.installed) {
        aiBrowserSession.installStatus = `${detected.label} ready`;
        finish({ ok: true, ...detected });
      } else {
        aiBrowserSession.installStatus = output.slice(-240).trim() || `Installer exited with code ${code}`;
        finish({ ok: false, error: aiBrowserSession.installStatus });
      }
    });
  }).finally(() => {
    aiBrowserRuntime.installPromise = null;
  });

  return aiBrowserRuntime.installPromise;
}

function aiBrowserActiveProxyPort() {
  if (aiBrowserRuntime.bypassProxy) return 0;
  try {
    if (typeof proxyServer !== "undefined" && proxyServer && typeof proxyPort === "number" && proxyPort > 0) {
      return proxyPort;
    }
  } catch {
    void 0;
  }
  return 0;
}

function aiBrowserStateFile() {
  try {
    return node_path.join(electron.app.getPath("userData"), "ai-browser-state.json");
  } catch {
    return "";
  }
}

async function aiBrowserSaveStorageState() {
  if (!aiBrowserRuntime.context) return;
  const target = aiBrowserStateFile();
  if (!target) return;
  try {
    await aiBrowserRuntime.context.storageState({ path: target });
  } catch {
    void 0;
  }
}

function aiBrowserPushLog(entry) {
  aiBrowserRuntime.consoleLogs.push({
    ...entry,
    timestamp: Date.now(),
  });
  if (aiBrowserRuntime.consoleLogs.length > 200) {
    aiBrowserRuntime.consoleLogs.splice(0, aiBrowserRuntime.consoleLogs.length - 200);
  }
}

async function aiBrowserSyncNavState() {
  const page = aiBrowserRuntime.page;
  if (!page || page.isClosed()) return;
  try {
    aiBrowserSession.url = page.url() || "about:blank";
    const rawTitle = (await page.title().catch(() => "")) || aiBrowserSession.url;
    aiBrowserSession.title = aiBrowserStripEmojis(rawTitle) || aiBrowserSession.url;
  } catch {
    void 0;
  }
  try {
    if (aiBrowserRuntime.cdp) {
      const hist = await aiBrowserRuntime.cdp.send("Page.getNavigationHistory");
      const idx = Number(hist?.currentIndex ?? 0);
      const len = Array.isArray(hist?.entries) ? hist.entries.length : 0;
      aiBrowserSession.canGoBack = idx > 0;
      aiBrowserSession.canGoForward = idx >= 0 && idx < len - 1;
      return;
    }
    const nav = await page.evaluate(() => ({ len: window.history.length }));
    aiBrowserSession.canGoBack = nav.len > 1;
    aiBrowserSession.canGoForward = false;
  } catch {
    aiBrowserSession.canGoBack = false;
    aiBrowserSession.canGoForward = false;
  }
}

function aiBrowserEmitFrame(force = false) {
  const now = Date.now();
  if (!force && now - aiBrowserRuntime.lastFrameAt < 65) return;
  aiBrowserRuntime.lastFrameAt = now;
  const safeTitle = aiBrowserStripEmojis(aiBrowserSession.title) || aiBrowserSession.url;
  aiBrowserSession.title = safeTitle;
  aiBrowserBroadcast({
    type: "browser_frame",
    url: aiBrowserSession.url,
    title: safeTitle,
    loading: aiBrowserSession.loading,
    screenshot: aiBrowserSession.screenshot,
    proxyPort: aiBrowserSession.proxyPort,
    stealth: Boolean(aiBrowserSession.stealth),
    browserLabel: aiBrowserSession.browserLabel,
    canGoBack: aiBrowserSession.canGoBack,
    canGoForward: aiBrowserSession.canGoForward,
    timestamp: now,
  });
}

function aiBrowserEmitAction(action, target, extra = {}) {
  const now = Date.now();
  const safeExtra = { ...extra };
  delete safeExtra.screenshot;
  const safeTitle = aiBrowserStripEmojis(aiBrowserSession.title) || aiBrowserSession.url;
  aiBrowserSession.title = safeTitle;
  const cleanAction = aiBrowserStripEmojis(action) || "action";
  const cleanTarget = target ? aiBrowserStripEmojis(String(target)).slice(0, 120) : undefined;
  const highlight = safeExtra.highlight && typeof safeExtra.highlight === "object" ? safeExtra.highlight : null;
  aiBrowserSession.lastHighlight = highlight;
  const entry = {
    id: `act-${now}-${Math.random().toString(36).slice(2, 6)}`,
    action: cleanAction,
    url: aiBrowserSession.url,
    title: safeTitle,
    target: cleanTarget,
    loading: aiBrowserSession.loading,
    proxyPort: aiBrowserSession.proxyPort,
    stealth: Boolean(aiBrowserSession.stealth),
    browserLabel: aiBrowserSession.browserLabel,
    highlight,
    timestamp: now,
    ...safeExtra,
  };
  aiBrowserSession.lastAction = cleanAction;
  aiBrowserSession.actions.push(entry);
  if (aiBrowserSession.actions.length > 60) {
    aiBrowserSession.actions.splice(0, aiBrowserSession.actions.length - 60);
  }
  aiBrowserBroadcast({
    type: "browser_action",
    ...entry,
    screenshot: aiBrowserSession.screenshot,
    canGoBack: aiBrowserSession.canGoBack,
    canGoForward: aiBrowserSession.canGoForward,
    openPanel: true,
  });
}

async function aiBrowserAttachPage(page, context) {
  aiBrowserRuntime.page = page;
  aiBrowserRuntime.context = context;

  page.on("console", (msg) => {
    const type = msg.type();
    aiBrowserPushLog({ kind: "console", level: type, text: msg.text() });
  });
  page.on("pageerror", (error) => {
    aiBrowserPushLog({ kind: "pageerror", level: "error", text: String(error?.message || error) });
  });
  page.on("requestfailed", (req) => {
    aiBrowserPushLog({
      kind: "network",
      level: "error",
      text: `${req.method()} ${req.url()} -> ${req.failure()?.errorText || "failed"}`,
    });
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      aiBrowserPushLog({
        kind: "network",
        level: res.status() >= 500 ? "error" : "warning",
        text: `${res.status()} ${res.request().method()} ${res.url()}`,
      });
    }
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) {
      aiBrowserSession.url = frame.url() || aiBrowserSession.url;
      void aiBrowserSyncNavState().then(() => aiBrowserEmitFrame(true));
    }
  });
  page.on("load", () => {
    aiBrowserSession.loading = false;
    void aiBrowserSyncNavState().then(() => {
      aiBrowserEmitFrame(true);
      void aiBrowserSaveStorageState();
    });
  });
  page.on("close", () => {
    if (aiBrowserRuntime.page === page) {
      aiBrowserRuntime.page = null;
    }
  });

  context.on("page", async (newPage) => {
    if (newPage !== aiBrowserRuntime.page) {
      try {
        const href = newPage.url();
        await newPage.close().catch(() => {});
        if (href && /^https?:\/\//i.test(href) && aiBrowserRuntime.page && !aiBrowserRuntime.page.isClosed()) {
          await aiBrowserRuntime.page.goto(href, { waitUntil: "domcontentloaded" }).catch(() => {});
        }
      } catch {
        void 0;
      }
    }
  });

  try {
    const cdp = await context.newCDPSession(page);
    aiBrowserRuntime.cdp = cdp;
    aiBrowserRuntime.networkRequests = new Map();
    if (!aiBrowserRuntime.harStartedAt) {
      aiBrowserRuntime.harStartedAt = new Date().toISOString();
    }
    cdp.on("Network.requestWillBeSent", (evt) => {
      try {
        if (!evt || !evt.requestId || !evt.request) return;
        const reqUrl = String(evt.request.url || "");
        if (reqUrl.startsWith("data:") || reqUrl.startsWith("blob:")) return;
        const compactRequest = {
          url: reqUrl,
          method: evt.request.method,
          headers: evt.request.headers,
          postData: typeof evt.request.postData === "string" ? evt.request.postData.slice(0, 4096) : undefined,
        };
        aiBrowserRuntime.networkRequests.set(evt.requestId, {
          requestId: evt.requestId,
          startedDateTime: evt.wallTime ? new Date(evt.wallTime * 1000).toISOString() : new Date().toISOString(),
          startTimestamp: Number(evt.timestamp || 0),
          request: compactRequest,
          response: null,
          endTimestamp: Number(evt.timestamp || 0),
          encodedDataLength: 0,
          failedText: "",
        });
        if (aiBrowserRuntime.networkRequests.size > 400) {
          const oldest = aiBrowserRuntime.networkRequests.keys().next().value;
          if (oldest !== undefined) aiBrowserRuntime.networkRequests.delete(oldest);
        }
      } catch {
        void 0;
      }
    });
    cdp.on("Network.responseReceived", (evt) => {
      try {
        const rec = evt?.requestId ? aiBrowserRuntime.networkRequests.get(evt.requestId) : null;
        if (rec) {
          rec.response = evt.response || null;
          rec.endTimestamp = Number(evt.timestamp || rec.startTimestamp || 0);
        }
      } catch {
        void 0;
      }
    });
    const finalizeHarRequest = (requestId, endTimestamp, encodedLength, failedText = "") => {
      try {
        const rec = requestId ? aiBrowserRuntime.networkRequests.get(requestId) : null;
        if (!rec) return;
        aiBrowserRuntime.networkRequests.delete(requestId);
        const endTs = Number(endTimestamp || rec.endTimestamp || rec.startTimestamp || 0);
        const elapsedMs = rec.startTimestamp > 0 && endTs >= rec.startTimestamp ? Math.round((endTs - rec.startTimestamp) * 1000) : 0;
        const reqUrl = String(rec.request?.url || "");
        if (reqUrl.startsWith("data:") || reqUrl.startsWith("blob:")) return;
        const postText = typeof rec.request?.postData === "string" ? rec.request.postData : "";
        const resp = rec.response || {};
        const respHeaders = aiBrowserRedactHarHeaders(resp.headers);
        const entry = {
          pageref: "page_1",
          startedDateTime: rec.startedDateTime,
          time: elapsedMs,
          request: {
            method: String(rec.request?.method || "GET"),
            url: reqUrl,
            httpVersion: String(resp.protocol || "HTTP/1.1"),
            cookies: [],
            headers: aiBrowserRedactHarHeaders(rec.request?.headers),
            queryString: aiBrowserParseQueryString(reqUrl),
            headersSize: -1,
            bodySize: postText ? Buffer.byteLength(postText, "utf8") : 0,
            ...(postText
              ? {
                  postData: {
                    mimeType: String(rec.request?.headers?.["Content-Type"] || rec.request?.headers?.["content-type"] || "text/plain"),
                    text: postText.slice(0, 4096),
                  },
                }
              : {}),
          },
          response: {
            status: Number(resp.status || 0),
            statusText: failedText || String(resp.statusText || ""),
            httpVersion: String(resp.protocol || "HTTP/1.1"),
            cookies: [],
            headers: respHeaders,
            content: {
              size: Number(encodedLength || resp.encodedDataLength || 0),
              mimeType: String(resp.mimeType || "x-unknown"),
            },
            redirectURL: "",
            headersSize: -1,
            bodySize: Number(encodedLength || resp.encodedDataLength || 0),
          },
          cache: {},
          timings: { send: 0, wait: elapsedMs, receive: 0 },
        };
        aiBrowserRuntime.harEntries.push(entry);
        if (aiBrowserRuntime.harEntries.length > 500) {
          aiBrowserRuntime.harEntries.splice(0, aiBrowserRuntime.harEntries.length - 500);
        }
      } catch {
        void 0;
      }
    };
    cdp.on("Network.loadingFinished", (evt) => {
      finalizeHarRequest(evt?.requestId, evt?.timestamp, evt?.encodedDataLength, "");
    });
    cdp.on("Network.loadingFailed", (evt) => {
      finalizeHarRequest(evt?.requestId, evt?.timestamp, 0, evt?.errorText || "Failed");
    });
    cdp.on("Page.screencastFrame", (evt) => {
      try {
        if (evt.sessionId) {
          void cdp.send("Page.screencastFrameAck", { sessionId: evt.sessionId }).catch(() => {});
        }
        if (evt.data) {
          aiBrowserSession.screenshot = `data:image/jpeg;base64,${evt.data}`;
          aiBrowserEmitFrame(false);
        }
      } catch {
        void 0;
      }
    });
    await cdp.send("Network.enable").catch(() => {});
    await cdp.send("Page.enable").catch(() => {});
    await cdp
      .send("Page.startScreencast", {
        format: "jpeg",
        quality: 75,
        maxWidth: 1280,
        maxHeight: 800,
        everyNthFrame: 1,
      })
      .catch(() => {});
  } catch {
    aiBrowserRuntime.cdp = null;
  }
}

async function aiBrowserEnsureReady({ clearSession = false, bypassProxy = false, stealth = undefined, emit = null } = {}) {
  while (aiBrowserRuntime.launchPromise) {
    await aiBrowserRuntime.launchPromise.catch(() => {});
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  aiBrowserRuntime.bypassProxy = Boolean(bypassProxy);
  if (typeof stealth === "boolean") {
    aiBrowserRuntime.stealth = stealth;
    aiBrowserSession.stealth = stealth;
  }
  const desiredProxyPort = aiBrowserActiveProxyPort();
  const desiredStealth = Boolean(aiBrowserRuntime.stealth);
  if (clearSession) {
    aiBrowserRuntime.harEntries = [];
    aiBrowserRuntime.harStartedAt = "";
  }

  if (
    aiBrowserRuntime.page &&
    !aiBrowserRuntime.page.isClosed() &&
    !clearSession &&
    aiBrowserRuntime.proxyPort === desiredProxyPort &&
    aiBrowserRuntime.appliedStealth === desiredStealth
  ) {
    return aiBrowserRuntime.page;
  }

  aiBrowserRuntime.launchPromise = (async () => {
    const pw = aiBrowserRequirePlaywright();
    let detected = aiBrowserDetectInstalled();
    if (!detected.installed) {
      const installed = await aiBrowserInstallChromium(emit);
      if (!installed.ok) {
        throw new Error(`No Chromium browser detected and automatic installation failed: ${installed.error}`);
      }
      detected = aiBrowserDetectInstalled();
    }

    const currentUrl =
      !clearSession && aiBrowserRuntime.page && !aiBrowserRuntime.page.isClosed()
        ? aiBrowserRuntime.page.url()
        : "";

    if (aiBrowserRuntime.context) {
      if (!clearSession) await aiBrowserSaveStorageState();
      try { await aiBrowserRuntime.cdp?.send("Page.stopScreencast").catch(() => {}); } catch {}
      try { await aiBrowserRuntime.cdp?.detach().catch(() => {}); } catch {}
      await aiBrowserRuntime.context.close().catch(() => {});
      aiBrowserRuntime.context = null;
      aiBrowserRuntime.page = null;
      aiBrowserRuntime.cdp = null;
    }

    const needNewBrowser =
      !aiBrowserRuntime.browser ||
      !aiBrowserRuntime.browser.isConnected() ||
      aiBrowserRuntime.executablePath !== detected.executablePath ||
      aiBrowserRuntime.launchStealth !== desiredStealth;

    let launchedNewBrowser = false;
    let context = null;
    try {
      if (needNewBrowser) {
        if (aiBrowserRuntime.browser) {
          await aiBrowserRuntime.browser.close().catch(() => {});
          aiBrowserRuntime.browser = null;
        }
        const launchArgs = [
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding",
          "--disable-dev-shm-usage",
          "--ignore-certificate-errors",
          "--allow-insecure-localhost",
          "--window-size=1280,800",
        ];
        if (desiredStealth) {
          launchArgs.push("--disable-blink-features=AutomationControlled");
        }
        if (process.platform === "linux") launchArgs.push("--no-sandbox");

        const browser = await pw.chromium.launch({
          executablePath: detected.executablePath || undefined,
          headless: true,
          args: launchArgs,
        });
        launchedNewBrowser = true;
        browser.on("disconnected", () => {
          if (aiBrowserRuntime.browser === browser) {
            aiBrowserRuntime.browser = null;
            aiBrowserRuntime.context = null;
            aiBrowserRuntime.page = null;
            aiBrowserRuntime.cdp = null;
            aiBrowserSession.open = false;
            aiBrowserSession.active = false;
            aiBrowserSession.loading = false;
            aiBrowserSession.screenshot = "";
          }
        });
        aiBrowserRuntime.browser = browser;
        aiBrowserRuntime.executablePath = detected.executablePath;
        aiBrowserRuntime.launchStealth = desiredStealth;
        aiBrowserRuntime.browserLabel = detected.label;
        aiBrowserSession.browserLabel = detected.label;
      }

      const statePath = aiBrowserStateFile();
      if (clearSession && statePath) {
        try { await promises.rm(statePath, { force: true }); } catch {}
      }

      const contextOptions = {
        viewport: { width: 1280, height: 800 },
        ignoreHTTPSErrors: true,
        acceptDownloads: true,
      };
      if (desiredStealth) {
        contextOptions.userAgent = aiBrowserStealthUserAgent();
        contextOptions.locale = "en-US";
      }
      if (!clearSession && statePath && node_fs.existsSync(statePath)) {
        contextOptions.storageState = statePath;
      }
      if (desiredProxyPort > 0) {
        contextOptions.proxy = { server: `http://127.0.0.1:${desiredProxyPort}` };
      }

      context = await aiBrowserRuntime.browser.newContext(contextOptions);
      if (desiredStealth) {
        await context.addInitScript(aiBrowserStealthInitScript()).catch(() => {});
      }
      const page = await context.newPage();
      aiBrowserRuntime.proxyPort = desiredProxyPort;
      aiBrowserRuntime.appliedStealth = desiredStealth;
      aiBrowserSession.proxyPort = desiredProxyPort;
      aiBrowserSession.stealth = desiredStealth;
      aiBrowserSession.open = true;
      aiBrowserSession.active = true;

      await aiBrowserAttachPage(page, context);

      if (currentUrl && /^https?:\/\//i.test(currentUrl)) {
        await page.goto(currentUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
        await aiBrowserSyncNavState();
      }

      return page;
    } catch (err) {
      if (context) await context.close().catch(() => {});
      if (launchedNewBrowser && aiBrowserRuntime.browser) {
        await aiBrowserRuntime.browser.close().catch(() => {});
        aiBrowserRuntime.browser = null;
      }
      aiBrowserRuntime.context = null;
      aiBrowserRuntime.page = null;
      aiBrowserRuntime.cdp = null;
      throw err;
    }
  })().finally(() => {
    aiBrowserRuntime.launchPromise = null;
  });

  return aiBrowserRuntime.launchPromise;
}

async function aiBrowserSnapRefs(page, { interactiveOnly = true, selector = "", maxNodes = 120 } = {}) {
  const capped = Math.max(10, Math.min(300, Number(maxNodes) || 120));
  const data = await page.evaluate(
    ({ interactiveOnly: onlyInteractive, rootSel, limit }) => {
      document.querySelectorAll("[data-wide-ref]").forEach((el) => el.removeAttribute("data-wide-ref"));
      const root = rootSel ? document.querySelector(rootSel) : document.body;
      if (!root) return { nodes: [], text: "", title: document.title || "", url: location.href };

      const interactiveSelector =
        "a[href], button, input, select, textarea, summary, [role='button'], [role='link'], [role='textbox'], [role='searchbox'], [role='checkbox'], [role='radio'], [role='combobox'], [role='switch'], [role='tab'], [role='menuitem'], [contenteditable='true'], [tabindex]:not([tabindex='-1'])";
      const allSelector = onlyInteractive
        ? interactiveSelector
        : `${interactiveSelector}, h1, h2, h3, label, img[alt], [role='heading']`;

      const nodes = [];
      const seen = new Set();
      let idx = 1;
      const candidates = root.querySelectorAll(allSelector);
      for (const el of candidates) {
        if (nodes.length >= limit) break;
        if (seen.has(el)) continue;
        seen.add(el);
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
        if (rect.width < 2 || rect.height < 2) continue;

        const ref = `@e${idx}`;
        idx += 1;
        el.setAttribute("data-wide-ref", ref.slice(1));

        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute("role") || tag;
        const type = el.getAttribute("type") || "";
        const nameAttr = el.getAttribute("name") || "";
        const idAttr = el.id || "";
        const placeholder = el.getAttribute("placeholder") || "";
        const ariaLabel = el.getAttribute("aria-label") || "";
        const href = tag === "a" ? el.getAttribute("href") || "" : "";
        let value = "";
        if (tag === "input" || tag === "textarea" || tag === "select") {
          value = type === "password" ? "***" : String(el.value || "").slice(0, 60);
        }
        const labelText = (
          ariaLabel ||
          el.innerText ||
          el.textContent ||
          el.getAttribute("title") ||
          el.getAttribute("alt") ||
          placeholder ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 90);

        nodes.push({
          ref,
          tag,
          role: type ? `${role}:${type}` : role,
          name: labelText,
          id: idAttr,
          nameAttr,
          placeholder,
          href: href.slice(0, 120),
          value,
          disabled: Boolean(el.disabled || el.getAttribute("aria-disabled") === "true"),
          box: {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
        });
      }

      const rawText = (document.body?.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 3000);
      return {
        url: location.href,
        title: document.title || "",
        nodes,
        text: rawText,
      };
    },
    { interactiveOnly, rootSel: selector || "", limit: capped }
  );

  data.title = aiBrowserStripEmojis(data.title || "");
  if (Array.isArray(data.nodes)) {
    for (const node of data.nodes) {
      if (node && node.name) {
        node.name = aiBrowserStripEmojis(node.name);
      }
    }
  }

  aiBrowserSession.domSummary = (data.nodes || []).map((n) => ({
    id: Number(String(n.ref || "").replace("@e", "")) || 0,
    ref: n.ref,
    tag: n.tag,
    type: n.role,
    text: n.name || n.placeholder || n.href,
  }));

  return data;
}

function aiFormatSnapshotText(data) {
  const lines = [`URL: ${data.url}`, `Title: ${data.title}`, `Interactive Elements (${data.nodes.length}):`];
  for (const n of data.nodes) {
    const bits = [`${n.ref} [${n.role}]`];
    if (n.name) bits.push(`"${n.name}"`);
    if (n.placeholder && n.placeholder !== n.name) bits.push(`placeholder="${n.placeholder}"`);
    if (n.value) bits.push(`value="${n.value}"`);
    if (n.href) bits.push(`href="${n.href}"`);
    if (n.disabled) bits.push(`(disabled)`);
    lines.push(bits.join(" "));
  }
  return lines.join("\n");
}

function aiNormalizeBrowserUrl(raw) {
  const input = String(raw ?? "").trim();
  if (!input) return "";
  if (/^https?:\/\//i.test(input)) return input;
  if (/^[a-z]+:\/\//i.test(input)) return "";
  return `https://${input}`;
}

function aiResolveLocator(page, { ref, element_id, selector, text }) {
  const cleanRef =
    typeof ref === "string" && ref.trim()
      ? ref.trim().replace(/^@/, "")
      : Number.isFinite(Number(element_id)) && Number(element_id) > 0
        ? `e${Number(element_id)}`
        : "";
  if (cleanRef) {
    return { locator: page.locator(`[data-wide-ref="${cleanRef}"]`).first(), label: `@${cleanRef}` };
  }
  if (typeof selector === "string" && selector.trim()) {
    return { locator: page.locator(selector.trim()).first(), label: selector.trim() };
  }
  if (typeof text === "string" && text.trim()) {
    return { locator: page.getByText(text.trim(), { exact: false }).first(), label: text.trim() };
  }
  return null;
}

async function aiCaptureLiveScreenshot(page, fullPage = false) {
  if (!page || page.isClosed()) return aiBrowserSession.screenshot;
  try {
    const buf = await page.screenshot({ type: "jpeg", quality: 78, fullPage: Boolean(fullPage) });
    const uri = `data:image/jpeg;base64,${buf.toString("base64")}`;
    aiBrowserSession.screenshot = uri;
    return uri;
  } catch {
    return aiBrowserSession.screenshot;
  }
}

async function aiExecuteBrowserOpen(input = {}, emit) {
  if (emit) aiBrowserRuntime.emitFn = emit;
  const targetUrl = aiNormalizeBrowserUrl(input.url);
  aiBrowserSession.open = true;
  aiBrowserSession.active = true;
  if (targetUrl) {
    aiBrowserSession.url = targetUrl;
    aiBrowserSession.title = "Loading...";
    aiBrowserSession.loading = true;
  }
  aiBrowserEmitAction("open", targetUrl || "browser", { openPanel: true });

  try {
    const page = await aiBrowserEnsureReady({
      clearSession: Boolean(input.clearSession),
      bypassProxy: Boolean(input.bypassProxy),
      stealth: typeof input.stealth === "boolean" ? input.stealth : undefined,
      emit,
    });

    if (targetUrl) {
      await page.goto(targetUrl, {
        waitUntil: input.waitUntil || "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForTimeout(250);
    }
    aiBrowserSession.loading = false;
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(page);
    const snap = await aiBrowserSnapRefs(page);
    aiBrowserEmitAction("open", aiBrowserSession.url);
    return aiFormatSnapshotText(snap);
  } finally {
    aiBrowserSession.loading = false;
  }
}

async function aiExecuteBrowserNavigate(url, emit, opts = {}) {
  const target = aiNormalizeBrowserUrl(url);
  if (!target) {
    return "Invalid URL. Please provide an http:// or https:// URL.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;

  aiBrowserSession.open = true;
  aiBrowserSession.active = true;
  aiBrowserSession.url = target;
  aiBrowserSession.title = "Loading...";
  aiBrowserSession.loading = true;
  aiBrowserEmitAction("navigate", target, { openPanel: true });

  try {
    const page = await aiBrowserEnsureReady({ emit });
    const waitUntil = opts.waitUntil === "networkidle" || opts.waitUntil === "load" ? opts.waitUntil : "domcontentloaded";
    const resp = await page.goto(target, { waitUntil, timeout: 30000 });
    await page.waitForTimeout(300);
    aiBrowserSession.loading = false;
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(page);
    const snap = await aiBrowserSnapRefs(page);
    aiBrowserEmitAction("navigate", aiBrowserSession.url);
    const statusLine = resp ? `HTTP ${resp.status()}` : "OK";
    return `Navigated (${statusLine}) via ${aiBrowserSession.browserLabel}${aiBrowserSession.proxyPort ? ` [Catcher Proxy :${aiBrowserSession.proxyPort}]` : ""}.\n${aiFormatSnapshotText(snap)}`;
  } catch (error) {
    aiBrowserSession.loading = false;
    await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
    aiBrowserEmitAction("navigate_error", target, { error: String(error?.message || error) });
    return `Navigation failed for ${target}: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserSnapshot(input = {}, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open. Call browser_open or browser_navigate first.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  await aiBrowserSyncNavState();
  await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
  const snap = await aiBrowserSnapRefs(aiBrowserRuntime.page, {
    interactiveOnly: input.interactiveOnly !== false,
    selector: input.selector || "",
    maxNodes: input.maxNodes || 120,
  });
  aiBrowserEmitAction("snapshot", aiBrowserSession.url);
  return aiFormatSnapshotText(snap);
}

async function aiExecuteBrowserClick(selector, elementId, text, emit, extra = {}) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open. Call browser_open or browser_navigate first.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const page = aiBrowserRuntime.page;
  try {
    let targetLabel = "";
    let highlight = null;
    if (Number.isFinite(Number(extra.x)) && Number.isFinite(Number(extra.y))) {
      const x = Number(extra.x);
      const y = Number(extra.y);
      targetLabel = `(${x},${y})`;
      highlight = aiBrowserClampHighlight({ x: x - 14, y: y - 14, width: 28, height: 28 }, targetLabel, "click");
      await page.mouse.click(x, y, {
        button: extra.button || "left",
        clickCount: Number(extra.clickCount) || 1,
      });
    } else {
      const target = aiResolveLocator(page, {
        ref: extra.ref,
        element_id: elementId,
        selector,
        text,
      });
      if (!target) {
        return "Provide ref (e.g. '@e1'), element_id, selector, text, or x/y coordinates to click.";
      }
      targetLabel = target.label;
      const box = await target.locator.boundingBox().catch(() => null);
      highlight = aiBrowserClampHighlight(box, targetLabel, "click");
      await target.locator.click({
        timeout: 8000,
        button: extra.button || "left",
        clickCount: Number(extra.clickCount) || 1,
      });
    }
    await page.waitForTimeout(350);
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(page);
    const snap = await aiBrowserSnapRefs(page);
    aiBrowserEmitAction("click", targetLabel, highlight ? { highlight } : {});
    return `Clicked ${targetLabel}.\n${aiFormatSnapshotText(snap)}`;
  } catch (error) {
    return `Click failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserType(selector, elementId, text, clear = true, submit = false, emit, extra = {}) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open. Call browser_open or browser_navigate first.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const page = aiBrowserRuntime.page;
  const value = String(text ?? "");
  try {
    const target = aiResolveLocator(page, {
      ref: extra.ref,
      element_id: elementId,
      selector,
    });
    let label = "active element";
    let highlight = null;
    if (target) {
      label = target.label;
      const box = await target.locator.boundingBox().catch(() => null);
      highlight = aiBrowserClampHighlight(box, label, "type");
      if (clear) {
        await target.locator.fill(value, { timeout: 8000 });
      } else {
        await target.locator.click({ timeout: 8000 });
        await page.keyboard.type(value);
      }
    } else {
      await page.keyboard.type(value);
    }
    if (submit) {
      await page.keyboard.press("Enter");
      await page.waitForTimeout(450);
    } else {
      await page.waitForTimeout(200);
    }
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(page);
    const snap = await aiBrowserSnapRefs(page);
    aiBrowserEmitAction("type", label, highlight ? { highlight } : {});
    return `Typed into ${label}${submit ? " and pressed Enter" : ""}.\n${aiFormatSnapshotText(snap)}`;
  } catch (error) {
    return `Type failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserPress(key, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open. Call browser_open or browser_navigate first.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const k = String(key || "").trim();
  if (!k) return "Provide a key name such as 'Enter', 'Tab', or 'Escape'.";
  try {
    await aiBrowserRuntime.page.keyboard.press(k);
    await aiBrowserRuntime.page.waitForTimeout(250);
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
    aiBrowserEmitAction("press", k);
    return `Pressed key ${k}. Current URL: ${aiBrowserSession.url}`;
  } catch (error) {
    return `Key press failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserHover(input = {}, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const target = aiResolveLocator(aiBrowserRuntime.page, input);
  if (!target) return "Provide ref, selector, or text to hover.";
  try {
    const box = await target.locator.boundingBox().catch(() => null);
    const highlight = aiBrowserClampHighlight(box, target.label, "hover");
    await target.locator.hover({ timeout: 8000 });
    await aiBrowserRuntime.page.waitForTimeout(200);
    await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
    aiBrowserEmitAction("hover", target.label, highlight ? { highlight } : {});
    return `Hovered over ${target.label}.`;
  } catch (error) {
    return `Hover failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserSelect(input = {}, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const target = aiResolveLocator(aiBrowserRuntime.page, input);
  if (!target) return "Provide ref or selector of the <select> element.";
  try {
    const opt = input.label ? { label: String(input.label) } : String(input.value ?? "");
    const selected = await target.locator.selectOption(opt, { timeout: 8000 });
    await aiBrowserRuntime.page.waitForTimeout(200);
    await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
    aiBrowserEmitAction("select", target.label);
    return `Selected [${selected.join(", ")}] on ${target.label}.`;
  } catch (error) {
    return `Select failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserScroll(input = {}, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const page = aiBrowserRuntime.page;
  try {
    const target = aiResolveLocator(page, input);
    if (target) {
      await target.locator.scrollIntoViewIfNeeded({ timeout: 5000 });
      await page.waitForTimeout(200);
      await aiCaptureLiveScreenshot(page);
      aiBrowserEmitAction("scroll", target.label);
      return `Scrolled ${target.label} into view.`;
    }
    const dir = String(input.direction || "down").toLowerCase();
    const amount = Number(input.amount) || 600;
    const dx = dir === "left" ? -amount : dir === "right" ? amount : 0;
    const dy = dir === "up" ? -amount : dir === "down" ? amount : 0;
    await page.evaluate(([x, y]) => window.scrollBy(x, y), [dx, dy]);
    await page.waitForTimeout(200);
    await aiCaptureLiveScreenshot(page);
    aiBrowserEmitAction("scroll", `${dir} ${amount}px`);
    return `Scrolled ${dir} by ${amount}px.`;
  } catch (error) {
    return `Scroll failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserWait(input = {}, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const page = aiBrowserRuntime.page;
  const timeout = Math.max(500, Math.min(30000, Number(input.timeoutMs) || 10000));
  try {
    if (input.selector) {
      await page.locator(String(input.selector)).first().waitFor({ state: "visible", timeout });
    } else if (input.text) {
      await page.getByText(String(input.text), { exact: false }).first().waitFor({ state: "visible", timeout });
    } else if (input.url) {
      const sub = String(input.url);
      await page.waitForURL((u) => u.href.includes(sub), { timeout });
    } else {
      await page.waitForLoadState(input.loadState || "domcontentloaded", { timeout });
    }
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(page);
    aiBrowserEmitAction("wait", input.selector || input.text || input.url || input.loadState || "ready");
    return `Wait satisfied. URL: ${aiBrowserSession.url} | Title: ${aiBrowserSession.title}`;
  } catch (error) {
    return `Wait timed out: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserExtract(selector, mode = "snapshot", emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    if (mode === "text" && !aiBrowserSession.open) {
      return `URL: ${aiBrowserSession.url}\nTitle: ${aiBrowserSession.title}\n(No page loaded yet)`;
    }
    return "No browser page is open. Call browser_open or browser_navigate first.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const page = aiBrowserRuntime.page;
  const m = String(mode || "snapshot").toLowerCase();

  try {
    if (m === "snapshot" || m === "dom_tree" || m === "inputs") {
      const snap = await aiBrowserSnapRefs(page, { interactiveOnly: m !== "dom_tree", selector: selector || "" });
      aiBrowserEmitAction("extract", m);
      return aiFormatSnapshotText(snap);
    }
    if (m === "cookies") {
      const cookies = await aiBrowserRuntime.context.cookies();
      aiBrowserEmitAction("extract", "cookies");
      return JSON.stringify(cookies.slice(0, 60), null, 2);
    }
    if (m === "storage") {
      const storage = await page.evaluate(() => ({
        localStorage: { ...localStorage },
        sessionStorage: { ...sessionStorage },
      }));
      aiBrowserEmitAction("extract", "storage");
      return JSON.stringify(storage, null, 2).slice(0, 12000);
    }
    if (m === "links") {
      const links = await page.evaluate((sel) => {
        const root = sel ? document.querySelector(sel) : document.body;
        if (!root) return [];
        return Array.from(root.querySelectorAll("a[href]"))
          .slice(0, 100)
          .map((a) => ({ text: (a.innerText || "").trim().slice(0, 80), href: a.href }));
      }, selector || "");
      aiBrowserEmitAction("extract", "links");
      return JSON.stringify(links, null, 2);
    }
    if (m === "html") {
      const html = selector
        ? await page.locator(selector).first().innerHTML({ timeout: 5000 })
        : await page.content();
      aiBrowserEmitAction("extract", "html");
      return String(html).slice(0, 20000);
    }
    const text = await page.evaluate((sel) => {
      const root = sel ? document.querySelector(sel) : document.body;
      return root ? (root.innerText || "").replace(/\n{3,}/g, "\n\n").trim() : "";
    }, selector || "");
    aiBrowserEmitAction("extract", "text");
    return `URL: ${aiBrowserSession.url}\nTitle: ${aiBrowserSession.title}\n\n${text.slice(0, 16000)}`;
  } catch (error) {
    return `Extract failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserConsole(input = {}, emit) {
  if (emit) aiBrowserRuntime.emitFn = emit;
  const filter = String(input.filter || "all").toLowerCase();
  const limit = Math.max(1, Math.min(200, Number(input.limit) || 40));
  const filtered = aiBrowserRuntime.consoleLogs.filter((entry) => {
    if (filter === "errors") return entry.level === "error";
    if (filter === "warnings") return entry.level === "warning" || entry.level === "error";
    if (filter === "network") return entry.kind === "network";
    return true;
  });
  return JSON.stringify({ total: aiBrowserRuntime.consoleLogs.length, logs: filtered.slice(-limit) }, null, 2);
}

async function aiExecuteBrowserCookies(input = {}, emit) {
  if (!aiBrowserRuntime.context) return "No browser session is active.";
  if (emit) aiBrowserRuntime.emitFn = emit;
  const action = String(input.action || "get").toLowerCase();
  try {
    if (action === "clear") {
      await aiBrowserRuntime.context.clearCookies();
      await aiBrowserSaveStorageState();
      aiBrowserEmitAction("cookies", "cleared");
      return "Cleared all browser cookies in the active context.";
    }
    if (action === "set" && Array.isArray(input.cookies)) {
      await aiBrowserRuntime.context.addCookies(input.cookies);
      await aiBrowserSaveStorageState();
      aiBrowserEmitAction("cookies", `set ${input.cookies.length}`);
      return `Set ${input.cookies.length} cookie(s).`;
    }
    const cookies = input.url
      ? await aiBrowserRuntime.context.cookies([String(input.url)])
      : await aiBrowserRuntime.context.cookies();
    return JSON.stringify(cookies, null, 2).slice(0, 16000);
  } catch (error) {
    return `Cookie operation failed: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserEval(expression, emit) {
  if (!aiBrowserRuntime.page || aiBrowserRuntime.page.isClosed()) {
    return "No browser page is open.";
  }
  if (emit) aiBrowserRuntime.emitFn = emit;
  const code = String(expression || "").trim();
  if (!code) return "Provide a JavaScript expression to evaluate.";
  try {
    const result = await aiBrowserRuntime.page.evaluate((expr) => {
      return (0, eval)(expr);
    }, code);
    await aiBrowserSyncNavState();
    await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
    aiBrowserEmitAction("eval", code.slice(0, 60));
    return typeof result === "string" ? result : JSON.stringify(result, null, 2) ?? "undefined";
  } catch (error) {
    return `Evaluation error: ${String(error?.message || error)}`;
  }
}

async function aiExecuteBrowserScreenshot(emit, opts = {}) {
  if (emit) aiBrowserRuntime.emitFn = emit;
  if (aiBrowserRuntime.page && !aiBrowserRuntime.page.isClosed()) {
    await aiCaptureLiveScreenshot(aiBrowserRuntime.page, Boolean(opts.fullPage));
    aiBrowserEmitAction("screenshot", aiBrowserSession.url);
    return `Captured live screenshot (${aiBrowserSession.url}).`;
  }
  return `No active Chromium page open yet (current URL: ${aiBrowserSession.url}).`;
}

async function aiExecuteBrowserExportHar(input = {}, emit) {
  if (emit) aiBrowserRuntime.emitFn = emit;
  const har = aiBrowserBuildHarLog(input);
  aiBrowserEmitAction("export_har", `${har.log.entries.length} entries`);
  return JSON.stringify(har, null, 2).slice(0, 18000);
}

async function aiExecuteBrowserClose(emit) {
  if (emit) aiBrowserRuntime.emitFn = emit;
  if (aiBrowserRuntime.inputCaptureTimer) {
    clearTimeout(aiBrowserRuntime.inputCaptureTimer);
    aiBrowserRuntime.inputCaptureTimer = null;
  }
  await aiBrowserSaveStorageState();
  aiBrowserSession.open = false;
  aiBrowserSession.active = false;
  aiBrowserSession.loading = false;
  aiBrowserSession.screenshot = "";
  aiBrowserSession.lastHighlight = null;
  aiBrowserSession.domSummary = [];
  try {
    await aiBrowserRuntime.cdp?.send("Page.stopScreencast").catch(() => {});
    await aiBrowserRuntime.cdp?.detach().catch(() => {});
    await aiBrowserRuntime.context?.close().catch(() => {});
    await aiBrowserRuntime.browser?.close().catch(() => {});
  } catch {
    void 0;
  }
  aiBrowserRuntime.cdp = null;
  aiBrowserRuntime.context = null;
  aiBrowserRuntime.page = null;
  aiBrowserRuntime.browser = null;
  aiBrowserRuntime.consoleLogs = [];
  aiBrowserRuntime.networkRequests.clear();
  aiBrowserRuntime.harEntries = [];
  aiBrowserRuntime.harStartedAt = "";
  aiBrowserEmitAction("close", "browser");
  aiBrowserRuntime.emitFn = null;
  return "Browser session closed.";
}

async function disposeAiBrowser() {
  if (aiBrowserRuntime.closing) return;
  aiBrowserRuntime.closing = true;
  if (aiBrowserRuntime.inputCaptureTimer) {
    clearTimeout(aiBrowserRuntime.inputCaptureTimer);
    aiBrowserRuntime.inputCaptureTimer = null;
  }
  if (aiBrowserRuntime.installChild) {
    try { killProcessTree(aiBrowserRuntime.installChild); } catch {}
    aiBrowserRuntime.installChild = null;
  }
  const cdp = aiBrowserRuntime.cdp;
  const ctx = aiBrowserRuntime.context;
  const br = aiBrowserRuntime.browser;
  aiBrowserRuntime.cdp = null;
  aiBrowserRuntime.context = null;
  aiBrowserRuntime.page = null;
  aiBrowserRuntime.browser = null;
  aiBrowserRuntime.emitFn = null;
  aiBrowserSession.screenshot = "";
  aiBrowserRuntime.networkRequests.clear();
  try { await cdp?.send("Page.stopScreencast").catch(() => {}); } catch {}
  try { await cdp?.detach().catch(() => {}); } catch {}
  try { await ctx?.close().catch(() => {}); } catch {}
  try { await br?.close().catch(() => {}); } catch {}
}

function registerAiBrowserHandlers() {
  electron.ipcMain.handle("ai:browserStatus", async () => {
    const detected = aiBrowserDetectInstalled();
    return {
      ok: true,
      detected,
      session: {
        ...aiBrowserSession,
        proxyPort: aiBrowserActiveProxyPort(),
      },
    };
  });

  electron.ipcMain.handle("ai:browserInstall", async (event) => {
    const emit = (ev) => {
      if (event?.sender && !event.sender.isDestroyed()) event.sender.send("ai:event", ev);
    };
    return aiBrowserInstallChromium(emit);
  });

  electron.ipcMain.handle("ai:browserInput", async (_event, payload = {}) => {
    const page = aiBrowserRuntime.page;
    if (!page || page.isClosed()) return { ok: false, error: "Browser page is not active." };
    const type = String(payload.type || "");
    try {
      if (type === "mousemove") {
        await page.mouse.move(Number(payload.x) || 0, Number(payload.y) || 0);
      } else if (type === "mousedown") {
        await page.mouse.move(Number(payload.x) || 0, Number(payload.y) || 0);
        await page.mouse.down({ button: payload.button || "left", clickCount: Number(payload.clickCount) || 1 });
      } else if (type === "mouseup") {
        await page.mouse.up({ button: payload.button || "left", clickCount: Number(payload.clickCount) || 1 });
      } else if (type === "click") {
        await page.mouse.click(Number(payload.x) || 0, Number(payload.y) || 0, {
          button: payload.button || "left",
          clickCount: Number(payload.clickCount) || 1,
        });
      } else if (type === "wheel") {
        await page.mouse.wheel(Number(payload.deltaX) || 0, Number(payload.deltaY) || 0);
      } else if (type === "keydown") {
        const key = String(payload.key || "");
        if (key) await page.keyboard.down(key);
      } else if (type === "keyup") {
        const key = String(payload.key || "");
        if (key) await page.keyboard.up(key);
      } else if (type === "press") {
        const key = String(payload.key || "");
        if (key) await page.keyboard.press(key);
      } else if (type === "text") {
        const text = String(payload.text || "");
        if (text) await page.keyboard.insertText(text);
      }
      if (type !== "mousemove") {
        if (aiBrowserRuntime.inputCaptureTimer) clearTimeout(aiBrowserRuntime.inputCaptureTimer);
        aiBrowserRuntime.inputCaptureTimer = setTimeout(() => {
          aiBrowserRuntime.inputCaptureTimer = null;
          if (!aiBrowserRuntime.closing && !page.isClosed()) {
            void aiCaptureLiveScreenshot(page).then(() => aiBrowserEmitFrame(false));
          }
        }, 80);
        aiBrowserRuntime.inputCaptureTimer.unref?.();
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });

  electron.ipcMain.handle("ai:browserNav", async (event, payload = {}) => {
    const emit = (ev) => {
      if (event?.sender && !event.sender.isDestroyed()) event.sender.send("ai:event", ev);
    };
    const action = String(payload.action || "").toLowerCase();
    try {
      if (action === "goto") {
        const res = await aiExecuteBrowserNavigate(payload.url, emit);
        return { ok: true, result: res, session: aiBrowserSession };
      }
      if (action === "open") {
        const res = await aiExecuteBrowserOpen({
          url: payload.url,
          stealth: typeof payload.stealth === "boolean" ? payload.stealth : undefined,
        }, emit);
        return { ok: true, result: res, session: aiBrowserSession };
      }
      if (action === "export_har") {
        const har = aiBrowserBuildHarLog(payload);
        const safeHost = (() => {
          try {
            return (new URL(aiBrowserSession.url).hostname || "session").replace(/[^a-z0-9.-]/gi, "_");
          } catch {
            return "session";
          }
        })();
        return {
          ok: true,
          har,
          entryCount: har.log.entries.length,
          suggestedFilename: `wide-browser-${safeHost}-${Date.now()}.har`,
          session: aiBrowserSession,
        };
      }
      if (action === "toggle_stealth") {
        aiBrowserRuntime.stealth = !aiBrowserRuntime.stealth;
        aiBrowserSession.stealth = aiBrowserRuntime.stealth;
        if (aiBrowserRuntime.page && !aiBrowserRuntime.page.isClosed()) {
          await aiBrowserEnsureReady({
            bypassProxy: aiBrowserRuntime.bypassProxy,
            stealth: aiBrowserRuntime.stealth,
            emit,
          });
          await aiBrowserSyncNavState();
          await aiCaptureLiveScreenshot(aiBrowserRuntime.page);
          aiBrowserEmitFrame(true);
        }
        return { ok: true, session: aiBrowserSession };
      }
      const page = aiBrowserRuntime.page;
      if (!page || page.isClosed()) return { ok: false, error: "No browser page open." };
      if (action === "back") await page.goBack({ timeout: 10000 }).catch(() => {});
      else if (action === "forward") await page.goForward({ timeout: 10000 }).catch(() => {});
      else if (action === "reload") await page.reload({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      else if (action === "toggle_proxy") {
        aiBrowserRuntime.bypassProxy = !aiBrowserRuntime.bypassProxy;
        await aiBrowserEnsureReady({
          bypassProxy: aiBrowserRuntime.bypassProxy,
          stealth: aiBrowserRuntime.stealth,
          emit,
        });
      }
      await aiBrowserSyncNavState();
      await aiCaptureLiveScreenshot(aiBrowserRuntime.page || page);
      aiBrowserEmitFrame(true);
      return { ok: true, session: aiBrowserSession };
    } catch (error) {
      return { ok: false, error: String(error?.message || error) };
    }
  });
}
