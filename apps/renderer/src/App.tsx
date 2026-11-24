import { ChevronLeft, Database, Settings, ShieldAlert, X } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { AiPanel } from "./panels/AiPanel";

const AiChatView = lazy(() => import("./components/AiChatView").then((m) => ({ default: m.AiChatView })));
const DatabaseView = lazy(() => import("./components/DatabaseView").then((m) => ({ default: m.DatabaseView })));
const DatabasePanel = lazy(() => import("./panels/DatabasePanel").then((m) => ({ default: m.DatabasePanel })));
const DatabaseConnectionModal = lazy(() => import("./panels/DatabasePanel").then((m) => ({ default: m.DatabaseConnectionModal })));
const SettingsView = lazy(() => import("./components/SettingsView").then((m) => ({ default: m.SettingsView })));
import { CommandPalette } from "./components/CommandPalette";
import { RecentProjectsOverlay } from "./components/RecentProjectsOverlay";
import { useRecentProjects } from "./stores/recentProjects";
import { useDatabase } from "./stores/database";
import { subscribeProjectScan, useProjectScan } from "./stores/projectScan";
import { AiEditsOverlay } from "./components/AiEditsOverlay";
import { McpTrustPrompt } from "./components/McpTrustPrompt";
import { useAiEdits } from "./stores/aiEdits";
import { sendSelectionToChat } from "./lib/sendToChat";
import { copyConversation, exportConversation } from "./lib/chatExport";
import { TitleBar } from "./components/TitleBar";
import { bridge } from "./lib/bridge";
import { requestCloseAll, requestCloseOthers, requestCloseTab } from "./lib/tabClose";
import { ConfirmHost } from "./components/ConfirmHost";
import { PromptHost } from "./components/PromptHost";
import { Toasts } from "./components/Toasts";
import { toast } from "./stores/toast";
import { cn } from "./lib/utils";
import { CrashReportDialog } from "./components/CrashReportDialog";
import { AiBrowserDrawer } from "./components/AiBrowserDrawer";
import { useAiBrowser } from "./stores/aiBrowser";
import { useTelemetry } from "./stores/telemetry";
import { useDiagnostics } from "./stores/diagnostics";
import { subscribeFindingsProject } from "./stores/findings";
import { AI_CHAT_PATH, DATABASE_PATH, SETTINGS_PATH, useEditor } from "./stores/editor";
import { subscribeAiEvents, subscribeAiPulls, useAi } from "./stores/ai";
import { subscribeProxyTraffic } from "./stores/proxy";
import { subscribeOast } from "./stores/oast";
import { subscribeDiscordPresence } from "./stores/discordPresence";
import { useExtensions } from "./stores/extensions";
import { useSession } from "./stores/session";
import { comboOf, useCommandPalette } from "./stores/commands";
import { resetEslintState } from "./editor/features/eslint";
import { resetLspState, subscribeLspDiagnostics } from "./editor/features/lsp";
import { parseProjectRules, parseSecurityConfig, setProjectRules, setSecurityConfig } from "./editor/features/inspect/engine";
import { forgetTailwindTheme } from "./editor/features/tailwind";
import { applyLanguage, isLanguage, useT } from "./lib/i18n";
import { applySyntaxPalette, applyTheme, hasStoredLanguage, hydrateSettingsFromDisk, useSettings } from "./stores/settings";
import { useUpdate } from "./stores/update";
import { subscribeFsChanges, useWorkspace } from "./stores/workspace";
import logo from "./assets/wide-logo.png";


function RemoteFallbackNotice() {
  const t = useT();
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("remoteFallback") === "1") {
        setShow(true);
        params.delete("remoteFallback");
        const query = params.toString();
        window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
      }
    } catch {

    }
  }, []);
  if (!show) return null;
  return (
    <div className="wide-enter-fade fixed left-1/2 top-14 z-50 flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-md border border-line bg-raised px-4 py-2 text-[12px] shadow-lg">
      <span className="text-status-warn">
        {t("The remote connection failed — running locally. Open Settings → Remote to check it.")}
      </span>
      <button
        type="button"
        onClick={() => setShow(false)}
        aria-label={t("Dismiss")}
        className="shrink-0 text-fg-faint transition-colors duration-100 hover:text-fg"
      >
        <X className="size-3.5" strokeWidth={2} />
      </button>
    </div>
  );
}



function SssfDegradedNotice() {
  const t = useT();
  const [state, setState] = useState<{ degraded: boolean; lastError: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    void bridge
      .sssfStatus()
      .then((reply) => { if (alive && reply.ok && reply.status) setState({ degraded: reply.status.degraded, lastError: reply.status.lastError }); })
      .catch(() => {});
    const off = bridge.onSssfChanged((status) => setState({ degraded: status.degraded, lastError: status.lastError }));
    return () => { alive = false; off(); };
  }, []);
  if (!state?.degraded) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[400] flex items-center justify-center gap-3 border-b border-status-error/40 bg-status-error/15 px-4 py-1.5 text-[12px]">
      <ShieldAlert className="size-4 shrink-0 text-status-error" strokeWidth={2} />
      <span className="text-status-error">{t("Security policy failed to load — Wide is locked. Fix the policy file, then reload.")}</span>
      {state.lastError && <span className="min-w-0 truncate text-fg-faint" title={state.lastError}>{state.lastError}</span>}
      <button
        type="button"
        onClick={() => void bridge.sssfReload()}
        className="shrink-0 rounded-sm border border-status-error/50 px-2 py-0.5 text-status-error transition-colors duration-100 hover:bg-status-error/20"
      >
        {t("Reload policy")}
      </button>
    </div>
  );
}



function BootGate() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-canvas">
      <img src={logo} alt="Wide" width={432} height={432} className="size-[432px] select-none wide-enter-fade" draggable={false} />
    </div>
  );
}

function DatabaseModalHost() {
  const open = useDatabase((s) => s.modalOpen);
  if (!open) return null;
  return (
    <Suspense fallback={null}>
      <DatabaseConnectionModal />
    </Suspense>
  );
}

export default function App() {
  const saveActive = useEditor((state) => state.saveActive);
  const formatActive = useEditor((state) => state.formatActive);
  const openFolder = useWorkspace((state) => state.openFolder);
  const rootName = useWorkspace((state) => state.rootName);
  const root = useWorkspace((state) => state.root);


  const settingsOpen = useEditor((state) => state.activePath === SETTINGS_PATH);
  const databaseOpen = useEditor((state) => state.activePath === DATABASE_PATH);
  const [sidebarTab, setSidebarTab] = useState<"ai" | "db">("ai");
  const booting = useUpdate((state) => state.booting);

  const closeTab = useEditor((state) => state.closeTab);
  const t = useT();

  const title = useEditor(
    useShallow((state) => {
      const tab = state.tabs.find((item) => item.path === state.activePath);
      return {
        name: tab?.name ?? null,
        dirty: tab?.kind === "file" ? tab.content !== tab.savedContent : false,
      };
    }),
  );


  useEffect(() => {

    const adjustFontSize = (delta: number) => {
      const current = useSettings.getState().fontSize;
      const next = Math.min(24, Math.max(10, current + delta));
      if (next !== current) useSettings.getState().set({ fontSize: next });
    };
    const onKeyDown = (event: KeyboardEvent) => {


      if (event.ctrlKey || event.metaKey || event.altKey) {
        const boundId = useCommandPalette.getState().bindings[comboOf(event)];
        if (boundId && useCommandPalette.getState().runById(boundId)) {
          event.preventDefault();
          return;
        }
      }
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      const key = event.key.toLowerCase();
      if (key === "s" && event.altKey) {
        event.preventDefault();
        const next = !useSettings.getState().streamerMode;
        useSettings.getState().set({ streamerMode: next });
        if (next) toast.success("Streamer mode enabled: secrets & API keys masked");
        else toast.info("Streamer mode disabled");
      } else if (key === "s" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        void saveActive();
      } else if (key === "o") {
        event.preventDefault();
        void openFolder();
      } else if (key === "w" && !event.shiftKey && !event.altKey) {

        const active = useEditor.getState().activePath;
        if (active) {
          event.preventDefault();
          void requestCloseTab(active);
        }
      } else if (key === "t" && event.shiftKey && !event.altKey) {

        event.preventDefault();
        useEditor.getState().reopenClosed();
      } else if (key === "," && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        useEditor.getState().openSettings();
      } else if (event.altKey && event.shiftKey && key === "f") {
        event.preventDefault();
        void formatActive();
      } else if (key === "r" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        useRecentProjects.getState().open();
      } else if (key === "l" && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        void (async () => {
          const newId = await useAi.getState().newSession();
          if (newId) useEditor.getState().openAiChat(newId, t("New conversation"));
        })();
      } else if (key === "p" && event.shiftKey) {
        event.preventDefault();
        useCommandPalette.getState().openPalette();
      } else if (key === "=" || key === "+") {


        event.preventDefault();
        adjustFontSize(1);
      } else if (key === "-" || key === "_") {
        event.preventDefault();
        adjustFontSize(-1);
      } else if (key === "0") {

        event.preventDefault();
        useSettings.getState().set({ fontSize: 13 });
      }
    };
    let wheelDelta = 0;
    let wheelTimer: ReturnType<typeof setTimeout> | null = null;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const target = event.target as Element | null;
      const isCodeEditor = Boolean(
        target?.closest(".cm-editor, [data-code-editor], .cm-scroller, .cm-content")
      );
      if (!isCodeEditor) return;
      wheelDelta += event.deltaY;
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => {
        wheelDelta = 0;
      }, 200);
      const threshold = 40;
      if (wheelDelta <= -threshold) {
        adjustFontSize(1);
        wheelDelta = 0;
      } else if (wheelDelta >= threshold) {
        adjustFontSize(-1);
        wheelDelta = 0;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("wheel", onWheel, true);
      if (wheelTimer) clearTimeout(wheelTimer);
    };



  }, [saveActive, openFolder, formatActive]);




  useEffect(() => {
    useDiagnostics.getState().reset();


    forgetTailwindTheme();
    resetEslintState();
    resetLspState();



    setProjectRules([]);
    setSecurityConfig(parseSecurityConfig(""));
    useCommandPalette.getState().setBindings({});
    if (root) {
      void bridge
        .readFile(`${root}/.wide/rules.json`)
        .then((file) => {
          if (file?.content) {
            const parsed = parseProjectRules(file.content);
            setProjectRules(parsed.rules);
            for (const error of parsed.errors) console.warn(`[inspections] ${error}`);
          } else {
            setProjectRules([]);
          }
        })
        .catch(() => setProjectRules([]));

      void bridge
        .readFile(`${root}/.wide/security.json`)
        .then((file) => setSecurityConfig(parseSecurityConfig(file?.content ?? "")))
        .catch(() => setSecurityConfig(parseSecurityConfig("")));


      void bridge
        .readFile(`${root}/.wide/keybindings.json`)
        .then((file) => {
          if (!file?.content) return;
          const parsed = JSON.parse(file.content) as { bindings?: Record<string, string> };
          if (parsed && parsed.bindings && typeof parsed.bindings === "object") {
            useCommandPalette.getState().setBindings(parsed.bindings);
          }
        })
        .catch(() => useCommandPalette.getState().setBindings({}));
    }
  }, [root]);


  useEffect(() => {
    useSession.getState().wipe();
    return () => useSession.getState().wipe();
  }, [root]);


  useEffect(() => {
    const marker = title.dirty ? "● " : "";
    const parts = [title.name && `${marker}${title.name}`, rootName, "Wide"];
    void bridge.setTitle(parts.filter(Boolean).join(" — "));
  }, [title, rootName]);

  useEffect(() => {
    applySyntaxPalette();
    applyLanguage();
    applyTheme();


    void useExtensions.getState().refresh();
    void useAi.getState().load();
  }, []);

  const activeAiChatId = useEditor((state) => {
    const active = state.tabs.find((t) => t.path === state.activePath);
    if (active?.kind === "ai-chat") return active.path.slice(AI_CHAT_PATH.length);
    for (let i = state.tabs.length - 1; i >= 0; i -= 1) {
      if (state.tabs[i].kind === "ai-chat") return state.tabs[i].path.slice(AI_CHAT_PATH.length);
    }
    return null;
  });



  useEffect(() => subscribeLspDiagnostics(), []);



  useEffect(() => subscribeAiEvents(), []);
  useEffect(() => subscribeAiPulls(), []);


  useEffect(() => subscribeProxyTraffic(), []);
  useEffect(() => subscribeOast(), []);

  useEffect(() => subscribeFsChanges(), []);

  useEffect(() => subscribeProjectScan(), []);
  useEffect(() => subscribeFindingsProject(), []);
  useEffect(() => subscribeDiscordPresence(), []);


  useEffect(() => {
    const off = bridge.onHostOpenPath(({ path }) => void useWorkspace.getState().openTarget(path));
    bridge.requestPendingOpenPath();
    return off;
  }, []);

  useEffect(() => {
    const offState = bridge.onBackendState(({ state }) => {
      if (state === "restarted") {
        toast.error(t("Wide's backend stopped and was restarted. Reopen your project to carry on; anything unsaved is still in the editor."));
      } else {
        toast.error(t("Wide's backend stopped and could not be restarted. Save your work elsewhere and restart Wide."));
      }
    });
    const offFault = bridge.onBackendFault(({ kind, detail }) => {
      const cleanDetail = detail ? detail.trim().slice(0, 140) : "";
      if (cleanDetail) {
        toast.error(t("Backend error ({kind}): {detail}", { kind: kind || "fault", detail: cleanDetail }));
      } else {
        toast.error(t("Something went wrong in Wide's backend. If a panel stops responding, restart Wide."));
      }
    });
    return () => {
      offState();
      offFault();
    };
  }, [t]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await hydrateSettingsFromDisk();
      if (cancelled) return;
      if (hasStoredLanguage()) return;
      const reply = await bridge.installLanguage().catch(() => null);
      const code = reply && reply.ok ? (reply.language ?? "") : "";
      if (!cancelled && code && isLanguage(code) && code !== useSettings.getState().language) {
        useSettings.getState().set({ language: code });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void useUpdate.getState().boot();
  }, []);

  useEffect(() => {
    void useTelemetry.getState().checkPending();
  }, []);

  useEffect(() => {
    const timer = setInterval(
      () => {
        void (async () => {
          await useUpdate.getState().check();
          await useUpdate.getState().stage();
        })();
      },
      6 * 60 * 60 * 1000,
    );
    return () => clearInterval(timer);
  }, []);


  const fontSize = useSettings((state) => state.fontSize);
  useEffect(() => {
    document.documentElement.style.setProperty("--editor-font-size", `${fontSize}px`);
  }, [fontSize]);

  useEffect(() => {
    const handleOpenPanel = (e: Event) => {
      const panelId = (e as CustomEvent<string>).detail;
      if (panelId === "db" || panelId === "database") setSidebarTab("db");
      else if (panelId === "ai") setSidebarTab("ai");
    };
    window.addEventListener("wide:open-panel", handleOpenPanel);
    return () => window.removeEventListener("wide:open-panel", handleOpenPanel);
  }, []);



  useEffect(() => {
    const has = (id: string) => useExtensions.getState().installed.has(id);
    const hasRoot = () => Boolean(useWorkspace.getState().root);
    useCommandPalette.getState().register([
      { id: "file.save", title: "Save", group: "File", key: "ctrl+s", run: () => void useEditor.getState().saveActive() },
      { id: "file.format", title: "Format Document", group: "File", key: "ctrl+alt+shift+f", run: () => void useEditor.getState().formatActive() },
      { id: "file.closeTab", title: "Close Tab", group: "File", key: "ctrl+w", run: () => { const a = useEditor.getState().activePath; if (a) void requestCloseTab(a); } },
      { id: "file.reopenClosedTab", title: "Reopen Closed Tab", group: "File", key: "ctrl+shift+t", run: () => useEditor.getState().reopenClosed() },
      { id: "file.closeOthers", title: "Close Other Tabs", group: "File", run: () => { const a = useEditor.getState().activePath; if (a) void requestCloseOthers(a); } },
      { id: "file.closeAll", title: "Close All Tabs", group: "File", run: () => void requestCloseAll() },
      { id: "view.settings", title: "Settings", group: "View", key: "ctrl+,", run: () => useEditor.getState().openSettings() },
      { id: "view.database", title: "Database", group: "View", run: () => { setSidebarTab("db"); useEditor.getState().openDatabase(); } },
      { id: "file.openFolder", title: "Open folder", group: "File", key: "ctrl+o", run: () => void useWorkspace.getState().openFolder() },
      { id: "file.openRecent", title: "Open Recent Project…", group: "File", key: "ctrl+r", run: () => useRecentProjects.getState().open() },
      { id: "view.ai", title: "AI Assistant", group: "View", when: () => has("ai-assistant"), run: () => setSidebarTab("ai") },
      { id: "ai.newChat", title: "New AI conversation", group: "AI", key: "ctrl+l", when: () => has("ai-assistant"), run: async () => { const newId = await useAi.getState().newSession(); if (newId) useEditor.getState().openAiChat(newId, t("New conversation")); } },
      { id: "ai.review", title: "Toggle: Review AI edits before applying", group: "AI", when: () => has("ai-assistant"), run: () => useAiEdits.getState().setReview(!useAiEdits.getState().reviewEnabled) },
      { id: "ai.ghost", title: "Toggle: Inline AI completions (ghost text)", group: "AI", when: () => has("ai-assistant"), run: () => useSettings.getState().set({ aiGhostText: !useSettings.getState().aiGhostText }) },
      { id: "ai.sendSelection", title: "Send the selection to the assistant", group: "AI", key: "ctrl+alt+a", when: () => has("ai-assistant"), run: () => void sendSelectionToChat() },
      { id: "ai.explainSelection", title: "Explain the selection", group: "AI", when: () => has("ai-assistant"), run: () => void sendSelectionToChat("Explain this code.") },
      { id: "ai.fixSelection", title: "AI: Find and fix bugs in selection", group: "AI", key: "ctrl+alt+f", when: () => has("ai-assistant"), run: () => void sendSelectionToChat("Review this code for bugs, logic errors, and security issues. Propose a clean fix.") },
      { id: "ai.refactorSelection", title: "AI: Refactor selection for clarity", group: "AI", when: () => has("ai-assistant"), run: () => void sendSelectionToChat("Refactor this code to be cleaner and more idiomatic without changing its behavior.") },
      { id: "ai.testsSelection", title: "AI: Write unit tests for selection", group: "AI", when: () => has("ai-assistant"), run: () => void sendSelectionToChat("Write thorough unit tests for this code.") },
      { id: "ai.docSelection", title: "AI: Document selection", group: "AI", when: () => has("ai-assistant"), run: () => void sendSelectionToChat("Add comprehensive documentation and comments to this code.") },
      { id: "ai.copyConversation", title: "Copy the conversation", group: "AI", when: () => has("ai-assistant"), run: () => void copyConversation() },
      { id: "ai.exportConversation", title: "Export the conversation to Markdown", group: "AI", when: () => has("ai-assistant"), run: () => void exportConversation() },
      { id: "security.toggle", title: "Toggle: Real-time security analysis", group: "Security", run: () => useSettings.getState().set({ securityLint: !useSettings.getState().securityLint }) },
      {
        id: "view.streamerMode",
        title: "Toggle Streamer Mode (Mask Secrets)",
        group: "View",
        key: "ctrl+alt+s",
        run: () => {
          const next = !useSettings.getState().streamerMode;
          useSettings.getState().set({ streamerMode: next });
          if (next) toast.success("Streamer mode enabled: secrets & API keys masked");
          else toast.info("Streamer mode disabled");
        },
      },
      { id: "security.projectScan", title: "Scan project for cross-file vulnerabilities", group: "Security", when: hasRoot, run: () => void useProjectScan.getState().run() },
      { id: "view.ai-browser", title: "AI Browser Stream", group: "View", run: () => useAiBrowser.getState().toggleDrawer() },
    ]);
  }, [t]);

  if (booting) return <BootGate />;

  return (
    <div className="relative flex h-full flex-col bg-canvas">
      <RemoteFallbackNotice />
      <SssfDegradedNotice />
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <div className="flex w-72 shrink-0 flex-col border-r border-line bg-panel">
          <div className="flex shrink-0 border-b border-line bg-chrome p-1 text-[11px] font-medium">
            <button
              type="button"
              onClick={() => setSidebarTab("ai")}
              className={cn(
                "flex-1 rounded px-2 py-1 transition-colors",
                sidebarTab === "ai" ? "bg-selected text-fg-bright" : "text-fg-dim hover:text-fg"
              )}
            >
              {t("AI Assistant")}
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab("db")}
              className={cn(
                "flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 transition-colors",
                sidebarTab === "db" ? "bg-selected text-fg-bright" : "text-fg-dim hover:text-fg"
              )}
            >
              <Database className="size-3" />
              {t("Database")}
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            {sidebarTab === "db" ? (
              <Suspense fallback={null}>
                <DatabasePanel />
              </Suspense>
            ) : (
              <AiPanel />
            )}
          </div>
          <div className="flex shrink-0 items-center border-t border-line px-3 py-2 bg-chrome">
            <button
              type="button"
              onClick={() => useEditor.getState().openSettings()}
              className="flex items-center gap-2 text-[12px] text-fg-dim hover:text-fg transition-colors"
            >
              <Settings className="size-3.5" />
              <span>{t("Settings")}</span>
            </button>
          </div>
        </div>

        <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-canvas">
          {settingsOpen ? (
            <div className="flex h-full flex-col bg-canvas">
              <div
                className="flex shrink-0 items-center border-b border-line px-2"
                style={{ height: "var(--h-tabbar)" }}
              >
                <button
                  type="button"
                  onClick={() => closeTab(SETTINGS_PATH)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-fg-dim",
                    "transition-colors duration-100 hover:bg-hover hover:text-fg",
                  )}
                >
                  <ChevronLeft className="size-3.5" strokeWidth={1.5} />
                  {t("Back")}
                </button>
              </div>
              <div className="min-h-0 flex-1">
              <Suspense fallback={null}>
                <SettingsView />
              </Suspense>
              </div>
            </div>
          ) : databaseOpen ? (
            <div className="flex h-full flex-col bg-canvas">
              <div
                className="flex shrink-0 items-center border-b border-line px-2"
                style={{ height: "var(--h-tabbar)" }}
              >
                <button
                  type="button"
                  onClick={() => closeTab(DATABASE_PATH)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] text-fg-dim",
                    "transition-colors duration-100 hover:bg-hover hover:text-fg",
                  )}
                >
                  <ChevronLeft className="size-3.5" strokeWidth={1.5} />
                  {t("Back")}
                </button>
              </div>
              <div className="min-h-0 flex-1">
              <Suspense fallback={null}>
                <DatabaseView />
              </Suspense>
              </div>
            </div>
          ) : activeAiChatId ? (
            <Suspense fallback={null}>
              <AiChatView key={activeAiChatId} id={activeAiChatId} />
            </Suspense>
          ) : (
            <div className="flex h-full items-center justify-center text-fg-dim">
              <div className="text-center">
                <img src={logo} alt="" className="mx-auto mb-5 size-36 select-none opacity-85" />
                <p className="text-[13px] text-fg-faint">{t("Select a conversation from the left or create a new one.")}</p>
                <button
                  type="button"
                  onClick={async () => {
                    const id = await useAi.getState().newSession();
                    if (id) useEditor.getState().openAiChat(id, t("New conversation"));
                  }}
                  className="mt-4 rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-white hover:bg-accent/90"
                >
                  {t("New conversation")}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
      <RecentProjectsOverlay />
      <CommandPalette />
      <AiEditsOverlay />
      <McpTrustPrompt />
      <ConfirmHost />
      <PromptHost />
      <Toasts />
      <CrashReportDialog />
      <AiBrowserDrawer />
      <DatabaseModalHost />
    </div>
  );
}
