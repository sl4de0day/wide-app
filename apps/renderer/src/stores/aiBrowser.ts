import { create } from "zustand";
import { bridge, type AiBrowserHighlight, type AiBrowserSessionState } from "@/lib/bridge";

const UI_EMOJI_RE =
  /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u2600-\u27BF])(?:\uFE0F|\uFE0E|[\u{1F3FB}-\u{1F3FF}])?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u2600-\u27BF])(?:\uFE0F|\uFE0E|[\u{1F3FB}-\u{1F3FF}])?)+|[0-9#*]\uFE0F?\u20E3|[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?|\p{Emoji_Presentation}(?:\uFE0F|\uFE0E)?|[\u231A-\u23FF\u2600-\u27BF\u2B05-\u2B55][\uFE0E\uFE0F]?|[\u2139\u2194-\u21AA\u24C2\u25AA-\u25FE\u2934-\u2935\u3030\u303D\u3297\u3299]\uFE0F|[\uFE0E\uFE0F\u200D\u20E3]/gu;

export function stripUiEmojis(text: string): string {
  return String(text ?? "").replace(UI_EMOJI_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}

export interface AiBrowserAction {
  id: string;
  action: string;
  url?: string;
  target?: string;
  timestamp: number;
}

export interface AiBrowserActionEvent {
  action: string;
  url?: string;
  title?: string;
  frame?: string;
  screenshot?: string;
  target?: string;
  loading?: boolean;
  canGoBack?: boolean;
  canGoForward?: boolean;
  proxyPort?: number;
  stealth?: boolean;
  browserLabel?: string;
  installing?: boolean;
  status?: string;
  openPanel?: boolean;
  highlight?: AiBrowserHighlight | null;
  timestamp?: number;
}

export interface AiBrowserFrameEvent {
  url?: string;
  title?: string;
  loading?: boolean;
  screenshot?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  proxyPort?: number;
  stealth?: boolean;
  browserLabel?: string;
}

export interface AiBrowserState {
  active: boolean;
  drawerOpen: boolean;
  url: string;
  title: string;
  loading: boolean;
  lastAction: string;
  lastHighlight: AiBrowserHighlight | null;
  frame: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  proxyPort: number;
  stealth: boolean;
  browserLabel: string;
  installing: boolean;
  installStatus: string;
  takeover: boolean;
  history: AiBrowserAction[];
  status: "idle" | "launching" | "navigating" | "clicking" | "typing" | "extracting" | "ready";
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  setTakeover: (on: boolean) => void;
  setInstallProgress: (status: string, installing: boolean) => void;
  syncSession: (session?: Partial<AiBrowserSessionState> | null) => void;
  recordAction: (event: AiBrowserActionEvent) => void;
  recordFrame: (event: AiBrowserFrameEvent) => void;
  clear: () => void;
}

let highlightTimer: ReturnType<typeof setTimeout> | null = null;
let pendingFrameEvent: AiBrowserFrameEvent | null = null;
let frameRafId: number | null = null;

function cancelFrameRaf(): void {
  if (frameRafId !== null && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frameRafId);
  }
  frameRafId = null;
  pendingFrameEvent = null;
}

function applyPendingFrame(): void {
  frameRafId = null;
  const latest = pendingFrameEvent;
  pendingFrameEvent = null;
  if (!latest) return;
  useAiBrowser.setState((state) => {
    const cleanTitle = latest.title ? stripUiEmojis(latest.title) : "";
    return {
      active: true,
      url: latest.url || state.url,
      title: cleanTitle || state.title,
      loading: typeof latest.loading === "boolean" ? latest.loading : state.loading,
      frame: latest.screenshot ? latest.screenshot : state.frame,
      canGoBack: typeof latest.canGoBack === "boolean" ? latest.canGoBack : state.canGoBack,
      canGoForward: typeof latest.canGoForward === "boolean" ? latest.canGoForward : state.canGoForward,
      proxyPort: typeof latest.proxyPort === "number" ? latest.proxyPort : state.proxyPort,
      stealth: typeof latest.stealth === "boolean" ? latest.stealth : state.stealth,
      browserLabel: latest.browserLabel ?? state.browserLabel,
      installing: false,
      status: latest.loading ? "navigating" : state.status === "idle" ? "ready" : state.status,
    };
  });
}

function scheduleHighlightExpiry(hasHighlight: boolean): void {
  if (highlightTimer) {
    clearTimeout(highlightTimer);
    highlightTimer = null;
  }
  if (hasHighlight) {
    highlightTimer = setTimeout(() => {
      highlightTimer = null;
      useAiBrowser.setState({ lastHighlight: null });
    }, 1800);
  }
}

function inferStatus(action: string, event?: { installing?: boolean; loading?: boolean }): AiBrowserState["status"] {
  if (event?.installing || action === "status") return "launching";
  if (action.includes("open")) return event?.loading ? "launching" : "ready";
  if (action.includes("navigate")) return event?.loading === false ? "ready" : "navigating";
  if (action.includes("click") || action.includes("hover") || action.includes("select")) return "clicking";
  if (action.includes("type") || action.includes("press")) return "typing";
  if (action.includes("extract") || action.includes("snapshot") || action.includes("eval")) return "extracting";
  return "ready";
}

export const useAiBrowser = create<AiBrowserState>((set) => ({
  active: false,
  drawerOpen: false,
  url: "about:blank",
  title: "AI Browser Stream",
  loading: false,
  lastAction: "Idle",
  lastHighlight: null,
  frame: null,
  canGoBack: false,
  canGoForward: false,
  proxyPort: 0,
  stealth: false,
  browserLabel: "",
  installing: false,
  installStatus: "",
  takeover: false,
  history: [],
  status: "idle",
  setDrawerOpen: (open) => set({ drawerOpen: open }),
  toggleDrawer: () => set((state) => ({ drawerOpen: !state.drawerOpen })),
  setTakeover: (on) => set({ takeover: on }),
  setInstallProgress: (status, installing) =>
    set({
      installStatus: stripUiEmojis(status),
      installing,
      status: installing ? "launching" : "ready",
    }),
  syncSession: (session) =>
    set((state) => {
      if (!session) return state;
      const nextHighlight = session.lastHighlight !== undefined ? session.lastHighlight : state.lastHighlight;
      if (session.lastHighlight) scheduleHighlightExpiry(true);
      const nextUrl = session.url ?? state.url;
      const nextTitle = session.title !== undefined ? stripUiEmojis(session.title) || nextUrl : state.title;
      return {
        active: typeof session.active === "boolean" ? session.active : state.active,
        url: nextUrl,
        title: nextTitle,
        loading: typeof session.loading === "boolean" ? session.loading : state.loading,
        lastHighlight: nextHighlight ?? null,
        frame: session.screenshot ? session.screenshot : state.frame,
        canGoBack: typeof session.canGoBack === "boolean" ? session.canGoBack : state.canGoBack,
        canGoForward: typeof session.canGoForward === "boolean" ? session.canGoForward : state.canGoForward,
        proxyPort: typeof session.proxyPort === "number" ? session.proxyPort : state.proxyPort,
        stealth: typeof session.stealth === "boolean" ? session.stealth : state.stealth,
        browserLabel: session.browserLabel ?? state.browserLabel,
        installing: typeof session.installing === "boolean" ? session.installing : state.installing,
        installStatus: session.installStatus !== undefined ? stripUiEmojis(session.installStatus) : state.installStatus,
        lastAction: session.lastAction !== undefined ? stripUiEmojis(session.lastAction) : state.lastAction,
      };
    }),
  recordAction: (event) =>
    set((state) => {
      const nextFrame =
        event.screenshot !== undefined && event.screenshot
          ? event.screenshot
          : event.frame !== undefined && event.frame
            ? event.frame
            : state.frame;
      const isStatusOnly = event.action === "status";
      const cleanAction = stripUiEmojis(event.action) || "action";
      const cleanTarget = event.target ? stripUiEmojis(event.target) : undefined;
      const actionItem: AiBrowserAction | null = isStatusOnly
        ? null
        : {
            id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            action: cleanAction,
            url: event.url,
            target: cleanTarget,
            timestamp: event.timestamp || Date.now(),
          };
      const highlight = event.highlight && typeof event.highlight === "object" ? event.highlight : null;
      if (highlight) scheduleHighlightExpiry(true);
      const nextUrl = event.url || state.url;
      const rawTitle = event.title ? stripUiEmojis(event.title) : "";
      return {
        active: true,
        drawerOpen: event.openPanel === false ? state.drawerOpen : true,
        url: nextUrl,
        title: rawTitle || (event.url ? event.url : state.title),
        loading: typeof event.loading === "boolean" ? event.loading : state.loading,
        lastAction: isStatusOnly && event.status ? stripUiEmojis(event.status) : cleanAction,
        lastHighlight: highlight ?? (isStatusOnly ? state.lastHighlight : null),
        frame: nextFrame,
        canGoBack: typeof event.canGoBack === "boolean" ? event.canGoBack : state.canGoBack,
        canGoForward: typeof event.canGoForward === "boolean" ? event.canGoForward : state.canGoForward,
        proxyPort: typeof event.proxyPort === "number" ? event.proxyPort : state.proxyPort,
        stealth: typeof event.stealth === "boolean" ? event.stealth : state.stealth,
        browserLabel: event.browserLabel ?? state.browserLabel,
        installing: typeof event.installing === "boolean" ? event.installing : false,
        installStatus: typeof event.status === "string" ? stripUiEmojis(event.status) : state.installStatus,
        history: actionItem ? [actionItem, ...state.history].slice(0, 60) : state.history,
        status: inferStatus(cleanAction, event),
      };
    }),
  recordFrame: (event) => {
    pendingFrameEvent = event;
    if (frameRafId !== null) return;
    if (typeof requestAnimationFrame === "function") {
      frameRafId = requestAnimationFrame(applyPendingFrame);
    } else {
      applyPendingFrame();
    }
  },
  clear: () => {
    cancelFrameRaf();
    scheduleHighlightExpiry(false);
    set({
      active: false,
      drawerOpen: false,
      url: "about:blank",
      title: "AI Browser Stream",
      loading: false,
      lastAction: "Session closed",
      lastHighlight: null,
      frame: null,
      canGoBack: false,
      canGoForward: false,
      proxyPort: 0,
      stealth: false,
      installing: false,
      installStatus: "",
      takeover: false,
      history: [],
      status: "idle",
    });
  },
}));

export function mapViewportPoint(rect: DOMRect, clientX: number, clientY: number): { x: number; y: number } {
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  return {
    x: Math.max(0, Math.min(1280, Math.round(((clientX - rect.left) / w) * 1280))),
    y: Math.max(0, Math.min(800, Math.round(((clientY - rect.top) / h) * 800))),
  };
}

export function forwardBrowserMouse(
  type: "mousemove" | "mousedown" | "mouseup",
  rect: DOMRect,
  clientX: number,
  clientY: number,
  buttonIndex = 0,
  clickCount = 1,
): void {
  const pt = mapViewportPoint(rect, clientX, clientY);
  const button = buttonIndex === 2 ? "right" : buttonIndex === 1 ? "middle" : "left";
  void bridge.aiBrowserInput({ type, x: pt.x, y: pt.y, button, clickCount });
}

export function forwardBrowserKey(key: string, ctrlKey: boolean, altKey: boolean, metaKey: boolean): void {
  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") return;
  if (key.length === 1 && !ctrlKey && !altKey && !metaKey) {
    void bridge.aiBrowserInput({ type: "text", text: key });
    return;
  }
  const mods: string[] = [];
  if (ctrlKey) mods.push("Control");
  if (altKey) mods.push("Alt");
  if (metaKey) mods.push("Meta");
  const combo = mods.length > 0 ? `${mods.join("+")}+${key.length === 1 ? key.toLowerCase() : key}` : key;
  void bridge.aiBrowserInput({ type: "press", key: combo });
}

