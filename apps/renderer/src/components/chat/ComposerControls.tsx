import { AtSign, ChevronDown, Code2, Download, FileCode, FolderOpen, Globe, ImagePlus, Layers, MessageSquare, Plus, RefreshCw, Settings2, Shield, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge, type AiClaudeEffort, type AiToolMode } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAi } from "@/stores/ai";
import { useWorkspace } from "@/stores/workspace";
import wideLogo from "@/assets/wide-logo.png";

export function PlusMenu({
  session,
  onInsertMention,
  onPickImage,
  onExport,
  onOpenInstructions,
  onCompact,
}: {
  session: string;
  onInsertMention: () => void;
  onPickImage: () => void;
  onExport?: () => void;
  onOpenInstructions?: () => void;
  onCompact?: () => void;
}) {
  const t = useT();
  const root = useWorkspace((state) => state.root);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"menu" | "files">("menu");
  const [query, setQuery] = useState("");
  const [files, setFiles] = useState<{ path: string; relativePath: string }[]>([]);

  useEffect(() => {
    if (!open) {
      setMode("menu");
      setQuery("");
    }
  }, [open]);

  useEffect(() => {
    if (mode === "files" && root) {
      void bridge.listProjectFiles(root).then((reply) => setFiles(reply.files ?? []));
    }
  }, [mode, root]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((file) => !q || file.relativePath.toLowerCase().includes(q)).slice(0, 30);
  }, [files, query]);

  const handlePickFiles = async () => {
    const res = await bridge.openFile();
    if (res && res.path) {
      useAi.getState().attach(session, res.path);
      setOpen(false);
    }
  };

  const handlePickFolder = async () => {
    const res = await bridge.openFolder();
    if (res && res.path) {
      useAi.getState().attach(session, res.path);
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("Add context")}
        aria-label={t("Add context")}
        className={cn(
          "flex size-8 items-center justify-center rounded-full text-fg-dim transition-colors hover:bg-hover hover:text-fg",
          open && "bg-hover text-fg",
        )}
      >
        <Plus className="size-icon-lg" strokeWidth={1.75} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="wide-pop-up absolute bottom-full left-0 z-50 mb-2 w-52 overflow-hidden rounded-xl border border-line bg-raised p-1 shadow-2xl">
            {mode === "menu" ? (
              <div className="flex flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => setMode("files")}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-meta text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  <FileCode className="size-4 text-fg-dim" strokeWidth={1.75} />
                  <span>{t("Files")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handlePickFolder()}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-meta text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  <FolderOpen className="size-4 text-fg-dim" strokeWidth={1.75} />
                  <span>{t("Folder")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onInsertMention();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-meta text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  <AtSign className="size-4 text-fg-dim" strokeWidth={1.75} />
                  <span>{t("Mention")}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    onPickImage();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-meta text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                >
                  <ImagePlus className="size-4 text-fg-dim" strokeWidth={1.75} />
                  <span>{t("Attach image")}</span>
                </button>
                {onExport && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onExport();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-meta text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                  >
                    <Download className="size-4 text-fg-dim" strokeWidth={1.75} />
                    <span>{t("Export conversation as Markdown")}</span>
                  </button>
                )}
                {onCompact && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onCompact();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-meta text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                  >
                    <RefreshCw className="size-4 text-fg-dim" strokeWidth={1.75} />
                    <span>{t("Compact chat")}</span>
                  </button>
                )}
                {onOpenInstructions && (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onOpenInstructions();
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-meta text-fg-muted transition-colors hover:bg-hover hover:text-fg"
                  >
                    <Settings2 className="size-4 text-fg-dim" strokeWidth={1.75} />
                    <span>{t("Project Instructions")}</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5 border-b border-line px-2 py-1.5">
                  <button
                    type="button"
                    onClick={() => setMode("menu")}
                    className="flex size-6 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg"
                  >
                    <ChevronDown className="size-3.5 rotate-90" />
                  </button>
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("Search files…")}
                    spellCheck={false}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-fg-faint"
                  />
                  <button
                    type="button"
                    onClick={() => void handlePickFiles()}
                    title={t("Browse…")}
                    className="text-[10px] text-fg-dim hover:text-fg hover:underline shrink-0"
                  >
                    {t("Browse…")}
                  </button>
                </div>
                <div className="max-h-48 overflow-auto py-1">
                  {matches.length === 0 ? (
                    <p className="px-3 py-2 text-[11px] text-fg-faint">
                      {root ? t("No files match.") : t("Open a folder first.")}
                    </p>
                  ) : (
                    matches.map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => {
                          useAi.getState().attach(session, file.path);
                          setOpen(false);
                        }}
                        className="block w-full truncate px-3 py-1.5 text-left text-[12px] text-fg-dim transition-colors hover:bg-hover hover:text-fg font-mono"
                        title={file.relativePath}
                      >
                        {file.relativePath}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function PermissionBanner({ sessionId, activeTurn }: { sessionId: string; activeTurn: string | null }) {
  const t = useT();
  const pending = useAi((state) => state.pendingPermissions);
  const replyPermission = useAi((state) => state.replyPermission);
  const matching = pending.filter(
    (p) => !p.turnId || p.turnId === activeTurn || p.turnId.startsWith(`${sessionId}#`),
  );
  if (matching.length === 0) return null;

  return (
    <div className="shrink-0 px-6 pb-2">
      <div className="mx-auto flex w-full max-w-reading flex-col gap-2">
        {matching.map((req) => (
          <div key={req.requestId} className="wide-enter flex flex-col gap-3 rounded-xl border border-line bg-raised px-4 py-3 shadow-lg">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-body font-medium text-fg-bright">
                <Shield className="size-icon shrink-0 text-status-warn" strokeWidth={1.75} />
                <span>{req.title || t("Confirmation required")}</span>
              </div>
              {req.detail && <div className="mt-1 text-meta text-fg-dim">{req.detail}</div>}
              {req.command && (
                <pre className="mt-2 max-h-28 overflow-auto rounded-lg bg-canvas px-3 py-2 font-mono text-caption text-fg select-text">
                  {req.command}
                </pre>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => void replyPermission(req.requestId, false, "Denied by user")}
                className="h-row-sm rounded-lg px-3 text-meta font-medium text-fg-dim transition-colors hover:bg-hover hover:text-fg"
              >
                {t("Deny")}
              </button>
              <button
                type="button"
                onClick={() => void replyPermission(req.requestId, true)}
                className="h-row-sm rounded-lg bg-fg-bright px-3 text-meta font-medium text-canvas transition-opacity hover:opacity-90"
              >
                {t("Allow")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export const TOOL_MODE_OPTIONS: { value: AiToolMode; label: string; desc: string }[] = [
  { value: "full", label: "Full", desc: "All coding, security, and analysis tools" },
  { value: "code", label: "Code", desc: "Workspace, LSP, lint, tests, and terminal" },
  { value: "security", label: "Security", desc: "Catcher, OAST, HTTP, and vulnerability audits" },
];

export const QUIET_TRIGGER =
  "flex h-7 items-center gap-1.5 rounded-md px-2 text-meta text-fg-dim transition-colors hover:bg-hover hover:text-fg";

export function ToolModeIcon({ mode, className }: { mode: AiToolMode; className?: string }) {
  if (mode === "code") return <Code2 className={className} strokeWidth={2} />;
  if (mode === "security") return <Shield className={className} strokeWidth={2} />;
  return <Layers className={className} strokeWidth={2} />;
}

export function ToolModeToggle() {
  const t = useT();
  const toolMode = useAi((state) => state.toolMode);
  const setToolMode = useAi((state) => state.setToolMode);
  const [open, setOpen] = useState(false);
  const current = TOOL_MODE_OPTIONS.find((o) => o.value === toolMode) ?? TOOL_MODE_OPTIONS[0];

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={t("Assistant tool scope")}
        aria-label={t("Assistant tool scope")}
        className={cn(
          QUIET_TRIGGER,
          open && "bg-hover text-fg",
        )}
      >
        <ToolModeIcon mode={current.value} className="size-icon-sm shrink-0" />
        <span>{t(current.label)}</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="wide-pop-up absolute bottom-full right-0 z-50 mb-2 w-60 overflow-hidden rounded-xl border border-line bg-raised p-1 shadow-2xl">
            {TOOL_MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  void setToolMode(opt.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover",
                  toolMode === opt.value ? "bg-hover text-fg" : "text-fg-dim",
                )}
              >
                <ToolModeIcon mode={opt.value} className="mt-0.5 size-3.5 text-fg-dim shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-meta font-medium">{t(opt.label)}</div>
                  <div className="text-caption text-fg-faint">{t(opt.desc)}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function InteractionModeToggle() {
  const t = useT();
  const interactionMode = useAi((state) => state.interactionMode);
  const setInteractionMode = useAi((state) => state.setInteractionMode);
  const agent = interactionMode === "agent";

  return (
    <button
      type="button"
      onClick={() => void setInteractionMode(agent ? "ask" : "agent")}
      title={agent ? t("Agent mode: can edit files and run commands") : t("Ask mode: read-only analysis without writes")}
      aria-label={t("Execution mode")}
      className={QUIET_TRIGGER}
    >
      {agent ? (
        <Terminal className="size-icon-sm shrink-0" strokeWidth={1.75} />
      ) : (
        <MessageSquare className="size-icon-sm shrink-0" strokeWidth={1.75} />
      )}
      <span>{agent ? t("Agent") : t("Ask")}</span>
    </button>
  );
}

export function BrowserToggle() {
  const t = useT();
  const allowBrowser = useAi((state) => state.allowBrowser);
  const setAllowBrowser = useAi((state) => state.setAllowBrowser);

  return (
    <button
      type="button"
      onClick={() => void setAllowBrowser(!allowBrowser)}
      title={allowBrowser ? t("Browser tools enabled") : t("Browser tools disabled")}
      aria-pressed={allowBrowser}
      className={cn(QUIET_TRIGGER, allowBrowser ? "text-fg" : "text-fg-faint")}
    >
      <Globe className={cn("size-icon-sm shrink-0", allowBrowser && "text-accent")} strokeWidth={1.75} />
      <span>{t("Browser")}</span>
    </button>
  );
}

export interface EffortOptionItem {
  value: string;
  label: string;
  desc: string;
  translateDesc?: boolean;
}

export const EFFORT_OPTIONS: EffortOptionItem[] = [
  { value: "fast", label: "Fast", desc: "Quick, concise answers", translateDesc: true },
  { value: "thinking", label: "Thinking", desc: "Deep, thorough analysis", translateDesc: true },
];

export const CLAUDE_EFFORT_OPTIONS: EffortOptionItem[] = [
  { value: "low", label: "Low", desc: "Minimal reasoning for quick tasks", translateDesc: true },
  { value: "medium", label: "Medium", desc: "Balanced speed and depth", translateDesc: true },
  { value: "high", label: "High", desc: "Thorough multi-step reasoning", translateDesc: true },
  { value: "xhigh", label: "Extra High", desc: "Deep analysis for hard bugs", translateDesc: true },
  { value: "max", label: "Max", desc: "Maximum thinking budget", translateDesc: true },
];

export const EFFORT_META: Record<string, { label: string; desc: string }> = {
  minimal: { label: "Minimal", desc: "Fastest light reasoning" },
  low: { label: "Low", desc: "Minimal reasoning for quick tasks" },
  medium: { label: "Medium", desc: "Balanced speed and depth" },
  high: { label: "High", desc: "Thorough multi-step reasoning" },
  xhigh: { label: "Extra High", desc: "Deep analysis for hard bugs" },
  max: { label: "Max", desc: "Maximum thinking budget" },
  ultra: { label: "Ultra", desc: "Ultra deep extended reasoning" },
};

export const ANTIGRAVITY_VARIANT_ORDER: readonly AiClaudeEffort[] = ["low", "medium", "high", "xhigh"];
export const DEFAULT_CODEX_EFFORT_ORDER = ["low", "medium", "high", "xhigh"];

export interface EffortChoice {
  options: EffortOptionItem[];
  activeValue: string;
  current: EffortOptionItem;
  labelOf: (option: EffortOptionItem) => string;
  descOf: (option: EffortOptionItem) => string;
  select: (value: string) => void;
}

export function useEffortChoice(): EffortChoice {
  const t = useT();
  const config = useAi((state) => state.config);
  const effort = useAi((state) => state.effort);
  const claudeEffort = useAi((state) => state.claudeEffort);
  const antigravityEffort = useAi((state) => state.antigravityEffort);
  const codexEffort = useAi((state) => state.codexEffort);
  const antigravityModels = useAi((state) => state.antigravityModels);
  const codexModels = useAi((state) => state.codexModels);

  const isClaudeCode = config?.tab !== "local" && config?.provider === "claude-code";
  const isAntigravity = config?.tab !== "local" && config?.provider === "antigravity";
  const isCodex = config?.tab !== "local" && config?.provider === "codex";

  useEffect(() => {
    if (isAntigravity && antigravityModels.length === 0) {
      void bridge.aiAntigravityModels().then((res) => {
        if (res.ok && Array.isArray(res.models) && res.models.length > 0) {
          useAi.getState().setAntigravityModels(res.models);
        }
      });
    }
    if (isCodex && codexModels.length === 0) {
      void bridge.aiCodexModels().then((res) => {
        if (res.ok && Array.isArray(res.models) && res.models.length > 0) {
          useAi.getState().setCodexModels(res.models);
        }
      });
    }
  }, [isAntigravity, isCodex, antigravityModels.length, codexModels.length]);

  let options: EffortOptionItem[];
  let activeValue: string;

  if (isClaudeCode) {
    options = CLAUDE_EFFORT_OPTIONS;
    activeValue = claudeEffort;
  } else if (isAntigravity) {
    const chosenFamily = (config?.cloudModel?.antigravity ?? "").trim();
    const matched = chosenFamily ? antigravityModels.find((m) => m.id === chosenFamily) : undefined;
    const keys = matched?.variants ? ANTIGRAVITY_VARIANT_ORDER.filter((k) => Boolean(matched.variants[k])) : [];
    const effectiveKeys = keys.length > 0 ? keys : ANTIGRAVITY_VARIANT_ORDER;
    options = effectiveKeys.map((val) => ({
      value: val,
      label: EFFORT_META[val]?.label ?? val,
      desc: EFFORT_META[val]?.desc ?? "",
      translateDesc: true,
    }));
    activeValue = options.some((o) => o.value === antigravityEffort) ? antigravityEffort : (options[options.length - 1]?.value ?? options[0].value);
  } else if (isCodex) {
    const chosenCodex = (config?.cloudModel?.codex ?? "").trim();
    const matched =
      (chosenCodex ? codexModels.find((m) => m.id === chosenCodex || m.model === chosenCodex) : codexModels.find((m) => m.isDefault)) ||
      codexModels[0];
    if (matched?.supportedReasoningEfforts && matched.supportedReasoningEfforts.length > 0) {
      options = matched.supportedReasoningEfforts.map((opt) => {
        const meta = EFFORT_META[opt.reasoningEffort];
        return {
          value: opt.reasoningEffort,
          label: meta?.label ?? opt.reasoningEffort,
          desc: opt.description || meta?.desc || "",
          translateDesc: !opt.description && Boolean(meta),
        };
      });
      const fallbackVal =
        matched.defaultReasoningEffort && options.some((o) => o.value === matched.defaultReasoningEffort)
          ? matched.defaultReasoningEffort
          : options[0].value;
      activeValue = options.some((o) => o.value === codexEffort) ? codexEffort : fallbackVal;
    } else {
      options = DEFAULT_CODEX_EFFORT_ORDER.map((val) => ({
        value: val,
        label: EFFORT_META[val].label,
        desc: EFFORT_META[val].desc,
        translateDesc: true,
      }));
      activeValue = options.some((o) => o.value === codexEffort) ? codexEffort : "high";
    }
  } else {
    options = EFFORT_OPTIONS;
    activeValue = effort;
  }

  const current = options.find((o) => o.value === activeValue) ?? options[0];
  const translatable = (value: string) => Boolean(EFFORT_META[value]) || value === "fast" || value === "thinking";

  const select = (value: string) => {
    const ai = useAi.getState();
    if (isAntigravity) void ai.setAntigravityEffort(value as AiClaudeEffort);
    else if (isClaudeCode) void ai.setClaudeEffort(value as AiClaudeEffort);
    else if (isCodex) void ai.setCodexEffort(value);
    else ai.setEffort(value as "fast" | "thinking");
  };

  return {
    options,
    activeValue,
    current,
    labelOf: (option) => (translatable(option.value) ? t(option.label) : option.label),
    descOf: (option) => (option.translateDesc ? t(option.desc) : option.desc),
    select,
  };
}

export function useSpeechInput(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const supported = typeof window !== "undefined" &&
    ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

  const toggle = useCallback(() => {
    if (!supported) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const win = window as any;
    const SR = win.SpeechRecognition || win.webkitSpeechRecognition;
    const r = new SR();
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (event: any) => {
      const text = event.results?.[0]?.[0]?.transcript ?? "";
      if (text.trim()) onResult(text.trim());
      setListening(false);
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recognitionRef.current = r;
    r.start();
    setListening(true);
  }, [listening, onResult, supported]);

  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop(); } catch {}
    };
  }, []);

  return { listening, toggle, supported };
}

export function EmptyChat() {
  const t = useT();

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center py-8 text-center animate-in fade-in duration-300">
      <img
        src={wideLogo}
        alt=""
        draggable={false}
        className="mb-6 size-24 object-contain opacity-90 select-none"
      />
      <h2 className="text-title font-medium text-fg-bright">
        {t("How can I help you today?")}
      </h2>
    </div>
  );
}
