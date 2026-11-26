import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent,
} from "react";
import { ArrowLeft, ArrowRight, Download, Globe, Hand, Lock, Power, RotateCw, ShieldCheck, X } from "lucide-react";
import { bridge, type AiBrowserDetectedInfo } from "@/lib/bridge";
import { loadDockSize, saveDockSize } from "@/lib/dockSize";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { forwardBrowserKey, forwardBrowserMouse, useAiBrowser } from "@/stores/aiBrowser";
import { useLayout } from "@/stores/layout";

const WIDTH_KEY = "wide.layout.browser_width";
const MIN_WIDTH = 360;
const MIN_CHAT_WIDTH = 420;
const SIDEBAR_WIDTH = 288;

function clampWidth(width: number): number {
  const sidebar = useLayout.getState().sidebarCollapsed ? 0 : SIDEBAR_WIDTH;
  const max = Math.max(MIN_WIDTH, window.innerWidth - sidebar - MIN_CHAT_WIDTH);
  return Math.min(max, Math.max(MIN_WIDTH, width));
}

function PaneButton({
  label,
  onClick,
  disabled,
  active,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-100",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-35",
        active
          ? "bg-selected text-fg-bright"
          : danger
            ? "text-fg-dim hover:bg-status-error/12 hover:text-status-error"
            : "text-fg-dim hover:bg-hover hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function ResizeHandle({ width, onResize }: { width: number; onResize: (width: number, persist: boolean) => void }) {
  const t = useT();
  const start = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    start.current = { x: event.clientX, width };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    onResize(start.current.width + (start.current.x - event.clientX), false);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onResize(start.current.width + (start.current.x - event.clientX), true);
    start.current = null;
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t("Resize the browser panel")}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") onResize(width + 24, true);
        else if (event.key === "ArrowRight") onResize(width - 24, true);
        else return;
        event.preventDefault();
      }}
      className="group absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize focus-visible:outline-none"
    >
      <span className="absolute inset-y-0 left-1 w-px bg-line transition-colors duration-100 group-hover:bg-accent/60 group-focus-visible:bg-accent" />
    </div>
  );
}

export function AiBrowserDrawer() {
  const t = useT();
  const active = useAiBrowser((s) => s.active);
  const drawerOpen = useAiBrowser((s) => s.drawerOpen);
  const url = useAiBrowser((s) => s.url);
  const title = useAiBrowser((s) => s.title);
  const loading = useAiBrowser((s) => s.loading);
  const lastAction = useAiBrowser((s) => s.lastAction);
  const lastHighlight = useAiBrowser((s) => s.lastHighlight);
  const frame = useAiBrowser((s) => (s.drawerOpen ? s.frame : null));
  const history = useAiBrowser((s) => s.history);
  const canGoBack = useAiBrowser((s) => s.canGoBack);
  const canGoForward = useAiBrowser((s) => s.canGoForward);
  const proxyPort = useAiBrowser((s) => s.proxyPort);
  const stealth = useAiBrowser((s) => s.stealth);
  const browserLabel = useAiBrowser((s) => s.browserLabel);
  const installing = useAiBrowser((s) => s.installing);
  const installStatus = useAiBrowser((s) => s.installStatus);
  const takeover = useAiBrowser((s) => s.takeover);
  const setDrawerOpen = useAiBrowser((s) => s.setDrawerOpen);
  const setTakeover = useAiBrowser((s) => s.setTakeover);
  const syncSession = useAiBrowser((s) => s.syncSession);
  const clear = useAiBrowser((s) => s.clear);

  const [width, setWidth] = useState(() => clampWidth(loadDockSize(WIDTH_KEY, 560)));
  const [draftUrl, setDraftUrl] = useState(url);
  const [urlFocused, setUrlFocused] = useState(false);
  const [harNotice, setHarNotice] = useState<string | null>(null);
  const [detected, setDetected] = useState<AiBrowserDetectedInfo | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const lastMoveRef = useRef<number>(0);

  const resize = useCallback((next: number, persist: boolean) => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    if (persist) saveDockSize(WIDTH_KEY, clamped);
  }, []);

  const sidebarCollapsed = useLayout((s) => s.sidebarCollapsed);

  useEffect(() => {
    const preferred = () => setWidth(clampWidth(loadDockSize(WIDTH_KEY, 560)));
    preferred();
    window.addEventListener("resize", preferred);
    return () => window.removeEventListener("resize", preferred);
  }, [sidebarCollapsed, drawerOpen]);

  useEffect(() => {
    if (!urlFocused) setDraftUrl(url);
  }, [url, urlFocused]);

  useEffect(() => {
    if (!drawerOpen) return;
    let cancelled = false;
    void bridge.aiBrowserStatus().then((res) => {
      if (cancelled || !res.ok) return;
      if (res.detected) setDetected(res.detected);
      if (res.session) syncSession(res.session);
    });
    return () => {
      cancelled = true;
    };
  }, [drawerOpen, syncSession]);

  if (!drawerOpen) return null;

  const navigateUrl = (event: FormEvent) => {
    event.preventDefault();
    const target = draftUrl.trim();
    if (!target) return;
    void bridge.aiBrowserNav({ action: active ? "goto" : "open", url: target }).then((res) => {
      if (res.ok && res.session) syncSession(res.session);
    });
  };

  const runNav = (action: "back" | "forward" | "reload" | "toggle_proxy" | "toggle_stealth") => {
    void bridge.aiBrowserNav({ action }).then((res) => {
      if (res.ok && res.session) syncSession(res.session);
    });
  };

  const exportHar = () => {
    void bridge.aiBrowserNav({ action: "export_har" }).then((res) => {
      if (!res.ok || !res.har) return;
      const json = JSON.stringify(res.har, null, 2);
      const blob = new Blob([json], { type: "application/json" });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = res.suggestedFilename || `wide-browser-${Date.now()}.har`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 500);
      setHarNotice(`HAR (${res.entryCount ?? 0})`);
      setTimeout(() => setHarNotice(null), 2000);
    });
  };

  const launchDefault = () => {
    const startUrl = draftUrl && draftUrl !== "about:blank" ? draftUrl : "https://example.com";
    void bridge.aiBrowserNav({ action: "open", url: startUrl }).then((res) => {
      if (res.ok && res.session) syncSession(res.session);
    });
  };

  const installRuntime = () => {
    void bridge.aiBrowserInstall().then((res) => {
      if (res.ok && res.label) {
        setDetected({
          found: true,
          executablePath: res.executablePath || "",
          label: res.label,
          source: res.source || "playwright",
        });
      }
    });
  };

  const closeSession = () => {
    void bridge.aiBrowser("close").then(() => clear());
  };

  const handleMouseMove = (event: MouseEvent<HTMLDivElement>) => {
    if (!takeover || !imgRef.current) return;
    const now = Date.now();
    if (now - lastMoveRef.current < 45) return;
    lastMoveRef.current = now;
    forwardBrowserMouse("mousemove", imgRef.current.getBoundingClientRect(), event.clientX, event.clientY);
  };

  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (!takeover || !imgRef.current) return;
    event.preventDefault();
    viewportRef.current?.focus();
    forwardBrowserMouse(
      "mousedown",
      imgRef.current.getBoundingClientRect(),
      event.clientX,
      event.clientY,
      event.button,
      event.detail || 1,
    );
  };

  const handleMouseUp = (event: MouseEvent<HTMLDivElement>) => {
    if (!takeover || !imgRef.current) return;
    forwardBrowserMouse(
      "mouseup",
      imgRef.current.getBoundingClientRect(),
      event.clientX,
      event.clientY,
      event.button,
      event.detail || 1,
    );
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!takeover) return;
    event.preventDefault();
    void bridge.aiBrowserInput({ type: "wheel", deltaX: event.deltaX, deltaY: event.deltaY });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!takeover) return;
    event.preventDefault();
    event.stopPropagation();
    forwardBrowserKey(event.key, event.ctrlKey, event.altKey, event.metaKey);
  };

  const engineLabel = browserLabel || (detected?.found ? detected.label : "");
  const tabTitle = title || (active ? url : "") || t("AI Browser");
  const secure = /^https:\/\//i.test(url);

  return (
    <aside
      className="wide-enter-fade relative flex min-h-0 shrink-0 flex-col bg-canvas select-none"
      style={{ width }}
      aria-label={t("AI Browser")}
    >
      <ResizeHandle width={width} onResize={resize} />

      <div className="flex h-11 shrink-0 items-center gap-1 pl-3 pr-2">
        <div className="flex h-8 min-w-0 max-w-[60%] items-center gap-2 rounded-lg bg-raised pl-2.5 pr-3" title={url || tabTitle}>
          <Globe className={cn("size-icon-sm shrink-0", loading ? "animate-pulse text-accent" : "text-fg-dim")} strokeWidth={1.75} />
          <span className="truncate text-meta text-fg">{tabTitle}</span>
        </div>
        <span
          className={cn("ml-1 size-1.5 shrink-0 rounded-full", takeover ? "bg-accent" : active ? "bg-status-ok" : "bg-fg-faint/50")}
          title={takeover ? t("Interactive") : active ? t("Live") : ""}
        />
        <div className="min-w-2 flex-1" />
        <PaneButton
          label={takeover ? t("Release control") : t("Take control")}
          onClick={() => setTakeover(!takeover)}
          disabled={!frame}
          active={takeover}
        >
          <Hand className="size-icon" strokeWidth={1.5} />
        </PaneButton>
        <PaneButton label={t("Stealth mode")} onClick={() => runNav("toggle_stealth")} active={stealth}>
          <ShieldCheck className={cn("size-icon", stealth && "text-status-warn")} strokeWidth={1.5} />
        </PaneButton>
        <PaneButton label={harNotice || t("Export network trace (HAR)")} onClick={exportHar} disabled={!active}>
          <Download className="size-icon" strokeWidth={1.5} />
        </PaneButton>
        {active && (
          <PaneButton label={t("Close browser session")} onClick={closeSession} danger>
            <Power className="size-icon" strokeWidth={1.5} />
          </PaneButton>
        )}
        <PaneButton label={t("Hide the AI browser")} onClick={() => setDrawerOpen(false)}>
          <X className="size-icon" strokeWidth={1.5} />
        </PaneButton>
      </div>

      <div className="flex h-11 shrink-0 items-center gap-1 px-2">
        <PaneButton label={t("Back")} onClick={() => runNav("back")} disabled={!canGoBack}>
          <ArrowLeft className="size-icon" strokeWidth={1.5} />
        </PaneButton>
        <PaneButton label={t("Forward")} onClick={() => runNav("forward")} disabled={!canGoForward}>
          <ArrowRight className="size-icon" strokeWidth={1.5} />
        </PaneButton>
        <PaneButton label={t("Reload")} onClick={() => runNav("reload")} disabled={!active}>
          <RotateCw className={cn("size-icon", loading && "animate-spin text-accent")} strokeWidth={1.5} />
        </PaneButton>
        <form
          onSubmit={navigateUrl}
          className="mx-1 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-full bg-raised px-3 transition-colors focus-within:bg-hover"
        >
          {secure && <Lock className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />}
          <input
            type="text"
            value={draftUrl}
            onChange={(e) => setDraftUrl(e.target.value)}
            onFocus={(e) => {
              setUrlFocused(true);
              e.currentTarget.select();
            }}
            onBlur={() => setUrlFocused(false)}
            placeholder="https://"
            spellCheck={false}
            aria-label={t("Address")}
            className={cn(
              "min-w-0 flex-1 bg-transparent text-meta text-fg outline-none select-text placeholder:text-fg-faint",
              urlFocused ? "text-left" : "text-center",
            )}
          />
        </form>
        <button
          type="button"
          onClick={() => runNav("toggle_proxy")}
          title={proxyPort > 0 ? `Catcher :${proxyPort}` : t("Direct connection")}
          className={cn(
            "flex h-8 shrink-0 items-center rounded-md px-2 font-mono text-caption transition-colors duration-100 hover:bg-hover",
            proxyPort > 0 ? "text-status-ok" : "text-fg-faint hover:text-fg",
          )}
        >
          {proxyPort > 0 ? `:${proxyPort}` : t("Direct")}
        </button>
      </div>

      <div className="shrink-0 px-3 pb-3">
        {installing ? (
          <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 rounded-xl bg-panel p-6 text-center">
            <Download className="size-6 text-accent" strokeWidth={1.5} />
            <p className="text-body font-medium text-fg">{t("Downloading Chromium runtime")}</p>
            <p className="font-mono text-caption text-fg-dim">{installStatus || "Playwright Chromium"}</p>
          </div>
        ) : frame ? (
          <div
            ref={viewportRef}
            tabIndex={takeover ? 0 : -1}
            onMouseMove={handleMouseMove}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onWheel={handleWheel}
            onKeyDown={handleKeyDown}
            onContextMenu={(e) => {
              if (takeover) e.preventDefault();
            }}
            className={cn(
              "relative aspect-[16/10] w-full overflow-hidden rounded-xl bg-panel outline-none",
              takeover ? "cursor-crosshair ring-2 ring-accent" : "ring-1 ring-line",
            )}
          >
            <img
              ref={imgRef}
              src={frame}
              alt={tabTitle}
              className="pointer-events-none block h-full w-full select-none"
              draggable={false}
            />
            {lastHighlight && (
              <div
                className="pointer-events-none absolute rounded-sm border-2 border-status-warn bg-status-warn/15 transition-all duration-150"
                style={{
                  left: `${(lastHighlight.x / 1280) * 100}%`,
                  top: `${(lastHighlight.y / 800) * 100}%`,
                  width: `${(lastHighlight.width / 1280) * 100}%`,
                  height: `${(lastHighlight.height / 800) * 100}%`,
                }}
              >
                <span className="absolute -top-5 left-0 whitespace-nowrap rounded bg-status-warn px-1.5 py-0.5 font-mono text-[10px] font-semibold text-canvas">
                  {lastHighlight.action}
                  {lastHighlight.target ? `: ${lastHighlight.target}` : ""}
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-1 rounded-xl bg-panel p-6 text-center">
            <Globe className="mb-2 size-7 text-fg-faint" strokeWidth={1.25} />
            <p className="text-body font-medium text-fg">{t("Browser ready")}</p>
            <p className="text-meta text-fg-dim">
              {detected?.found ? t("Detected: {name}", { name: detected.label }) : t("No local Chrome or Edge found")}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={launchDefault}
                className="h-row-sm rounded-lg bg-fg-bright px-3 text-meta font-medium text-canvas transition-opacity hover:opacity-90"
              >
                {t("Launch browser")}
              </button>
              {!detected?.found && (
                <button
                  type="button"
                  onClick={installRuntime}
                  className="flex h-row-sm items-center gap-1.5 rounded-lg px-3 text-meta font-medium text-fg-dim transition-colors hover:bg-hover hover:text-fg"
                >
                  <Download className="size-icon-sm" strokeWidth={1.75} />
                  {t("Download Chromium")}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-row-sm shrink-0 items-center justify-between gap-3 px-4 text-caption">
          <span className="font-medium text-fg-faint">
            {t("Activity")}
            {history.length > 0 ? ` · ${history.length}` : ""}
          </span>
          <span className="min-w-0 truncate text-fg-faint" title={lastAction}>
            {[engineLabel, lastAction].filter(Boolean).join(" · ")}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {history.length === 0 ? (
            <p className="px-2 py-4 text-center text-meta text-fg-faint">{t("No browser actions yet.")}</p>
          ) : (
            history.map((item) => (
              <div key={item.id} className="flex items-baseline gap-3 rounded-md px-2 py-1.5 hover:bg-hover" title={item.url || undefined}>
                <span className="shrink-0 font-mono text-caption text-fg-faint">
                  {new Date(item.timestamp).toLocaleTimeString()}
                </span>
                <span className="shrink-0 text-meta text-fg">{item.action}</span>
                {(item.target || item.url) && (
                  <span className="min-w-0 truncate text-meta text-fg-dim">{item.target || item.url}</span>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
