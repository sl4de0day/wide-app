import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bridge, type AiAntigravityModelFamily, type AiCodexModel, type AiModelFile } from "@/lib/bridge";
import { useEffortChoice } from "@/components/chat/ComposerControls";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAi } from "@/stores/ai";

const formatBytes = (bytes: number): string => {
  if (!bytes) return "0 MB";
  const gigabytes = bytes / (1024 * 1024 * 1024);
  if (gigabytes >= 1) return `${gigabytes.toFixed(gigabytes >= 10 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(bytes / (1024 * 1024)))} MB`;
};

export function cleanModelName(raw: string): string {
  if (!raw) return "";
  let name = raw.trim();
  name = name.replace(/^(?:https?:\/\/)?(?:[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\/)+/, "");
  if (name.includes("/")) {
    name = name.split("/").pop() ?? name;
  }
  name = name.replace(/:latest$/i, "");
  if (name.includes(":")) {
    const colonIndex = name.lastIndexOf(":");
    const base = name.slice(0, colonIndex);
    const tag = name.slice(colonIndex + 1);
    if (
      /\.gguf$/i.test(tag) ||
      /^q\d/i.test(tag) ||
      /^f\d/i.test(tag) ||
      /-gguf$/i.test(base) ||
      tag.toLowerCase().includes(base.toLowerCase().replace(/[-_]gguf$/i, ""))
    ) {
      name = base;
    }
  }
  name = name.replace(/[-_.](?:gguf)$/i, "");
  return name;
}

const CLOUD_MODEL_NAMES: Record<string, string> = {
  "claude-code": "Claude Code",
  antigravity: "Antigravity",
  codex: "Codex",
  sonnet: "Sonnet 5.5",
  opus: "Opus 5.5",
  haiku: "Haiku 5.5",
};

export function formatCloudModelName(raw: string, provider?: string): string {
  if (!raw) {
    if (provider === "claude-code") return "Claude Code";
    if (provider === "antigravity") return "Antigravity";
    if (provider === "codex") return "Codex";
    return provider || "";
  }
  const clean = raw.trim();
  if (CLOUD_MODEL_NAMES[clean]) return CLOUD_MODEL_NAMES[clean];

  if (provider === "codex") {
    return clean
      .replace(/^gpt-/i, "GPT-")
      .split("-")
      .map((part, idx) => {
        if (idx === 0 && part.toUpperCase() === "GPT") return "GPT";
        if (/^\d+(?:\.\d+)?$/.test(part)) return part;
        return part ? part.charAt(0).toUpperCase() + part.slice(1) : "";
      })
      .join(" ")
      .replace(/^GPT (\d)/, "GPT-$1");
  }

  if (provider === "antigravity") {
    const family = clean.replace(/-(low|medium|high|xhigh|max)$/i, "");
    if (/^gpt-oss-120b$/i.test(family)) return "GPT-OSS 120B";
    return family
      .replace(/(\d+)-(\d+)/g, "$1.$2")
      .replace(/[-_]/g, " ")
      .split(" ")
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : ""))
      .join(" ");
  }

  return clean
    .replace(/^gemini[-_]/i, "Gemini ")
    .replace(/^deepseek[-_]/i, "DeepSeek ")
    .replace(/^claude[-_]/i, "Claude ")
    .replace(/[-_]/g, " ")
    .replace(/(\d+)\s+(\d+)/g, "$1.$2")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function FileRow({ file }: { file: AiModelFile }) {
  const t = useT();
  const pull = useAi((state) => state.pulls[file.reference]);
  const pulling = pull && pull.status !== "done" && pull.status !== "error";
  const percent = pull?.total ? Math.round((pull.completed / pull.total) * 100) : 0;
  const failed = pull?.status === "error";

  return (
    <div className="flex items-center gap-2 py-1.5 pl-7 pr-2.5">
      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-dim" title={file.path}>
        {file.quant || file.path}
      </span>
      <span className="shrink-0 text-[10px] tabular-nums text-fg-faint">{formatBytes(file.size)}</span>
      {pulling ? (
        <span className="w-10 shrink-0 text-right text-[10px] tabular-nums text-accent">
          {pull.total ? `${percent}%` : "…"}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => void useAi.getState().pull(file.reference)}
          title={failed ? `${pull.error || t("Failed")} · ${t("Try again")}` : t("Download and install this model")}
          aria-label={failed ? t("Try again") : t("Download and install this model")}
          className={cn(
            "w-8 shrink-0 rounded-md py-1 transition-colors duration-150 hover:bg-hover hover:text-fg",
            failed ? "text-status-error" : "text-fg-faint",
          )}
        >
          {failed ? (
            <RotateCw className="mx-auto size-3" strokeWidth={2} />
          ) : (
            <Download className="mx-auto size-3" strokeWidth={1.75} />
          )}
        </button>
      )}
    </div>
  );
}

function ModelRow({ id, name, source }: { id: string; name: string; source: string }) {
  const expanded = useAi((state) => state.expanded === id);
  const files = useAi((state) => state.files[id]);
  const t = useT();

  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() => void useAi.getState().expand(id, source)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors duration-150 hover:bg-hover"
      >
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-fg-faint" strokeWidth={2} />
        )}
        <span className="min-w-0 flex-1 truncate text-[12px] text-fg" title={id}>
          {cleanModelName(name)}
        </span>
      </button>
      {expanded && (
        <div className="wide-enter-fade pb-1.5">
          {!files ? (
            <p className="py-1 pl-7 text-[11px] text-fg-faint">{t("Reading the file list…")}</p>
          ) : files.length === 0 ? (
            <p className="py-1 pl-7 text-[11px] text-fg-faint">{t("No GGUF files in this one.")}</p>
          ) : (
            files.map((file) => <FileRow key={file.reference} file={file} />)
          )}
        </div>
      )}
    </div>
  );
}

function LocalHalf() {
  const t = useT();
  const query = useAi((state) => state.query);
  const results = useAi((state) => state.results);
  const searching = useAi((state) => state.searching);
  const recommended = useAi((state) => state.recommended);
  const installed = useAi((state) => state.installed);
  const ollama = useAi((state) => state.ollama);
  const hardware = useAi((state) => state.hardware);
  const busy = useAi((state) => state.busy);
  const ollamaStatusText = useAi((state) => state.ollamaStatusText);
  const ollamaError = useAi((state) => state.ollamaError);
  const config = useAi((state) => state.config);

  useEffect(() => {
    void useAi.getState().refreshLocal();
  }, []);

  const asked = useRef("");
  useEffect(() => {
    const wanted = query.trim();
    if (wanted.length < 2) {
      asked.current = "";
      return;
    }
    if (asked.current === wanted) return;
    const timer = setTimeout(() => {
      asked.current = wanted;
      void useAi.getState().search();
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  return (
    <>
      {!ollama.running && !ollama.installed && (
        <div className="border-b border-line bg-panel/30 px-3 py-3">
          <p className="text-[11px] leading-snug text-fg-dim">
            {t("Local models run through Ollama, which is not on this machine yet.")}
          </p>

          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void useAi.getState().setupOllama()}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[11px] font-medium shadow-xs transition-all duration-150",
                busy
                  ? "cursor-wait border-accent/40 bg-accent/15 text-accent"
                  : "border-accent bg-accent/10 text-accent hover:bg-accent hover:text-bg",
                "disabled:opacity-70",
              )}
            >
              {busy ? (
                <>
                  <Loader2 className="size-3.5 animate-spin text-accent" />
                  <span>{t("Installing Ollama…")}</span>
                </>
              ) : (
                <>
                  <Download className="size-3" />
                  <span>{t("Install Ollama")}</span>
                </>
              )}
            </button>

            {!busy && (
              <button
                type="button"
                onClick={() => void bridge.openExternal("https://ollama.com/download")}
                title={t("Visit Ollama official website")}
                className="inline-flex items-center gap-1 px-1 py-1 text-[11px] text-fg-faint transition-colors hover:text-fg hover:underline"
              >
                <span>ollama.com</span>
                <ExternalLink className="size-2.5" />
              </button>
            )}
          </div>

          {busy && (
            <div className="mt-2.5 rounded-md border border-accent/20 bg-accent/5 p-2 text-[11px] text-fg-dim">
              <div className="flex items-center gap-2">
                <Loader2 className="size-3.5 shrink-0 animate-spin text-accent" />
                <span className="font-medium text-accent">
                  {ollamaStatusText || t("Downloading and installing Ollama (this may take a few minutes)…")}
                </span>
              </div>
              <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-accent/15">
                <div className="h-full w-2/5 wide-pulse rounded-full bg-accent" />
              </div>
              <p className="mt-1.5 text-[10px] text-fg-faint">
                {t("Please do not close Wide while setup is in progress.")}
              </p>
            </div>
          )}

          {ollamaError && (
            <div className="mt-2.5 rounded-md border border-status-error/30 bg-status-error/10 p-2.5 text-[11px]">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-status-error" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-status-error">
                    {t("Ollama installation / start error")}
                  </div>
                  <p className="mt-0.5 break-words leading-tight text-fg-dim">
                    {ollamaError}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void useAi.getState().setupOllama()}
                      className="inline-flex items-center gap-1 rounded border border-status-error/30 bg-status-error/12 px-2.5 py-1 text-[10px] font-medium text-fg transition-colors hover:bg-status-error/20"
                    >
                      <RotateCw className="size-3" />
                      <span>{t("Retry")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void bridge.openExternal("https://ollama.com/download")}
                      className="inline-flex items-center gap-1 rounded border border-line bg-panel px-2.5 py-1 text-[10px] font-medium text-fg-dim transition-colors hover:bg-hover hover:text-fg"
                    >
                      <ExternalLink className="size-3" />
                      <span>{t("Download Manually (ollama.com)")}</span>
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  title={t("Dismiss")}
                  onClick={() => useAi.getState().clearOllamaError()}
                  className="rounded p-0.5 text-fg-faint transition-colors hover:bg-hover hover:text-fg"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {installed.length > 0 && (
        <>
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
            {t("On this machine")}
          </p>
          {installed.map((model) => {
            const active = config?.tab === "local" && config?.localModel === model.name;
            const displayName = cleanModelName(model.name);
            return (
              <button
                key={model.name}
                type="button"
                onClick={() => void useAi.getState().setConfig({ tab: "local", localModel: model.name })}
                className={cn(
                  "flex w-full items-center justify-between border-b border-line px-3 py-2 text-left transition-colors duration-150",
                  active ? "bg-selected" : "hover:bg-hover",
                )}
              >
                <div className="min-w-0 flex-1 truncate pr-2">
                  <div className="truncate text-[12px] font-medium text-fg" title={model.name}>
                    {displayName}
                  </div>
                  <div className="truncate text-[10px] text-fg-faint">
                    {[model.parameters, model.quantization].filter(Boolean).join(" · ") || t("Local LLM")}
                  </div>
                </div>
                <span className="shrink-0 text-[11px] tabular-nums text-fg-faint">{formatBytes(model.size)}</span>
              </button>
            );
          })}
        </>
      )}

      <div className="border-b border-line px-3 py-2.5">
        <div className="flex items-center gap-1.5 rounded-md border border-line bg-panel px-2.5">
          <Search className="size-3.5 shrink-0 text-fg-faint" strokeWidth={1.5} />
          <input
            value={query}
            onChange={(event) => useAi.getState().setQuery(event.target.value)}
            placeholder={t("Search for a model")}
            aria-label={t("Search for a model")}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[12px] text-fg outline-none placeholder:text-fg-faint"
          />
        </div>
        {hardware && (
          <p className="pt-1.5 text-[10px] leading-snug text-fg-faint">
            {t("This machine: {ram}{gpu}. Check a model fits before you download it.", {
              ram: formatBytes(hardware.totalRam),
              gpu: hardware.vram ? ` · ${formatBytes(hardware.vram)} ${t("on the GPU")}` : "",
            })}
          </p>
        )}
      </div>

      {query.trim().length >= 2 ? (
        <>
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
            {searching ? t("Searching…") : t("Results")}
          </p>
          {results.map((result) => (
            <ModelRow
              key={`${result.source}:${result.id}`}
              id={result.id}
              name={result.name}
              source={result.source}
            />
          ))}
          {!searching && results.length === 0 && (
            <p className="px-3 py-3 text-[12px] text-fg-faint">{t("Nothing matched that.")}</p>
          )}
        </>
      ) : (
        <>
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-fg-faint">
            {t("Recommended")}
          </p>
          {recommended.map((entry) =>
            entry.found && entry.id ? (
              <ModelRow key={entry.query} id={entry.id} name={entry.label} source="huggingface" />
            ) : (
              <div key={entry.query} className="border-b border-line px-3 py-2">
                <span className="text-[12px] text-fg-faint line-through">{entry.label}</span>
              </div>
            ),
          )}
        </>
      )}
    </>
  );
}

const CLAUDE_CODE_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "", label: "Default" },
  { id: "sonnet", label: "Sonnet 5.5" },
  { id: "opus", label: "Opus 5.5" },
  { id: "haiku", label: "Haiku 5.5" },
];

const CLAUDE_FALLBACK_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "", label: "None" },
  { id: "sonnet", label: "Sonnet 5.5" },
  { id: "haiku", label: "Haiku 5.5" },
];

interface ProviderAction {
  label: string;
  run: () => void;
}

interface ProviderView {
  checked: boolean;
  installed: boolean;
  signedIn: boolean;
  busy: boolean;
  account: string;
  note: string;
  models: { id: string; label: string }[];
  chosen: string | null;
  selectModel: (id: string) => void;
  actions: ProviderAction[];
  refresh: () => void;
  setting?: { label: string; value: string; next: () => void };
}

let claudeProbe: {
  checked: boolean;
  installed: boolean;
  signedIn: boolean;
  email: string;
  subscriptionType: string;
  authMethod: string;
} | null = null;

function useClaudeProvider(): ProviderView {
  const t = useT();
  const config = useAi((state) => state.config);
  const selected = config?.tab === "cloud" && config?.provider === "claude-code";
  const chosenModel = (config?.cloudModel?.["claude-code"] ?? "").trim().toLowerCase();
  const fallbackModel = (config?.claudeFallbackModel ?? "sonnet").trim().toLowerCase();
  const [state, setState] = useState(
    () =>
      claudeProbe ?? { checked: false, installed: false, signedIn: false, email: "", subscriptionType: "", authMethod: "" },
  );
  const [busy, setBusy] = useState(false);

  const check = () => {
    void bridge.aiClaudeCodeStatus().then((reply) => {
      claudeProbe = {
        checked: true,
        installed: Boolean(reply.ok && reply.installed),
        signedIn: Boolean(reply.ok && (reply.signedIn || reply.loggedIn)),
        email: String(reply.ok && reply.email ? reply.email : ""),
        subscriptionType: String(reply.ok && reply.subscriptionType ? reply.subscriptionType : ""),
        authMethod: String(reply.ok && reply.authMethod ? reply.authMethod : ""),
      };
      setState(claudeProbe);
    });
  };

  useEffect(() => {
    if (claudeProbe?.installed && claudeProbe?.signedIn) return;
    check();
  }, []);

  const act = async (what: "install" | "login" | "logout") => {
    setBusy(true);
    if (what === "install") await bridge.aiClaudeCodeInstall();
    else if (what === "logout") await bridge.aiClaudeCodeLogout();
    else await bridge.aiClaudeCodeLogin();
    setBusy(false);
    check();
  };

  const plan = state.subscriptionType || (state.authMethod === "claude.ai" ? "Claude.ai" : state.authMethod);
  const fallbackIndex = Math.max(0, CLAUDE_FALLBACK_MODELS.findIndex((m) => m.id === fallbackModel));
  const fallback = CLAUDE_FALLBACK_MODELS[fallbackIndex];

  return {
    checked: state.checked,
    installed: state.installed,
    signedIn: state.signedIn,
    busy,
    account: state.signedIn ? [state.email || t("Connected via Claude subscription"), plan].filter(Boolean).join(" · ") : "",
    note: t("Uses your Claude subscription rather than a key."),
    models: CLAUDE_CODE_MODELS.map((m) => ({ id: m.id, label: m.id === "" ? t("Default") : m.label })),
    chosen: selected ? chosenModel : null,
    selectModel: (id) =>
      void useAi.getState().setConfig({
        tab: "cloud",
        provider: "claude-code",
        cloudModel: { ...(useAi.getState().config?.cloudModel ?? {}), "claude-code": id },
      }),
    actions: !state.installed
      ? [{ label: t("Install"), run: () => void act("install") }]
      : state.signedIn
        ? [{ label: t("Sign out"), run: () => void act("logout") }]
        : [{ label: t("Sign in"), run: () => void act("login") }],
    refresh: check,
    setting: state.installed
      ? {
          label: t("Fallback model"),
          value: fallback.id === "" ? t("None") : fallback.label,
          next: () =>
            void useAi.getState().setConfig({
              claudeFallbackModel: CLAUDE_FALLBACK_MODELS[(fallbackIndex + 1) % CLAUDE_FALLBACK_MODELS.length].id,
            }),
        }
      : undefined,
  };
}

let antigravityProbe: {
  checked: boolean;
  installed: boolean;
  signedIn: boolean;
  version: string;
  mcpAttached: boolean;
  models: AiAntigravityModelFamily[];
} | null = null;

function useAntigravityProvider(): ProviderView {
  const t = useT();
  const config = useAi((state) => state.config);
  const selected = config?.tab === "cloud" && config?.provider === "antigravity";
  const chosenModel = (config?.cloudModel?.antigravity ?? "").trim();
  const [state, setState] = useState(
    () => antigravityProbe ?? { checked: false, installed: false, signedIn: false, version: "", mcpAttached: false, models: [] },
  );
  const [busy, setBusy] = useState(false);

  const check = (force = false) => {
    void bridge.aiAntigravityStatus(force ? { force: true } : undefined).then((reply) => {
      const models = Array.isArray(reply.models) ? reply.models : [];
      antigravityProbe = {
        checked: true,
        installed: Boolean(reply.ok && reply.installed),
        signedIn: Boolean(reply.ok && reply.signedIn),
        version: String(reply.ok && reply.version ? reply.version : ""),
        mcpAttached: Boolean(reply.ok && reply.mcpAttached),
        models,
      };
      if (models.length > 0) useAi.getState().setAntigravityModels(models);
      setState(antigravityProbe);
    });
  };

  useEffect(() => {
    if (antigravityProbe?.installed && antigravityProbe?.signedIn) return;
    check(Boolean(antigravityProbe));
  }, []);

  const act = async (what: "install" | "login" | "attachMcp") => {
    setBusy(true);
    if (what === "install") await bridge.aiAntigravityInstall();
    else if (what === "attachMcp") await bridge.aiAntigravityAttachMcp();
    else await bridge.aiAntigravityLogin();
    setBusy(false);
    check(true);
  };

  const actions: ProviderAction[] = !state.installed
    ? [{ label: t("Install"), run: () => void act("install") }]
    : !state.signedIn
      ? [{ label: t("Sign in"), run: () => void act("login") }]
      : state.mcpAttached
        ? []
        : [{ label: t("Attach Wide Tools"), run: () => void act("attachMcp") }];

  return {
    checked: state.checked,
    installed: state.installed,
    signedIn: state.signedIn,
    busy,
    account: state.signedIn
      ? [t("Connected via Google Antigravity"), state.version ? `v${state.version}` : ""].filter(Boolean).join(" · ")
      : "",
    note: t("Uses your Google Antigravity account."),
    models: [{ id: "", label: t("Default") }, ...state.models.map((m) => ({ id: m.id, label: m.label }))],
    chosen: selected ? chosenModel : null,
    selectModel: (id) =>
      void useAi.getState().setConfig({
        tab: "cloud",
        provider: "antigravity",
        cloudModel: { ...(useAi.getState().config?.cloudModel ?? {}), antigravity: id },
      }),
    actions,
    refresh: () => check(true),
  };
}

let codexProbe: {
  checked: boolean;
  installed: boolean;
  signedIn: boolean;
  version: string;
  email: string;
  planType: string;
  models: AiCodexModel[];
} | null = null;

function useCodexProvider(): ProviderView {
  const t = useT();
  const config = useAi((state) => state.config);
  const selected = config?.tab === "cloud" && config?.provider === "codex";
  const chosenModel = (config?.cloudModel?.codex ?? "").trim();
  const [state, setState] = useState(
    () => codexProbe ?? { checked: false, installed: false, signedIn: false, version: "", email: "", planType: "", models: [] },
  );
  const [busy, setBusy] = useState(false);

  const check = (force = false) => {
    void bridge.aiCodexStatus(force ? { force: true } : undefined).then((reply) => {
      const models = Array.isArray(reply.models) ? reply.models : [];
      codexProbe = {
        checked: true,
        installed: Boolean(reply.ok && reply.installed),
        signedIn: Boolean(reply.ok && reply.signedIn),
        version: String(reply.ok && reply.version ? reply.version : ""),
        email: String(reply.ok && reply.email ? reply.email : ""),
        planType: String(reply.ok && reply.planType ? reply.planType : ""),
        models,
      };
      useAi.getState().setCodexModels(models);
      setState(codexProbe);
    });
  };

  useEffect(() => {
    if (codexProbe?.installed && codexProbe?.signedIn) return;
    check(Boolean(codexProbe));
  }, []);

  const act = async (what: "install" | "login" | "logout") => {
    setBusy(true);
    if (what === "install") await bridge.aiCodexInstall();
    else if (what === "logout") await bridge.aiCodexLogout();
    else await bridge.aiCodexLogin();
    setBusy(false);
    check(true);
  };

  const selectModel = (modelId: string) => {
    const aiState = useAi.getState();
    const targetModel =
      (modelId ? state.models.find((m) => m.id === modelId || m.model === modelId) : state.models.find((m) => m.isDefault)) ||
      state.models[0];
    const supported = targetModel?.supportedReasoningEfforts?.map((o) => o.reasoningEffort) ?? [];
    const currentEffort = aiState.codexEffort;
    const nextEffort =
      supported.length > 0 && !supported.includes(currentEffort)
        ? targetModel?.defaultReasoningEffort && supported.includes(targetModel.defaultReasoningEffort)
          ? targetModel.defaultReasoningEffort
          : supported[0]
        : currentEffort;
    void aiState.setConfig({
      tab: "cloud",
      provider: "codex",
      cloudModel: { ...(aiState.config?.cloudModel ?? {}), codex: modelId },
      ...(nextEffort !== currentEffort ? { codexEffort: nextEffort } : {}),
    });
  };

  return {
    checked: state.checked,
    installed: state.installed,
    signedIn: state.signedIn,
    busy,
    account: state.signedIn
      ? [state.email || t("Connected via ChatGPT subscription"), state.planType].filter(Boolean).join(" · ")
      : "",
    note: t("Uses your ChatGPT subscription (Plus, Pro, Business)."),
    models: [{ id: "", label: t("Default") }, ...state.models.map((m) => ({ id: m.id, label: m.displayName || m.id }))],
    chosen: selected ? chosenModel : null,
    selectModel,
    actions: !state.installed
      ? [{ label: t("Install"), run: () => void act("install") }]
      : state.signedIn
        ? [{ label: t("Sign out"), run: () => void act("logout") }]
        : [{ label: t("Sign in"), run: () => void act("login") }],
    refresh: () => check(true),
  };
}

type CloudProvider = "claude-code" | "antigravity" | "codex";

const CLOUD_PROVIDERS: CloudProvider[] = ["claude-code", "codex", "antigravity"];

const PROVIDER_HOOKS: Record<CloudProvider, () => ProviderView> = {
  "claude-code": useClaudeProvider,
  antigravity: useAntigravityProvider,
  codex: useCodexProvider,
};

export function useModelLabel(): { label: string; ready: boolean } {
  const t = useT();
  const config = useAi((state) => state.config);
  const antigravityModels = useAi((state) => state.antigravityModels);
  const codexModels = useAi((state) => state.codexModels);

  if (!config) return { label: t("No model chosen"), ready: false };
  if (config.tab === "local") {
    return {
      label: config.localModel ? cleanModelName(config.localModel) : t("No model chosen"),
      ready: Boolean(config.localModel),
    };
  }
  if (config.provider === "codex") {
    const chosen = (config.cloudModel?.codex ?? "").trim();
    const matched = (codexModels.length > 0 ? codexModels : codexProbe?.models ?? []).find(
      (m) => m.id === chosen || m.model === chosen,
    );
    const suffix = matched ? matched.displayName || matched.id : chosen ? formatCloudModelName(chosen, "codex") : "";
    return { label: suffix || "Codex", ready: true };
  }
  if (config.provider === "antigravity") {
    const chosen = (config.cloudModel?.antigravity ?? "").trim();
    const matched = (antigravityModels.length > 0 ? antigravityModels : antigravityProbe?.models ?? []).find(
      (m) => m.id === chosen,
    );
    const suffix = matched ? matched.label : chosen ? formatCloudModelName(chosen, "antigravity") : "";
    return { label: suffix || "Antigravity", ready: true };
  }
  const chosen = (config.cloudModel?.["claude-code"] ?? "").trim().toLowerCase();
  const suffix = chosen === "sonnet" ? "Sonnet 5.5" : chosen === "opus" ? "Opus 5.5" : chosen === "haiku" ? "Haiku 5.5" : "";
  return { label: suffix || "Claude Code", ready: true };
}

const PROVIDER_NAMES: Record<CloudProvider, string> = {
  "claude-code": "Claude Code",
  antigravity: "Antigravity",
  codex: "OpenAI Codex",
};

const MENU_ROW =
  "flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-meta transition-colors duration-100 hover:bg-hover";

const MENU_PANEL = "wide-pop-up absolute z-30 rounded-xl border border-line bg-raised p-1 shadow-2xl";

function EffortMenu({ onDone }: { onDone: () => void }) {
  const effort = useEffortChoice();
  return (
    <div role="menu" className={cn(MENU_PANEL, "bottom-0 left-full ml-1 w-64")}>
      {effort.options.map((option) => {
        const chosen = option.value === effort.activeValue;
        const desc = effort.descOf(option);
        return (
          <button
            key={option.value}
            type="button"
            role="menuitemradio"
            aria-checked={chosen}
            onClick={() => {
              effort.select(option.value);
              onDone();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors duration-100 hover:bg-hover"
          >
            <span className="min-w-0 flex-1">
              <span className={cn("block text-meta", chosen ? "text-fg-bright" : "text-fg")}>{effort.labelOf(option)}</span>
              {desc && <span className="block truncate text-caption text-fg-faint">{desc}</span>}
            </span>
            {chosen && <Check className="size-icon-sm shrink-0 text-fg" strokeWidth={2} />}
          </button>
        );
      })}
    </div>
  );
}

function ProviderMenu({ provider, onDone }: { provider: CloudProvider; onDone: () => void }) {
  const t = useT();
  const view = PROVIDER_HOOKS[provider]();
  const caption = !view.checked ? t("Checking…") : view.account || view.note;
  return (
    <div role="menu" className={cn(MENU_PANEL, "bottom-0 left-full ml-1 flex max-h-[min(480px,70vh)] w-64 flex-col")}>
      <p className="truncate px-2.5 pb-1 pt-1.5 text-caption text-fg-faint" title={caption}>
        {caption}
      </p>

      {view.signedIn && (
        <div className="min-h-0 overflow-auto">
          {view.models.map((model) => {
            const chosen = view.chosen === model.id;
            return (
              <button
                key={model.id || "default"}
                type="button"
                role="menuitemradio"
                aria-checked={chosen}
                onClick={() => {
                  view.selectModel(model.id);
                  onDone();
                }}
                className={MENU_ROW}
              >
                <span className={cn("min-w-0 flex-1 truncate", chosen ? "text-fg-bright" : "text-fg")}>{model.label}</span>
                {chosen && <Check className="size-icon-sm shrink-0 text-fg" strokeWidth={2} />}
              </button>
            );
          })}
        </div>
      )}

      {view.checked && (
        <>
          <div className="mx-2 my-1 h-px shrink-0 bg-line" />
          {view.setting && (
            <button type="button" onClick={view.setting.next} className={MENU_ROW}>
              <span className="flex-1 text-fg">{view.setting.label}</span>
              <span className="shrink-0 text-fg-faint">{view.setting.value}</span>
            </button>
          )}
          {view.actions.map((action) => (
            <button key={action.label} type="button" disabled={view.busy} onClick={action.run} className={cn(MENU_ROW, "disabled:opacity-50")}>
              <span className="flex-1 text-fg">{view.busy ? t("Working…") : action.label}</span>
            </button>
          ))}
          <button type="button" disabled={view.busy} onClick={view.refresh} className={cn(MENU_ROW, "disabled:opacity-50")}>
            <span className="flex-1 text-fg-dim">{t("Refresh status")}</span>
            <RotateCw className="size-icon-sm shrink-0 text-fg-faint" strokeWidth={1.75} />
          </button>
        </>
      )}
    </div>
  );
}

function MoreModelsMenu() {
  return (
    <div className={cn(MENU_PANEL, "bottom-0 left-full ml-1 max-h-[min(480px,70vh)] w-[340px] overflow-auto p-0")}>
      <LocalHalf />
    </div>
  );
}

type SubMenu = CloudProvider | "effort" | "more";

export function ModelPicker({ className }: { className?: string } = {}) {
  const t = useT();
  const { label, ready } = useModelLabel();
  const config = useAi((state) => state.config);
  const error = useAi((state) => state.error);
  const effort = useEffortChoice();
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<SubMenu | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const onCloud = config?.tab === "cloud";
  const effortLabel = ready ? effort.labelOf(effort.current) : "";

  const close = () => {
    setOpen(false);
    setSub(null);
  };

  const pick = (provider: CloudProvider) => {
    void useAi.getState().setConfig({ tab: "cloud", provider });
    close();
  };

  useEffect(() => {
    void useAi.getState().load();
  }, []);

  useEffect(() => {
    if (!open) return;
    void useAi.getState().load();
    void useAi.getState().refreshLocal();
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (sub) setSub(null);
        else close();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < CLOUD_PROVIDERS.length) {
        event.preventDefault();
        pick(CLOUD_PROVIDERS[index]);
      }
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open, sub]);

  const toggleSub = (name: SubMenu) => setSub((was) => (was === name ? null : name));
  const hoverSub = (name: SubMenu) => setSub((was) => (was && was !== name ? name : was));

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        title={t("Providers and models")}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex max-w-[320px] items-center gap-1.5 transition-colors duration-150",
          className ?? "rounded-lg border border-line px-2 py-1 text-[12px] text-fg-dim hover:bg-hover hover:text-fg",
          open && "bg-hover text-fg",
        )}
      >
        {!ready && <span className="size-1.5 shrink-0 rounded-full bg-fg-faint/40" />}
        <span className="min-w-0 truncate">{label}</span>
        {effortLabel && <span className="shrink-0 text-fg-faint">{effortLabel}</span>}
        <ChevronDown className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-180")} strokeWidth={2} />
      </button>

      {open && (
        <div role="menu" className={cn(MENU_PANEL, "bottom-full left-0 mb-2 w-64")}>
          {error && (
            <button
              type="button"
              onClick={() => useAi.setState({ error: "" })}
              className="mb-1 w-full rounded-lg bg-status-error/10 px-2.5 py-1.5 text-left text-caption text-status-error"
            >
              {t(error)}
            </button>
          )}

          {CLOUD_PROVIDERS.map((provider, index) => {
            const chosen = onCloud && config?.provider === provider;
            return (
              <div key={provider} className="relative">
                <div
                  onMouseEnter={() => hoverSub(provider)}
                  className={cn("flex items-center rounded-lg", sub === provider && "bg-hover")}
                >
                  <button
                    type="button"
                    role="menuitemradio"
                    aria-checked={chosen}
                    onClick={() => pick(provider)}
                    className={cn(MENU_ROW, "min-w-0 flex-1 pr-1")}
                  >
                    <span className={cn("min-w-0 flex-1 truncate", chosen ? "text-fg-bright" : "text-fg")}>
                      {PROVIDER_NAMES[provider]}
                    </span>
                    {chosen && <Check className="size-icon-sm shrink-0 text-fg" strokeWidth={2} />}
                    <span className="w-3 shrink-0 text-right text-caption tabular-nums text-fg-faint">{index + 1}</span>
                  </button>
                  <button
                    type="button"
                    aria-haspopup="menu"
                    aria-expanded={sub === provider}
                    aria-label={t("Models and sign-in")}
                    title={t("Models and sign-in")}
                    onClick={() => toggleSub(provider)}
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-hover hover:text-fg"
                  >
                    <ChevronRight className="size-icon-sm" strokeWidth={2} />
                  </button>
                </div>
                {sub === provider && <ProviderMenu provider={provider} onDone={close} />}
              </div>
            );
          })}

          <div className="mx-2 my-1 h-px bg-line" />

          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={sub === "effort"}
              onClick={() => toggleSub("effort")}
              onMouseEnter={() => hoverSub("effort")}
              className={cn(MENU_ROW, sub === "effort" && "bg-hover")}
            >
              <span className="flex-1 text-fg">{t("Effort")}</span>
              <span className="shrink-0 text-fg-faint">{effort.labelOf(effort.current)}</span>
              <ChevronRight className="size-icon-sm shrink-0 text-fg-faint" strokeWidth={2} />
            </button>
            {sub === "effort" && <EffortMenu onDone={close} />}
          </div>

          <div className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={sub === "more"}
              onClick={() => toggleSub("more")}
              onMouseEnter={() => hoverSub("more")}
              className={cn(MENU_ROW, sub === "more" && "bg-hover")}
            >
              <span className="flex-1 text-fg">{t("More models")}</span>
              {config?.tab === "local" && <Check className="size-icon-sm shrink-0 text-fg" strokeWidth={2} />}
              <ChevronRight className="size-icon-sm shrink-0 text-fg-faint" strokeWidth={2} />
            </button>
            {sub === "more" && <MoreModelsMenu />}
          </div>
        </div>
      )}
    </div>
  );
}
