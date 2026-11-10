import { useEffect, useRef } from "react";
import { Activity, Clock, Globe, Lock, ShieldCheck, Terminal, X, ChevronRight } from "lucide-react";
import { useAiBrowser } from "@/stores/aiBrowser";

export function AiBrowserDrawer() {
  const active = useAiBrowser((s) => s.active);
  const drawerOpen = useAiBrowser((s) => s.drawerOpen);
  const url = useAiBrowser((s) => s.url);
  const title = useAiBrowser((s) => s.title);
  const lastAction = useAiBrowser((s) => s.lastAction);
  const frame = useAiBrowser((s) => s.frame);
  const history = useAiBrowser((s) => s.history);
  const status = useAiBrowser((s) => s.status);
  const setDrawerOpen = useAiBrowser((s) => s.setDrawerOpen);
  const toggleDrawer = useAiBrowser((s) => s.toggleDrawer);

  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logEndRef.current && drawerOpen) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [history.length, drawerOpen]);

  return (
    <>
      {!drawerOpen && active && (
        <button
          onClick={() => toggleDrawer()}
          className="fixed bottom-4 right-4 z-30 flex items-center gap-2 px-3 py-2 rounded-full bg-mono-900 border border-mono-700 shadow-xl text-mono-200 text-xs font-medium hover:bg-mono-800 transition"
        >
          <Globe className="w-4 h-4 text-sky-400" />
          <span>AI Browser Stream</span>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        </button>
      )}

      <div
        className={`fixed top-0 right-0 bottom-0 z-40 w-[620px] max-w-[95vw] bg-mono-950 border-l border-mono-800 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out select-none ${
          drawerOpen ? "translate-x-0" : "translate-x-full pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-mono-800 bg-mono-900 text-xs">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-sky-400" />
            <span className="font-semibold text-mono-100">AI Browser Drawer</span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/30">
              <Lock className="w-2.5 h-2.5" />
              READ ONLY
            </span>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {status.toUpperCase()}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => setDrawerOpen(false)}
              className="p-1.5 rounded text-mono-400 hover:text-mono-200 hover:bg-mono-800 transition"
              title="Close drawer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-3 py-1.5 border-b border-mono-800/80 bg-mono-900/40 flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 px-2.5 py-1 bg-mono-950 border border-mono-800 rounded text-mono-300 font-mono text-[11px] truncate">
            <Lock className="w-3 h-3 text-emerald-400 shrink-0" />
            <span className="truncate">{url || "about:blank"}</span>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-mono-400 shrink-0">
            <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
            <span>Autonomous</span>
          </div>
        </div>

        <div className="p-3 bg-mono-950 flex flex-col items-center justify-center border-b border-mono-800">
          {frame ? (
            <div className="relative border border-mono-800 rounded-lg overflow-hidden w-full bg-mono-900 shadow-md">
              <img
                src={frame}
                alt="AI Browser Screencast"
                className="w-full h-auto max-h-[46vh] object-contain pointer-events-none select-none"
                draggable={false}
              />
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-mono-950/80 border border-mono-700/60 text-[10px] text-mono-300 font-mono pointer-events-none">
                LIVE STREAM
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-6 text-center border border-dashed border-mono-800 rounded-lg w-full">
              <Globe className="w-8 h-8 text-mono-600 mb-2 animate-pulse" />
              <h4 className="font-semibold text-mono-200 text-xs mb-1">Autonomous Browser Ready</h4>
              <p className="text-[11px] text-mono-400">
                The AI agent will stream its active viewport here as it browses. User interactions are disabled to avoid session disruption.
              </p>
            </div>
          )}
        </div>

        <div className="px-3 py-1.5 bg-mono-900/60 border-b border-mono-800 text-[11px] text-mono-400 flex items-center justify-between">
          <div className="truncate font-semibold text-mono-300">{title}</div>
          <div className="text-mono-500 shrink-0 text-[10px]">Action: {lastAction}</div>
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
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </>
  );
}
