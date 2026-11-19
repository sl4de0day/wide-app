import { aiNormalizeToolMode } from "./tool-registry";

export type ClaudeEffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type ClaudeErrorKind =
  | "auth"
  | "rate_limit"
  | "session_not_found"
  | "network"
  | "unknown";

export interface ClaudeAuthStatus {
  loggedIn: boolean;
  authMethod: string;
  apiProvider: string;
  email: string;
  subscriptionType: string;
  raw?: Record<string, unknown>;
}

export interface ClaudeStreamImageInput {
  mediaType?: string;
  media_type?: string;
  data: string;
}

export type ClaudeStreamContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    };

export interface ClaudeStreamUserMessagePayload {
  type: "user";
  message: {
    role: "user";
    content: string | ClaudeStreamContentBlock[];
  };
}

export interface ClaudeCliArgsOptions {
  sessionId?: string;
  resumeSessionId?: string;
  forkSession?: boolean;
  appendSystemPromptFile?: string;
  mcpConfigPath?: string;
  model?: string;
  fallbackModel?: string;
  effort?: string;
  mode?: string;
  toolMode?: string;
  permissionMode?: string;
  strictMcpConfig?: boolean;
}

export interface ClaudeUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export type ClaudeParsedEvent =
  | {
      type: "session_init";
      sessionId: string;
      model?: string;
      tools?: string[];
    }
  | {
      type: "delta";
      text: string;
      parentToolUseId?: string;
    }
  | {
      type: "thinking";
      text: string;
      parentToolUseId?: string;
    }
  | {
      type: "tool_start";
      id: string;
      tool: string;
      input: Record<string, unknown>;
      parentToolUseId?: string;
    }
  | {
      type: "tool_result";
      id: string;
      tool: string;
      output: string;
      isError: boolean;
      parentToolUseId?: string;
      input?: Record<string, unknown>;
    }
  | {
      type: "prompt_suggestion";
      suggestions: string[];
    }
  | {
      type: "hook_event";
      hookName: string;
      detail?: string;
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      totalCostUsd?: number;
      durationMs?: number;
      sessionId?: string;
    }
  | {
      type: "result";
      text: string;
      isError: boolean;
      errorKind?: ClaudeErrorKind;
      sessionId?: string;
      durationMs?: number;
      totalCostUsd?: number;
      usage: ClaudeUsageMetrics;
    };

export interface ClaudeClassifiedError {
  kind: ClaudeErrorKind;
  message: string;
  recoverable: boolean;
}

interface ActiveBlockBuffer {
  kind: "text" | "thinking" | "tool_use" | "other";
  id: string;
  name: string;
  input: Record<string, unknown>;
  jsonChunks: string[];
}

interface StreamContextState {
  streamedText: string;
  streamedThinking: string;
  blocks: Map<number, ActiveBlockBuffer>;
}

const VALID_CLAUDE_EFFORTS = new Set<string>(["low", "medium", "high", "xhigh", "max"]);

const ASK_DISALLOWED_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit", "Bash"];
const SECURITY_DISALLOWED_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

function asPlainObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function asOptionalPositiveNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function stripBase64DataUrlPrefix(raw: string): { mediaType?: string; data: string } {
  const trimmed = String(raw ?? "").trim();
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(trimmed);
  if (match) {
    return { mediaType: match[1].trim(), data: match[2].trim() };
  }
  return { data: trimmed };
}

function stringifyToolResultContent(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) {
    const parts: string[] = [];
    for (const item of raw) {
      if (typeof item === "string") {
        parts.push(item);
      } else {
        const rec = asPlainObject(item);
        if (rec && typeof rec.text === "string") {
          parts.push(rec.text);
        } else if (rec) {
          parts.push(JSON.stringify(rec));
        }
      }
    }
    return parts.join("\n");
  }
  if (raw === null || raw === undefined) return "";
  try {
    return JSON.stringify(raw);
  } catch {
    return String(raw);
  }
}

export function normalizeClaudeEffort(raw?: string | null): ClaudeEffortLevel | "" {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "fast") return "low";
  if (normalized === "thinking") return "high";
  if (VALID_CLAUDE_EFFORTS.has(normalized)) return normalized as ClaudeEffortLevel;
  return "";
}

export function normalizeClaudeModelChoice(raw?: string | null): string {
  const normalized = String(raw ?? "").trim();
  if (!normalized || normalized.toLowerCase() === "default") return "";
  return normalized;
}

export function parseClaudeAuthStatusJson(stdout: string): ClaudeAuthStatus | null {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        parsed = JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    } else {
      return null;
    }
  }

  const rec = asPlainObject(parsed);
  if (!rec) return null;

  const loggedIn =
    typeof rec.loggedIn === "boolean"
      ? rec.loggedIn
      : typeof rec.logged_in === "boolean"
        ? rec.logged_in
        : false;

  return {
    loggedIn,
    authMethod: String(rec.authMethod ?? rec.auth_method ?? "").trim(),
    apiProvider: String(rec.apiProvider ?? rec.api_provider ?? "").trim(),
    email: String(rec.email ?? "").trim(),
    subscriptionType: String(rec.subscriptionType ?? rec.subscription_type ?? "").trim(),
    raw: rec,
  };
}

export function buildClaudeStreamUserMessage(
  input:
    | string
    | {
        text?: string;
        images?: readonly ClaudeStreamImageInput[];
      },
): ClaudeStreamUserMessagePayload {
  const rawText = typeof input === "string" ? input : String(input?.text ?? "");
  const rawImages = typeof input === "string" ? [] : Array.isArray(input?.images) ? input.images : [];

  const blocks: ClaudeStreamContentBlock[] = [];
  for (const img of rawImages) {
    if (!img || typeof img.data !== "string") continue;
    const stripped = stripBase64DataUrlPrefix(img.data);
    if (!stripped.data) continue;
    const mediaType = String(img.mediaType ?? img.media_type ?? stripped.mediaType ?? "image/png").trim() || "image/png";
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: stripped.data,
      },
    });
  }

  if (blocks.length === 0) {
    return {
      type: "user",
      message: {
        role: "user",
        content: rawText,
      },
    };
  }

  if (rawText.length > 0) {
    blocks.push({ type: "text", text: rawText });
  }

  return {
    type: "user",
    message: {
      role: "user",
      content: blocks,
    },
  };
}

export function serializeClaudeStreamUserMessage(
  input:
    | string
    | {
        text?: string;
        images?: readonly ClaudeStreamImageInput[];
      },
): string {
  return JSON.stringify(buildClaudeStreamUserMessage(input));
}

export function buildClaudeCliArgs(opts: ClaudeCliArgsOptions = {}): string[] {
  const args: string[] = [
    "--print",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--forward-subagent-text",
    "--include-hook-events",
    "--prompt-suggestions",
    "--system-prompt-snapshot",
    "on",
  ];

  const resumeSessionId = String(opts.resumeSessionId ?? "").trim();
  const sessionId = String(opts.sessionId ?? "").trim();
  if (resumeSessionId) {
    args.push("--resume", resumeSessionId);
    if (opts.forkSession) {
      args.push("--fork-session");
    }
  } else if (sessionId) {
    args.push("--session-id", sessionId);
  }

  const appendSystemPromptFile = String(opts.appendSystemPromptFile ?? "").trim();
  if (appendSystemPromptFile) {
    args.push("--append-system-prompt-file", appendSystemPromptFile);
  }

  const mcpConfigPath = String(opts.mcpConfigPath ?? "").trim();
  if (mcpConfigPath) {
    args.push("--mcp-config", mcpConfigPath);
    if (opts.strictMcpConfig) {
      args.push("--strict-mcp-config");
    }
  }

  const model = normalizeClaudeModelChoice(opts.model);
  if (model) {
    args.push("--model", model);
  }

  const fallbackModel = normalizeClaudeModelChoice(opts.fallbackModel);
  if (fallbackModel && fallbackModel !== model) {
    args.push("--fallback-model", fallbackModel);
  }

  const effort = normalizeClaudeEffort(opts.effort);
  if (effort) {
    args.push("--effort", effort);
  }

  const mode = String(opts.mode ?? "agent").trim().toLowerCase() === "ask" ? "ask" : "agent";
  const toolMode = aiNormalizeToolMode(opts.toolMode);
  const explicitPermissionMode = String(opts.permissionMode ?? "").trim();

  if (mode === "ask") {
    args.push("--permission-mode", explicitPermissionMode || "plan");
    args.push("--disallowedTools", ...ASK_DISALLOWED_TOOLS);
  } else if (toolMode === "security") {
    args.push("--permission-mode", explicitPermissionMode || "bypassPermissions");
    args.push("--disallowedTools", ...SECURITY_DISALLOWED_TOOLS);
  } else {
    args.push("--permission-mode", explicitPermissionMode || "bypassPermissions");
  }

  return args;
}

export function classifyClaudeStreamError(rawMessage: string): ClaudeClassifiedError {
  const message = String(rawMessage ?? "").trim() || "Claude Code execution failed";
  const lower = message.toLowerCase();

  if (
    lower.includes("not logged in") ||
    lower.includes("login required") ||
    lower.includes("please run /login") ||
    lower.includes("please run claude auth login") ||
    lower.includes("authentication") ||
    lower.includes("unauthorized") ||
    lower.includes("oauth") ||
    lower.includes("expired token") ||
    lower.includes("invalid api key") ||
    /\b401\b/.test(lower)
  ) {
    return { kind: "auth", message, recoverable: true };
  }

  if (
    lower.includes("rate limit") ||
    lower.includes("usage limit") ||
    lower.includes("limit reached") ||
    lower.includes("too many requests") ||
    lower.includes("quota") ||
    lower.includes("overloaded") ||
    lower.includes("capacity") ||
    /\b429\b/.test(lower)
  ) {
    return { kind: "rate_limit", message, recoverable: true };
  }

  if (
    lower.includes("no conversation found") ||
    lower.includes("could not resume") ||
    lower.includes("invalid session") ||
    (lower.includes("session") && lower.includes("not found"))
  ) {
    return { kind: "session_not_found", message, recoverable: true };
  }

  if (
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("enotfound") ||
    lower.includes("fetch failed") ||
    lower.includes("network error")
  ) {
    return { kind: "network", message, recoverable: true };
  }

  return { kind: "unknown", message, recoverable: false };
}

export class ClaudeStreamEventParser {
  private readonly streamStates = new Map<string, StreamContextState>();
  private readonly toolNamesById = new Map<string, string>();
  private readonly toolInputsById = new Map<string, Record<string, unknown>>();
  private readonly emittedToolStarts = new Set<string>();
  private rootEmittedText = false;
  private rootEmittedThinking = false;
  private sessionId = "";

  resetTurn(): void {
    this.streamStates.clear();
    this.emittedToolStarts.clear();
    this.rootEmittedText = false;
    this.rootEmittedThinking = false;
  }

  getSessionId(): string {
    return this.sessionId;
  }

  hasEmittedRootText(): boolean {
    return this.rootEmittedText;
  }

  hasEmittedRootThinking(): boolean {
    return this.rootEmittedThinking;
  }

  private getStreamState(parentToolUseId?: string): StreamContextState {
    const key = parentToolUseId || "__root__";
    let state = this.streamStates.get(key);
    if (!state) {
      state = { streamedText: "", streamedThinking: "", blocks: new Map() };
      this.streamStates.set(key, state);
    }
    return state;
  }

  private handleStreamEvent(obj: Record<string, unknown>): ClaudeParsedEvent[] {
    const ev = asPlainObject(obj.event);
    if (!ev) return [];
    const parentToolUseId =
      typeof obj.parent_tool_use_id === "string" && obj.parent_tool_use_id
        ? obj.parent_tool_use_id
        : undefined;
    const state = this.getStreamState(parentToolUseId);
    const evType = String(ev.type ?? "");
    const out: ClaudeParsedEvent[] = [];

    if (evType === "message_start") {
      state.streamedText = "";
      state.streamedThinking = "";
      state.blocks.clear();
      return out;
    }

    if (evType === "content_block_start") {
      const idx = typeof ev.index === "number" ? ev.index : 0;
      const block = asPlainObject(ev.content_block);
      if (!block) return out;
      const blockType = String(block.type ?? "");
      if (blockType === "tool_use") {
        const id = String(block.id ?? "").trim();
        const name = String(block.name ?? "tool").trim() || "tool";
        const initialInput = asPlainObject(block.input) ?? {};
        state.blocks.set(idx, {
          kind: "tool_use",
          id,
          name,
          input: initialInput,
          jsonChunks: [],
        });
        if (id) {
          this.toolNamesById.set(id, name);
          this.toolInputsById.set(id, initialInput);
        }
      } else if (blockType === "text") {
        state.blocks.set(idx, { kind: "text", id: "", name: "", input: {}, jsonChunks: [] });
        const initialText = typeof block.text === "string" ? block.text : "";
        if (initialText) {
          state.streamedText += initialText;
          if (!parentToolUseId) this.rootEmittedText = true;
          out.push({ type: "delta", text: initialText, ...(parentToolUseId ? { parentToolUseId } : {}) });
        }
      } else if (blockType === "thinking") {
        state.blocks.set(idx, { kind: "thinking", id: "", name: "", input: {}, jsonChunks: [] });
        const initialThinking = typeof block.thinking === "string" ? block.thinking : "";
        if (initialThinking) {
          state.streamedThinking += initialThinking;
          if (!parentToolUseId) this.rootEmittedThinking = true;
          out.push({
            type: "thinking",
            text: initialThinking,
            ...(parentToolUseId ? { parentToolUseId } : {}),
          });
        }
      } else {
        state.blocks.set(idx, { kind: "other", id: "", name: "", input: {}, jsonChunks: [] });
      }
      return out;
    }

    if (evType === "content_block_delta") {
      const delta = asPlainObject(ev.delta);
      if (!delta) return out;
      const idx = typeof ev.index === "number" ? ev.index : 0;
      const deltaType = String(delta.type ?? "");

      if (deltaType === "text_delta" && typeof delta.text === "string" && delta.text) {
        state.streamedText += delta.text;
        if (!parentToolUseId) this.rootEmittedText = true;
        out.push({ type: "delta", text: delta.text, ...(parentToolUseId ? { parentToolUseId } : {}) });
      } else if (deltaType === "thinking_delta" && typeof delta.thinking === "string" && delta.thinking) {
        state.streamedThinking += delta.thinking;
        if (!parentToolUseId) this.rootEmittedThinking = true;
        out.push({
          type: "thinking",
          text: delta.thinking,
          ...(parentToolUseId ? { parentToolUseId } : {}),
        });
      } else if (deltaType === "input_json_delta" && typeof delta.partial_json === "string") {
        const active = state.blocks.get(idx);
        if (active && active.kind === "tool_use") {
          active.jsonChunks.push(delta.partial_json);
        }
      }
      return out;
    }

    if (evType === "content_block_stop") {
      const idx = typeof ev.index === "number" ? ev.index : 0;
      const active = state.blocks.get(idx);
      if (active && active.kind === "tool_use" && active.id && !this.emittedToolStarts.has(active.id)) {
        const rawJson = active.jsonChunks.join("").trim();
        let parsedInput: Record<string, unknown> | null = null;
        if (rawJson) {
          try {
            const candidate = JSON.parse(rawJson);
            parsedInput = asPlainObject(candidate);
          } catch {
            parsedInput = null;
          }
        } else {
          parsedInput = active.input;
        }
        if (parsedInput) {
          this.toolNamesById.set(active.id, active.name);
          this.toolInputsById.set(active.id, parsedInput);
          this.emittedToolStarts.add(active.id);
          out.push({
            type: "tool_start",
            id: active.id,
            tool: active.name,
            input: parsedInput,
            ...(parentToolUseId ? { parentToolUseId } : {}),
          });
        }
      }
      return out;
    }

    return out;
  }

  private handleAssistantMessage(obj: Record<string, unknown>): ClaudeParsedEvent[] {
    const message = asPlainObject(obj.message);
    if (!message || !Array.isArray(message.content)) return [];

    const parentToolUseId =
      typeof obj.parent_tool_use_id === "string" && obj.parent_tool_use_id
        ? obj.parent_tool_use_id
        : undefined;
    const state = this.getStreamState(parentToolUseId);
    const out: ClaudeParsedEvent[] = [];

    let fullAssistantText = "";
    let fullAssistantThinking = "";

    for (const rawBlock of message.content) {
      const block = asPlainObject(rawBlock);
      if (!block) continue;
      const blockType = String(block.type ?? "");
      if (blockType === "text" && typeof block.text === "string") {
        fullAssistantText += block.text;
      } else if (blockType === "thinking" && typeof block.thinking === "string") {
        fullAssistantThinking += block.thinking;
      } else if (blockType === "tool_use") {
        const id = String(block.id ?? "").trim() || `cc_tool_${this.emittedToolStarts.size + 1}`;
        const tool = String(block.name ?? "tool").trim() || "tool";
        const input = asPlainObject(block.input) ?? {};
        this.toolNamesById.set(id, tool);
        this.toolInputsById.set(id, input);
        if (!this.emittedToolStarts.has(id)) {
          this.emittedToolStarts.add(id);
          out.push({
            type: "tool_start",
            id,
            tool,
            input,
            ...(parentToolUseId ? { parentToolUseId } : {}),
          });
        }
      }
    }

    if (fullAssistantThinking) {
      if (!state.streamedThinking) {
        if (!parentToolUseId) this.rootEmittedThinking = true;
        out.push({
          type: "thinking",
          text: fullAssistantThinking,
          ...(parentToolUseId ? { parentToolUseId } : {}),
        });
      } else if (
        fullAssistantThinking.length > state.streamedThinking.length &&
        fullAssistantThinking.startsWith(state.streamedThinking)
      ) {
        const suffix = fullAssistantThinking.slice(state.streamedThinking.length);
        if (suffix) {
          if (!parentToolUseId) this.rootEmittedThinking = true;
          out.push({
            type: "thinking",
            text: suffix,
            ...(parentToolUseId ? { parentToolUseId } : {}),
          });
        }
      }
    }

    if (fullAssistantText) {
      if (!state.streamedText) {
        if (!parentToolUseId) this.rootEmittedText = true;
        out.push({
          type: "delta",
          text: fullAssistantText,
          ...(parentToolUseId ? { parentToolUseId } : {}),
        });
      } else if (
        fullAssistantText.length > state.streamedText.length &&
        fullAssistantText.startsWith(state.streamedText)
      ) {
        const suffix = fullAssistantText.slice(state.streamedText.length);
        if (suffix) {
          if (!parentToolUseId) this.rootEmittedText = true;
          out.push({
            type: "delta",
            text: suffix,
            ...(parentToolUseId ? { parentToolUseId } : {}),
          });
        }
      }
    }

    state.streamedText = "";
    state.streamedThinking = "";
    state.blocks.clear();

    return out;
  }

  private handleUserMessage(obj: Record<string, unknown>): ClaudeParsedEvent[] {
    const message = asPlainObject(obj.message);
    if (!message || !Array.isArray(message.content)) return [];
    const parentToolUseId =
      typeof obj.parent_tool_use_id === "string" && obj.parent_tool_use_id
        ? obj.parent_tool_use_id
        : undefined;
    const out: ClaudeParsedEvent[] = [];

    for (const rawBlock of message.content) {
      const block = asPlainObject(rawBlock);
      if (!block || block.type !== "tool_result") continue;
      const id = String(block.tool_use_id ?? "").trim();
      const tool = (id ? this.toolNamesById.get(id) : undefined) || "tool";
      const input = id ? this.toolInputsById.get(id) : undefined;
      const output = stringifyToolResultContent(block.content);
      const isError = Boolean(block.is_error);
      out.push({
        type: "tool_result",
        id,
        tool,
        output,
        isError,
        ...(parentToolUseId ? { parentToolUseId } : {}),
        ...(input ? { input } : {}),
      });
    }

    return out;
  }

  parseObject(rawObj: unknown): ClaudeParsedEvent[] {
    const obj = asPlainObject(rawObj);
    if (!obj) return [];

    const sid = typeof obj.session_id === "string" ? obj.session_id.trim() : "";
    if (sid) {
      this.sessionId = sid;
    }

    const type = String(obj.type ?? "");
    const subtype = String(obj.subtype ?? "");

    if (type === "system") {
      if (subtype === "init" && sid) {
        const tools = Array.isArray(obj.tools)
          ? obj.tools.map((t) => String(t)).filter(Boolean)
          : undefined;
        const model = typeof obj.model === "string" ? obj.model : undefined;
        return [{ type: "session_init", sessionId: sid, ...(model ? { model } : {}), ...(tools ? { tools } : {}) }];
      }
      if (subtype.startsWith("hook_")) {
        const hookName = String(obj.hook_name ?? obj.hook_event ?? subtype).trim();
        const detail = typeof obj.output === "string" ? obj.output : typeof obj.message === "string" ? obj.message : undefined;
        return [{ type: "hook_event", hookName, ...(detail ? { detail } : {}) }];
      }
      return [];
    }

    if (type === "stream_event") {
      return this.handleStreamEvent(obj);
    }

    if (type === "assistant") {
      return this.handleAssistantMessage(obj);
    }

    if (type === "user") {
      return this.handleUserMessage(obj);
    }

    if (type === "prompt_suggestion" || type === "prompt_suggestions") {
      const suggestions: string[] = [];
      if (typeof obj.suggestion === "string" && obj.suggestion.trim()) {
        suggestions.push(obj.suggestion.trim());
      }
      if (Array.isArray(obj.suggestions)) {
        for (const item of obj.suggestions) {
          const text = typeof item === "string" ? item.trim() : "";
          if (text && !suggestions.includes(text)) {
            suggestions.push(text);
          }
        }
      }
      return suggestions.length > 0 ? [{ type: "prompt_suggestion", suggestions }] : [];
    }

    if (type === "result") {
      const usageObj = asPlainObject(obj.usage) ?? {};
      const usage: ClaudeUsageMetrics = {
        inputTokens: asNonNegativeInt(usageObj.input_tokens),
        outputTokens: asNonNegativeInt(usageObj.output_tokens),
        cacheReadTokens: asNonNegativeInt(usageObj.cache_read_input_tokens),
        cacheCreationTokens: asNonNegativeInt(usageObj.cache_creation_input_tokens),
      };
      const totalCostUsd = asOptionalPositiveNumber(obj.total_cost_usd);
      const durationMs = asOptionalPositiveNumber(obj.duration_ms);
      const isError = Boolean(
        obj.is_error || subtype === "error_during_execution" || subtype === "error_max_turns",
      );
      const rawErrors = Array.isArray(obj.errors)
        ? obj.errors.map((e) => String(e)).filter(Boolean).join("\n")
        : "";
      const text =
        typeof obj.result === "string" && obj.result
          ? obj.result
          : rawErrors || (isError && typeof obj.error === "string" ? obj.error : "");
      const classified = isError ? classifyClaudeStreamError(text || "Claude Code execution failed") : null;

      return [
        {
          type: "usage",
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(sid || this.sessionId ? { sessionId: sid || this.sessionId } : {}),
        },
        {
          type: "result",
          text,
          isError,
          ...(classified ? { errorKind: classified.kind } : {}),
          ...(sid || this.sessionId ? { sessionId: sid || this.sessionId } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(totalCostUsd !== undefined ? { totalCostUsd } : {}),
          usage,
        },
      ];
    }

    return [];
  }

  parseLine(line: string): ClaudeParsedEvent[] {
    const trimmed = String(line ?? "").trim();
    if (!trimmed) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
    return this.parseObject(parsed);
  }
}
