import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Clock,
  Download,
  Globe,
  Hand,
  Lock,
  Power,
  RotateCw,
  ShieldCheck,
  Terminal,
} from "lucide-react";
import { bridge, type AiBrowserDetectedInfo } from "@/lib/bridge";
import { forwardBrowserKey, forwardBrowserMouse, useAiBrowser } from "@/stores/aiBrowser";

export function AiBrowserDrawer() {
  const active = useAiBrowser((s) => s.active);
  const drawerOpen = useAiBrowser((s) => s.drawerOpen);
  const url = useAiBrowser((s) => s.url);
  const title = useAiBrowser((s) => s.title);
  const loading = useAiBrowser((s) => s.loading);
  const lastAction = useAiBrowser((s) => s.lastAction);
  const frame = useAiBrowser((s) => s.frame);
  const history = useAiBrowser((s) => s.history);
  const status = useAiBrowser((s) => s.status);
  const canGoBack = useAiBrowser((s) => s.canGoBack);
  const canGoForward = useAiBrowser((s) => s.canGoForward);
  const proxyPort = useAiBrowser((s) => s.proxyPort);
  const browserLabel = useAiBrowser((s) => s.browserLabel);
  const installing = useAiBrowser((s) => s.installing);
  const installStatus = useAiBrowser((s) => s.installStatus);
  const takeover = useAiBrowser((s) => s.takeover);
  const setDrawerOpen = useAiBrowser((s) => s.setDrawerOpen);
  const toggleDrawer = useAiBrowser((s) => s.toggleDrawer);
  const setTakeover = useAiBrowser((s) => s.setTakeover);
  const syncSession = useAiBrowser((s) => s.syncSession);
  const clear = useAiBrowser((s) => s.clear);

  const [draftUrl, setDraftUrl] = useState(url);
  const [urlFocused, setUrlFocused] = useState(false);
  const [detected, setDetected] = useState<AiBrowserDetectedInfo | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const lastMoveRef = useRef<number>(0);

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

  const navigateUrl = (event: FormEvent) => {
    event.preventDefault();
    const target = draftUrl.trim();
    if (!target) return;
    void bridge.aiBrowserNav({ action: active ? "goto" : "open", url: target }).then((res) => {
      if (res.ok && res.session) syncSession(res.session);
    });
  };

  const runNav = (action: "back" | "forward" | "reload" | "toggle_proxy") => {
    void bridge.aiBrowserNav({ action }).then((res) => {
      if (res.ok && res.session) syncSession(res.session);
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

  const engineLabel = browserLabel || (detected?.found ? detected.label : "Browser");

  return (
    <>
      {!drawerOpen && active && (
        <button
          type="button"
          onClick={() => toggleDrawer()}
          className="fixed bottom-4 right-4 z-30 flex items-center gap-2 px-3 py-2 rounded-full bg-mono-900 border border-mono-700 shadow-xl text-mono-200 text-xs font-medium hover:bg-mono-800 transition"
        >
          <Globe className="w-4 h-4 text-sky-400" />
          <span>AI Browser Stream</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </button>
      )}

      <div
        className={`fixed top-0 right-0 bottom-0 z-40 w-[640px] max-w-[95vw] bg-mono-950 border-l border-mono-800 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out select-none ${
          drawerOpen ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-mono-800 bg-mono-900 text-xs">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-sky-400" />
            <span className="font-semibold text-mono-100">AI Browser</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-mono-800 text-mono-300 border border-mono-700">
              {engineLabel}
            </span>
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${
                takeover
                  ? "bg-sky-500/15 text-sky-300 border-sky-500/40"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${takeover ? "bg-sky-400" : "bg-emerald-400 animate-pulse"}`} />
              {takeover ? "TAKEOVER" : status.toUpperCase()}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => runNav("toggle_proxy")}
              className={`px-2 py-0.5 rounded text-[10px] font-mono border transition ${
                proxyPort > 0
                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20"
                  : "bg-mono-950 text-mono-400 border-mono-800 hover:text-mono-200"
              }`}
            >
              {proxyPort > 0 ? `Catcher :${proxyPort}` : "Direct"}
            </button>
            <button
              type="button"
              onClick={() => setTakeover(!takeover)}
              disabled={!frame}
              className={`px-2 py-0.5 rounded text-[10px] border inline-flex items-center gap-1 transition disabled:opacity-40 ${
                takeover
                  ? "bg-sky-500/20 text-sky-300 border-sky-500/50 font-medium"
                  : "bg-mono-950 text-mono-300 border-mono-800 hover:bg-mono-800"
              }`}
            >
              <Hand className="w-3 h-3" />
              {takeover ? "Release" : "Take Control"}
            </button>
            {active && (
              <button
                type="button"
                onClick={closeSession}
                title="Close browser session"
                className="p-1 rounded text-mono-400 hover:text-red-400 hover:bg-mono-800 transition"
              >
                <Power className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setDrawerOpen(false)}
              className="p-1.5 rounded text-mono-400 hover:text-mono-200 hover:bg-mono-800 transition"
              title="Close drawer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-3 py-1.5 border-b border-mono-800/80 bg-mono-900/40 flex items-center gap-2">
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              disabled={!canGoBack}
              onClick={() => runNav("back")}
              className="p-1 rounded border border-mono-800 bg-mono-950 text-mono-300 hover:bg-mono-800 disabled:opacity-35 disabled:pointer-events-none"
            >
              <ArrowLeft className="w-3 h-3" />
            </button>
            <button
              type="button"
              disabled={!canGoForward}
              onClick={() => runNav("forward")}
              className="p-1 rounded border border-mono-800 bg-mono-950 text-mono-300 hover:bg-mono-800 disabled:opacity-35 disabled:pointer-events-none"
            >
              <ArrowRight className="w-3 h-3" />
            </button>
            <button
              type="button"
              disabled={!active}
              onClick={() => runNav("reload")}
              className="p-1 rounded border border-mono-800 bg-mono-950 text-mono-300 hover:bg-mono-800 disabled:opacity-35 disabled:pointer-events-none"
            >
              <RotateCw className={`w-3 h-3 ${loading ? "animate-spin text-sky-400" : ""}`} />
            </button>
          </div>
          <form onSubmit={navigateUrl} className="flex-1 flex items-center gap-2 px-2.5 py-1 bg-mono-950 border border-mono-800 rounded focus-within:border-sky-500/60">
            <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
            <input
              type="text"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              onFocus={() => setUrlFocused(true)}
              onBlur={() => setUrlFocused(false)}
              placeholder="https://..."
              className="w-full bg-transparent text-mono-200 font-mono text-[11px] outline-none select-text"
            />
          </form>
          <div className="flex items-center gap-1 text-[11px] text-mono-400 shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
            <span>{takeover ? "Manual" : "Autonomous"}</span>
          </div>
        </div>

        <div className="p-3 bg-mono-950 flex flex-col items-center justify-center border-b border-mono-800">
          {installing ? (
            <div className="flex flex-col items-center justify-center p-6 text-center border border-mono-800 rounded-lg w-full bg-mono-900/40">
              <Download className="w-8 h-8 text-sky-400 mb-2 animate-bounce" />
              <h4 className="font-semibold text-mono-100 text-xs mb-1">Downloading Chromium Runtime</h4>
              <p className="text-[11px] text-mono-400 font-mono">{installStatus || "Preparing Playwright Chromium..."}</p>
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
              className={`relative w-full aspect-[16/10] rounded-lg overflow-hidden bg-mono-900 shadow-md outline-none ${
                takeover ? "border-2 border-sky-500 cursor-crosshair" : "border border-mono-800"
              }`}
            >
              <img
                ref={imgRef}
                src={frame}
                alt="AI Browser Screencast"
                className="w-full h-full block pointer-events-none select-none"
                draggable={false}
              />
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-mono-950/80 border border-mono-700/60 text-[10px] text-mono-300 font-mono pointer-events-none">
                {takeover ? "INTERACTIVE" : "LIVE STREAM"}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-6 text-center border border-dashed border-mono-800 rounded-lg w-full">
              <Globe className="w-8 h-8 text-mono-600 mb-2" />
              <h4 className="font-semibold text-mono-200 text-xs mb-1">Autonomous Browser Ready</h4>
              <p className="text-[11px] text-mono-400 mb-3">
                {detected?.found ? `Detected: ${detected.label}` : "No local Chrome/Edge found"}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={launchDefault}
                  className="px-2.5 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-medium transition"
                >
                  Launch Browser
                </button>
                {!detected?.found && (
                  <button
                    type="button"
                    onClick={installRuntime}
                    className="px-2.5 py-1 rounded border border-mono-700 bg-mono-900 hover:bg-mono-800 text-mono-200 text-[11px] font-medium inline-flex items-center gap-1 transition"
                  >
                    <Download className="w-3 h-3" />
                    Download Chromium
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="px-3 py-1.5 bg-mono-900/60 border-b border-mono-800 text-[11px] text-mono-400 flex items-center justify-between">
          <div className="truncate font-semibold text-mono-300 max-w-[360px]">{title}</div>
          <div className="text-mono-500 shrink-0 text-[10px]">{lastAction}</div>
        </div>

        <div className="flex-1 flex flex-col min-h-0 bg-mono-900/40">
          <div className="px-3 py-1.5 border-b border-mono-800 flex items-center justify-between text-[11px] font-semibold text-mono-300">
            <span className="flex items-center gap-1.5">
              <Terminal className="w-3 h-3 text-sky-400" />
              Activity Feed ({history.length})
            </span>
            <span className="flex items-center gap-1 text-[10px] text-mono-500 font-normal">
              <Activity className="w-3 h-3 text-emerald-400" />
              Live Log
            </span>
          </div>

          <div className="flex-1 p-2 overflow-y-auto font-mono text-[11px] space-y-1.5">
            {history.length === 0 ? (
              <div className="text-mono-500 text-center py-6 text-[11px]">No browser actions executed yet.</div>
            ) : (
              history.map((item) => (
                <div key={item.id} className="p-2 rounded bg-mono-950 border border-mono-800/80 flex flex-col gap-1">
                  <div className="flex items-center justify-between text-[10px] text-mono-500">
                    <span className="flex items-center gap-1 text-sky-400">
                      <Clock className="w-2.5 h-2.5" />
                      {new Date(item.timestamp).toLocaleTimeString()}
                    </span>
                    {item.target && <span className="text-mono-400 truncate max-w-[140px]">{item.target}</span>}
                  </div>
                  <div className="text-mono-200 font-semibold truncate">{item.action}</div>
                  {item.url && <div className="text-[10px] text-mono-400 truncate">{item.url}</div>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
