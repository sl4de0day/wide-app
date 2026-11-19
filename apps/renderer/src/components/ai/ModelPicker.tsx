import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Cloud,
  Download,
  ExternalLink,
  HardDrive,
  Loader2,
  RotateCw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bridge, type AiAntigravityModelFamily, type AiCodexModel, type AiModelFile } from "@/lib/bridge";
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
  sonnet: "Sonnet",
  opus: "Opus",
  haiku: "Haiku",
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
    if (wanted.length < 2 || asked.current === wanted) return;
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
                <div className="h-full w-2/5 animate-[pulse_1.5s_ease-in-out_infinite] rounded-full bg-accent" />
              </div>
              <p className="mt-1.5 text-[10px] text-fg-faint">
                {t("Please do not close Wide while setup is in progress.")}
              </p>
            </div>
          )}

          {ollamaError && (
            <div className="mt-2.5 rounded-md border border-rose-500/30 bg-rose-500/10 p-2.5 text-[11px]">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0 text-rose-400" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-rose-300">
                    {t("Ollama installation / start error")}
                  </div>
                  <p className="mt-0.5 break-words leading-tight text-rose-300/80">
                    {ollamaError}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void useAi.getState().setupOllama()}
                      className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2.5 py-1 text-[10px] font-medium text-rose-200 transition-colors hover:bg-rose-500/30"
                    >
                      <RotateCw className="size-3" />
                      <span>{t("Retry")}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void bridge.openExternal("https://ollama.com/download")}
                      className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-2.5 py-1 text-[10px] font-medium text-rose-200 transition-colors hover:bg-rose-500/30"
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
                  className="rounded p-0.5 text-rose-400/60 transition-colors hover:bg-rose-500/20 hover:text-rose-400"
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
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "haiku", label: "Haiku" },
];

const CLAUDE_FALLBACK_MODELS: ReadonlyArray<{ id: string; label: string }> = [
  { id: "", label: "None" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
];

let claudeProbe: {
  checked: boolean;
  installed: boolean;
  signedIn: boolean;
  email: string;
  subscriptionType: string;
  authMethod: string;
} | null = null;

function ClaudeCodeCard() {
  const t = useT();
  const config = useAi((state) => state.config);
  const selected = config?.tab === "cloud" && config?.provider === "claude-code";
  const chosenModel = (config?.cloudModel?.["claude-code"] ?? "").trim().toLowerCase();
  const fallbackModel = (config?.claudeFallbackModel ?? "sonnet").trim().toLowerCase();
  const [state, setState] = useState(
    () =>
      claudeProbe ?? {
        checked: false,
        installed: false,
        signedIn: false,
        email: "",
        subscriptionType: "",
        authMethod: "",
      },
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
    if (claudeProbe) return;
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

  const selectClaudeModel = (modelId: string) => {
    void useAi.getState().setConfig({
      tab: "cloud",
      provider: "claude-code",
      cloudModel: { ...(config?.cloudModel ?? {}), "claude-code": modelId },
    });
  };

  const subBadge = state.subscriptionType || (state.authMethod === "claude.ai" ? "Claude.ai" : state.authMethod);

  return (
    <div className="border-b border-line">
      <div className={cn("flex w-full items-center gap-1 pr-2 transition-colors duration-150", selected ? "bg-selected" : "hover:bg-hover")}>
        <button
          type="button"
          onClick={() =>
            state.installed
              ? void useAi.getState().setConfig({ tab: "cloud", provider: "claude-code" })
              : void act("install")
          }
          disabled={busy}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left disabled:opacity-60"
        >
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              state.signedIn ? "bg-emerald-400" : state.installed ? "bg-amber-400" : "bg-fg-faint/40",
            )}
          />
          <span className={cn("min-w-0 flex-1 truncate text-[12px] font-medium", selected ? "text-fg-bright" : "text-fg")}>
            Claude Code
          </span>
          {subBadge && state.signedIn && (
            <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-medium uppercase text-emerald-400">
              {subBadge}
            </span>
          )}
          <span className="shrink-0 text-[10.5px] font-medium text-accent">
            {busy ? t("Working…") : !state.checked ? t("Checking…") : state.installed ? "" : t("Install")}
          </span>
        </button>
        {state.installed && (
          <button
            type="button"
            disabled={busy}
            onClick={() => check()}
            title={t("Refresh status")}
            aria-label={t("Refresh status")}
            className="flex size-6 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <RotateCw className="size-3" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {state.checked && state.installed && (
        <div className="space-y-2 px-3 pb-2.5 pt-1">
          {!state.signedIn ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10.5px] leading-snug text-fg-faint">
                {t("Uses your Claude subscription rather than a key.")}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("login")}
                className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[11px] text-fg-dim transition-colors duration-150 hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                {t("Sign in")}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 text-[10.5px] text-fg-faint">
              <span className="truncate">{state.email || t("Connected via Claude subscription")}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("logout")}
                className="shrink-0 rounded border border-line/70 px-2 py-0.5 text-[10px] text-fg-faint hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                {t("Sign out")}
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1">
            {CLAUDE_CODE_MODELS.map((opt) => {
              const activeModel = selected && chosenModel === opt.id;
              return (
                <button
                  key={opt.id || "default"}
                  type="button"
                  onClick={() => selectClaudeModel(opt.id)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[10.5px] transition-colors",
                    activeModel
                      ? "border-accent/50 bg-accent/15 text-accent font-medium"
                      : "border-line/70 text-fg-dim hover:bg-hover hover:text-fg",
                  )}
                >
                  {opt.id === "" ? t("Default") : opt.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 text-[10px] text-fg-faint">
            <span>{t("Fallback model")}</span>
            <div className="flex items-center gap-1">
              {CLAUDE_FALLBACK_MODELS.map((opt) => (
                <button
                  key={opt.id || "none"}
                  type="button"
                  onClick={() => void useAi.getState().setConfig({ claudeFallbackModel: opt.id })}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] transition-colors",
                    fallbackModel === opt.id
                      ? "bg-hover text-fg-bright font-medium"
                      : "text-fg-faint hover:bg-hover hover:text-fg",
                  )}
                >
                  {opt.id === "" ? t("None") : opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {state.checked && !state.installed && (
        <div className="px-3 pb-2.5">
          <p className="text-[10.5px] leading-snug text-fg-faint">
            {t("Uses your Claude subscription rather than a key.")}
          </p>
        </div>
      )}
    </div>
  );
}

let antigravityProbe: {
  checked: boolean;
  installed: boolean;
  signedIn: boolean;
  version: string;
  mcpAttached: boolean;
  models: AiAntigravityModelFamily[];
} | null = null;

function AntigravityCard() {
  const t = useT();
  const config = useAi((state) => state.config);
  const selected = config?.tab === "cloud" && config?.provider === "antigravity";
  const chosenModel = (config?.cloudModel?.antigravity ?? "").trim();
  const [state, setState] = useState(
    () =>
      antigravityProbe ?? {
        checked: false,
        installed: false,
        signedIn: false,
        version: "",
        mcpAttached: false,
        models: [],
      },
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
      useAi.getState().setAntigravityModels(models);
      setState(antigravityProbe);
    });
  };

  useEffect(() => {
    if (antigravityProbe) return;
    check(false);
  }, []);

  const act = async (what: "install" | "login" | "attachMcp") => {
    setBusy(true);
    if (what === "install") await bridge.aiAntigravityInstall();
    else if (what === "attachMcp") await bridge.aiAntigravityAttachMcp();
    else await bridge.aiAntigravityLogin();
    setBusy(false);
    check(true);
  };

  const selectAntigravityModel = (modelId: string) => {
    void useAi.getState().setConfig({
      tab: "cloud",
      provider: "antigravity",
      cloudModel: { ...(config?.cloudModel ?? {}), antigravity: modelId },
    });
  };

  return (
    <div className="border-b border-line">
      <div className={cn("flex w-full items-center gap-1 pr-2 transition-colors duration-150", selected ? "bg-selected" : "hover:bg-hover")}>
        <button
          type="button"
          onClick={() =>
            state.installed
              ? void useAi.getState().setConfig({ tab: "cloud", provider: "antigravity" })
              : void act("install")
          }
          disabled={busy}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left disabled:opacity-60"
        >
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              state.signedIn ? "bg-emerald-400" : state.installed ? "bg-amber-400" : "bg-fg-faint/40",
            )}
          />
          <span className={cn("min-w-0 flex-1 truncate text-[12px] font-medium", selected ? "text-fg-bright" : "text-fg")}>
            Antigravity
          </span>
          {state.version && state.installed && (
            <span className="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[9.5px] font-medium text-fg-faint">
              v{state.version}
            </span>
          )}
          <span className="shrink-0 text-[10.5px] font-medium text-accent">
            {busy ? t("Working…") : !state.checked ? t("Checking…") : state.installed ? "" : t("Install")}
          </span>
        </button>
        {state.installed && (
          <button
            type="button"
            disabled={busy}
            onClick={() => check(true)}
            title={t("Refresh status")}
            aria-label={t("Refresh status")}
            className="flex size-6 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <RotateCw className="size-3" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {state.checked && state.installed && (
        <div className="space-y-2 px-3 pb-2.5 pt-1">
          {!state.signedIn ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10.5px] leading-snug text-fg-faint">
                {t("Uses your Google Antigravity account.")}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("login")}
                className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[11px] text-fg-dim transition-colors duration-150 hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                {t("Sign in")}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 text-[10.5px] text-fg-faint">
              <span className="truncate">{t("Connected via Google Antigravity")}</span>
              {state.mcpAttached ? (
                <span className="shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9.5px] font-medium text-emerald-400">
                  {t("Wide MCP attached")}
                </span>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("attachMcp")}
                  className="shrink-0 rounded border border-line/70 px-2 py-0.5 text-[10px] text-fg-faint hover:bg-hover hover:text-fg disabled:opacity-40"
                >
                  {t("Attach Wide Tools")}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1">
            {[{ id: "", label: "Default" }, ...state.models.map((m) => ({ id: m.id, label: m.label }))].map((opt) => {
              const activeModel = selected && chosenModel === opt.id;
              return (
                <button
                  key={opt.id || "default"}
                  type="button"
                  onClick={() => selectAntigravityModel(opt.id)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[10.5px] transition-colors",
                    activeModel
                      ? "border-accent/50 bg-accent/15 text-accent font-medium"
                      : "border-line/70 text-fg-dim hover:bg-hover hover:text-fg",
                  )}
                >
                  {opt.id === "" ? t("Default") : opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {state.checked && !state.installed && (
        <div className="px-3 pb-2.5">
          <p className="text-[10.5px] leading-snug text-fg-faint">
            {t("Uses your Google Antigravity account.")}
          </p>
        </div>
      )}
    </div>
  );
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

function CodexCard() {
  const t = useT();
  const config = useAi((state) => state.config);
  const selected = config?.tab === "cloud" && config?.provider === "codex";
  const chosenModel = (config?.cloudModel?.codex ?? "").trim();
  const [state, setState] = useState(
    () =>
      codexProbe ?? {
        checked: false,
        installed: false,
        signedIn: false,
        version: "",
        email: "",
        planType: "",
        models: [],
      },
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
    if (codexProbe) return;
    check(false);
  }, []);

  const act = async (what: "install" | "login" | "logout") => {
    setBusy(true);
    if (what === "install") await bridge.aiCodexInstall();
    else if (what === "logout") await bridge.aiCodexLogout();
    else await bridge.aiCodexLogin();
    setBusy(false);
    check(true);
  };

  const selectCodexModel = (modelId: string) => {
    const aiState = useAi.getState();
    const targetModel =
      (modelId
        ? state.models.find((m) => m.id === modelId || m.model === modelId)
        : state.models.find((m) => m.isDefault)) || state.models[0];
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
      cloudModel: { ...(config?.cloudModel ?? {}), codex: modelId },
      ...(nextEffort !== currentEffort ? { codexEffort: nextEffort } : {}),
    });
  };

  return (
    <div>
      <div
        className={cn(
          "flex w-full items-center gap-1 pr-2 transition-colors duration-150",
          selected ? "bg-selected" : "hover:bg-hover",
        )}
      >
        <button
          type="button"
          onClick={() =>
            state.installed
              ? void useAi.getState().setConfig({ tab: "cloud", provider: "codex" })
              : void act("install")
          }
          disabled={busy}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left disabled:opacity-60"
        >
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              state.signedIn ? "bg-emerald-400" : state.installed ? "bg-amber-400" : "bg-fg-faint/40",
            )}
          />
          <span className={cn("min-w-0 flex-1 truncate text-[12px] font-medium", selected ? "text-fg-bright" : "text-fg")}>
            OpenAI Codex
          </span>
          {state.version && state.installed && (
            <span className="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[9.5px] font-medium text-fg-faint">
              v{state.version.replace(/^codex-cli\s+/i, "")}
            </span>
          )}
          <span className="shrink-0 text-[10.5px] font-medium text-accent">
            {busy ? t("Working…") : !state.checked ? t("Checking…") : state.installed ? "" : t("Install")}
          </span>
        </button>
        {state.installed && (
          <button
            type="button"
            disabled={busy}
            onClick={() => check(true)}
            title={t("Refresh status")}
            aria-label={t("Refresh status")}
            className="flex size-6 shrink-0 items-center justify-center rounded text-fg-faint hover:bg-hover hover:text-fg disabled:opacity-40"
          >
            <RotateCw className="size-3" strokeWidth={1.75} />
          </button>
        )}
      </div>

      {state.checked && state.installed && (
        <div className="space-y-2 px-3 pb-2.5 pt-1">
          {!state.signedIn ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10.5px] leading-snug text-fg-faint">
                {t("Uses your ChatGPT subscription (Plus, Pro, Business).")}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("login")}
                className="shrink-0 rounded-md border border-line px-2.5 py-1 text-[11px] text-fg-dim transition-colors duration-150 hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                {t("Sign in")}
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2 text-[10.5px] text-fg-faint">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate">{state.email || t("Connected via ChatGPT subscription")}</span>
                {state.planType && (
                  <span className="shrink-0 rounded bg-panel px-1.5 py-0.5 text-[9.5px] uppercase text-fg-dim">
                    {state.planType}
                  </span>
                )}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act("logout")}
                className="shrink-0 rounded border border-line/70 px-2 py-0.5 text-[10px] text-fg-faint hover:bg-hover hover:text-fg disabled:opacity-40"
              >
                {t("Sign out")}
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-1">
            {[{ id: "", label: "Default" }, ...state.models.map((m) => ({ id: m.id, label: m.displayName || m.id }))].map((opt) => {
              const activeModel = selected && chosenModel === opt.id;
              return (
                <button
                  key={opt.id || "default"}
                  type="button"
                  onClick={() => selectCodexModel(opt.id)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-[10.5px] transition-colors",
                    activeModel
                      ? "border-accent/50 bg-accent/15 text-accent font-medium"
                      : "border-line/70 text-fg-dim hover:bg-hover hover:text-fg",
                  )}
                >
                  {opt.id === "" ? t("Default") : opt.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {state.checked && !state.installed && (
        <div className="px-3 pb-2.5">
          <p className="text-[10.5px] leading-snug text-fg-faint">
            {t("Uses your ChatGPT subscription (Plus, Pro, Business).")}
          </p>
        </div>
      )}
    </div>
  );
}

function CloudHalf() {
  return (
    <>
      <ClaudeCodeCard />
      <AntigravityCard />
      <CodexCard />
    </>
  );
}

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
    return { label: suffix ? `Codex · ${suffix}` : "Codex", ready: true };
  }
  if (config.provider === "antigravity") {
    const chosen = (config.cloudModel?.antigravity ?? "").trim();
    const matched = (antigravityModels.length > 0 ? antigravityModels : antigravityProbe?.models ?? []).find(
      (m) => m.id === chosen,
    );
    const suffix = matched ? matched.label : chosen ? formatCloudModelName(chosen, "antigravity") : "";
    return { label: suffix ? `Antigravity · ${suffix}` : "Antigravity", ready: true };
  }
  const chosen = (config.cloudModel?.["claude-code"] ?? "").trim().toLowerCase();
  const suffix = chosen === "sonnet" ? "Sonnet" : chosen === "opus" ? "Opus" : chosen === "haiku" ? "Haiku" : "";
  return { label: suffix ? `Claude Code · ${suffix}` : "Claude Code", ready: true };
}

export function ModelPicker({ className }: { className?: string } = {}) {
  const t = useT();
  const { label, ready } = useModelLabel();
  const [open, setOpen] = useState(false);
  const [half, setHalf] = useState<"cloud" | "local">(
    () => useAi.getState().config?.tab ?? "cloud",
  );
  const error = useAi((state) => state.error);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void useAi.getState().load();
  }, []);

  useEffect(() => {
    if (!open) return;
    void useAi.getState().load();
    void useAi.getState().refreshLocal();
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        title={t("Providers and models")}
        className={cn(
          "flex max-w-[320px] items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] font-medium transition-colors duration-150",
          className
            ? className
            : open
              ? "border border-accent bg-hover text-fg"
              : "border border-line text-fg-dim hover:bg-hover hover:text-fg",
        )}
      >
        <span className={cn("size-1.5 shrink-0 rounded-full", ready ? "bg-emerald-400" : "bg-fg-faint/40")} />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className={cn("size-3 shrink-0 transition-transform duration-150", open && "rotate-180")} strokeWidth={2} />
      </button>

      {open && (
        <div className="wide-pop-up absolute bottom-full left-0 z-30 mb-2 flex max-h-[500px] w-[360px] flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-2xl">
          <div className="flex shrink-0 border-b border-line bg-raised/40">
            {(["cloud", "local"] as const).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setHalf(name)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 py-2 text-[11.5px] font-medium transition-colors duration-150",
                  half === name
                    ? "border-b-2 border-accent text-fg-bright"
                    : "text-fg-dim hover:bg-hover hover:text-fg",
                )}
              >
                {name === "cloud" ? (
                  <Cloud className="size-3.5" strokeWidth={1.75} />
                ) : (
                  <HardDrive className="size-3.5" strokeWidth={1.75} />
                )}
                {name === "cloud" ? t("Cloud") : t("Local")}
              </button>
            ))}
          </div>

          {error && (
            <button
              type="button"
              onClick={() => useAi.setState({ error: "" })}
              className="shrink-0 border-b border-line px-3 py-2 text-left text-[11px] text-status-error"
            >
              {t(error)}
            </button>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {half === "cloud" ? <CloudHalf /> : <LocalHalf />}
          </div>
        </div>
      )}
    </div>
  );
}
