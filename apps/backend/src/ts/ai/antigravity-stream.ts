export type AntigravityEffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type AntigravityErrorKind =
  | "auth"
  | "rate_limit"
  | "session_not_found"
  | "network"
  | "unknown";

export interface AntigravityModelFamily {
  id: string;
  label: string;
  variants: Partial<Record<AntigravityEffortLevel, string>>;
  rawIds: string[];
}

export interface AntigravityImageInput {
  mediaType?: string;
  media_type?: string;
  data: string;
}

export type AntigravityUserContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    };

export interface AntigravityStreamUserMessagePayload {
  event: "user";
  message: {
    role: "user";
    content: string | AntigravityUserContentBlock[];
  };
}

export interface AntigravityCliArgsOptions {
  conversationId?: string;
  model?: string;
  effort?: string;
  mode?: string;
}

export interface AntigravityUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
}

export type AntigravityParsedEvent =
  | {
      type: "session_init";
      conversationId: string;
      model?: string;
      permissionMode?: string;
    }
  | {
      type: "delta";
      text: string;
    }
  | {
      type: "thinking";
      text: string;
    }
  | {
      type: "tool_start";
      id: string;
      tool: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      id: string;
      tool: string;
      output: string;
      isError: boolean;
      input?: Record<string, unknown>;
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      thinkingTokens: number;
      cacheReadTokens: number;
      durationMs?: number;
      conversationId?: string;
    }
  | {
      type: "result";
      text: string;
      isError: boolean;
      errorKind?: AntigravityErrorKind;
      conversationId?: string;
      durationMs?: number;
      usage: AntigravityUsageMetrics;
    };

const VALID_AGY_EFFORTS = new Set<string>(["low", "medium", "high", "xhigh", "max"]);

export const DEFAULT_ANTIGRAVITY_MODELS: readonly AntigravityModelFamily[] = [
  {
    id: "gemini-4-neon",
    label: "Gemini 4 Neon",
    variants: {
      low: "gemini-4-neon-low",
      medium: "gemini-4-neon-medium",
      high: "gemini-4-neon-high",
      xhigh: "gemini-4-neon-xhigh",
    },
    rawIds: ["gemini-4-neon-low", "gemini-4-neon-medium", "gemini-4-neon-high", "gemini-4-neon-xhigh"],
  },
  {
    id: "gemini-4-argon",
    label: "Gemini 4 Argon",
    variants: {
      low: "gemini-4-argon-low",
      medium: "gemini-4-argon-medium",
      high: "gemini-4-argon-high",
    },
    rawIds: ["gemini-4-argon-low", "gemini-4-argon-medium", "gemini-4-argon-high"],
  },
  {
    id: "gemini-4-hydrogen",
    label: "Gemini 4 Hydrogen",
    variants: {
      low: "gemini-4-hydrogen-low",
      medium: "gemini-4-hydrogen-medium",
      high: "gemini-4-hydrogen-high",
      xhigh: "gemini-4-hydrogen-xhigh",
    },
    rawIds: ["gemini-4-hydrogen-low", "gemini-4-hydrogen-medium", "gemini-4-hydrogen-high", "gemini-4-hydrogen-xhigh"],
  },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    variants: {
      low: "gemini-3.8-flash-low",
      medium: "gemini-3.8-flash-medium",
      high: "gemini-3.8-flash-high",
    },
    rawIds: ["gemini-3.8-flash-low", "gemini-3.8-flash-medium", "gemini-3.8-flash-high"],
  },
  {
    id: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    variants: {
      low: "claude-sonnet-5-5-low",
      medium: "claude-sonnet-5-5-medium",
      high: "claude-sonnet-5-5-high",
    },
    rawIds: ["claude-sonnet-5-5-low", "claude-sonnet-5-5-medium", "claude-sonnet-5-5-high"],
  },
  {
    id: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    variants: {
      low: "claude-opus-5-5-low",
      medium: "claude-opus-5-5-medium",
      high: "claude-opus-5-5-high",
    },
    rawIds: ["claude-opus-5-5-low", "claude-opus-5-5-medium", "claude-opus-5-5-high"],
  },
  {
    id: "gpt-oss-120b",
    label: "GPT-OSS 120B",
    variants: {
      medium: "gpt-oss-120b-medium",
    },
    rawIds: ["gpt-oss-120b-medium"],
  },
];

function asPlainObj(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function cleanDataUrlPrefix(raw: string): { mediaType?: string; data: string } {
  const trimmed = String(raw ?? "").trim();
  const match = /^data:([^;,]+);base64,(.+)$/i.exec(trimmed);
  if (match) {
    return { mediaType: match[1].trim(), data: match[2].trim() };
  }
  return { data: trimmed };
}

export function normalizeAntigravityEffort(raw?: string | null): AntigravityEffortLevel | "" {
  const norm = String(raw ?? "").trim().toLowerCase();
  if (!norm) return "";
  if (norm === "fast") return "low";
  if (norm === "thinking") return "high";
  if (VALID_AGY_EFFORTS.has(norm)) return norm as AntigravityEffortLevel;
  return "";
}

export function stripAntigravityEffortSuffix(modelId: string): {
  familyId: string;
  effort: AntigravityEffortLevel | "";
} {
  const trimmed = String(modelId ?? "").trim();
  const match = /^(.*)-(low|medium|high|xhigh|max)$/i.exec(trimmed);
  if (match && match[1]) {
    return {
      familyId: match[1],
      effort: match[2].toLowerCase() as AntigravityEffortLevel,
    };
  }
  return { familyId: trimmed, effort: "" };
}

function formatFamilyLabelFallback(familyId: string): string {
  return familyId
    .split("-")
    .map((part) => {
      if (part.toLowerCase() === "gpt" || part.toLowerCase() === "oss") return part.toUpperCase();
      if (/^\d+(?:\.\d+)?$/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ")
    .replace(/(\d+)\s+(\d+)$/, "$1.$2");
}

export function parseAntigravityModelsOutput(stdout: string): AntigravityModelFamily[] {
  const lines = String(stdout ?? "").split(/\r?\n/);
  const families = new Map<string, AntigravityModelFamily>();

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || /^fetching\b/i.test(trimmed)) continue;
    const parts = trimmed.split(/\t+/);
    const id = String(parts[0] ?? "").trim();
    if (!id || /\s/.test(id) || id.startsWith("-")) continue;

    const rawLabel = parts.slice(1).join(" ").trim();
    const { familyId, effort } = stripAntigravityEffortSuffix(id);
    const cleanLabel =
      rawLabel.replace(/\s*\((?:low|medium|high|xhigh|max)\)\s*$/i, "").trim() ||
      formatFamilyLabelFallback(familyId);

    let fam = families.get(familyId);
    if (!fam) {
      fam = { id: familyId, label: cleanLabel, variants: {}, rawIds: [] };
      families.set(familyId, fam);
    }
    if (!fam.rawIds.includes(id)) {
      fam.rawIds.push(id);
    }
    if (effort) {
      fam.variants[effort] = id;
    }
  }

  return Array.from(families.values());
}

export function resolveAntigravityModelForEffort(
  chosenModel?: string | null,
  effort?: string | null,
  catalog: readonly AntigravityModelFamily[] = DEFAULT_ANTIGRAVITY_MODELS,
): string {
  const clean = String(chosenModel ?? "").trim();
  if (!clean || clean.toLowerCase() === "default") return "";

  const normEffort = normalizeAntigravityEffort(effort) || "high";
  const effectiveCatalog = catalog.length > 0 ? catalog : DEFAULT_ANTIGRAVITY_MODELS;

  const { familyId } = stripAntigravityEffortSuffix(clean);
  const fam =
    effectiveCatalog.find((f) => f.id === clean || f.id === familyId || f.rawIds.includes(clean));

  if (!fam) return clean;
  if (fam.variants[normEffort]) {
    return fam.variants[normEffort] as string;
  }

  const order: AntigravityEffortLevel[] =
    normEffort === "low"
      ? ["low", "medium", "high", "xhigh", "max"]
      : normEffort === "medium"
        ? ["medium", "high", "low", "xhigh", "max"]
        : ["xhigh", "high", "medium", "low", "max"];

  for (const candidate of order) {
    if (fam.variants[candidate]) {
      return fam.variants[candidate] as string;
    }
  }
  return fam.rawIds[0] || clean;
}

export function buildAntigravityCliArgs(opts: AntigravityCliArgsOptions = {}): string[] {
  const args: string[] = ["--input-format", "stream-json", "--output-format", "stream-json"];

  const convId = String(opts.conversationId ?? "").trim();
  if (convId) {
    args.push("--conversation", convId);
  }

  const model = String(opts.model ?? "").trim();
  if (model && model.toLowerCase() !== "default") {
    args.push("--model", model);
  }

  const effort = normalizeAntigravityEffort(opts.effort);
  if (effort) {
    args.push("--effort", effort);
  }

  const mode = String(opts.mode ?? "agent").trim().toLowerCase() === "ask" ? "ask" : "agent";
  if (mode === "ask") {
    args.push("--mode", "plan");
  } else {
    args.push("--mode", "accept-edits", "--dangerously-skip-permissions");
  }

  args.push("--print=");
  return args;
}

export function buildAntigravityStreamUserMessage(
  input:
    | string
    | {
        text?: string;
        images?: readonly AntigravityImageInput[];
      },
): AntigravityStreamUserMessagePayload {
  const rawText = typeof input === "string" ? input : String(input?.text ?? "");
  const rawImages = typeof input === "string" ? [] : Array.isArray(input?.images) ? input.images : [];

  const blocks: AntigravityUserContentBlock[] = [];
  for (const img of rawImages) {
    if (!img || typeof img.data !== "string") continue;
    const cleaned = cleanDataUrlPrefix(img.data);
    if (!cleaned.data) continue;
    const mediaType = String(img.mediaType ?? img.media_type ?? cleaned.mediaType ?? "image/png").trim() || "image/png";
    blocks.push({
      type: "image",
      source: {
        type: "base64",
        media_type: mediaType,
        data: cleaned.data,
      },
    });
  }

  if (blocks.length === 0) {
    return {
      event: "user",
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
    event: "user",
    message: {
      role: "user",
      content: blocks,
    },
  };
}

export function serializeAntigravityStreamUserMessage(
  input:
    | string
    | {
        text?: string;
        images?: readonly AntigravityImageInput[];
      },
): string {
  return JSON.stringify(buildAntigravityStreamUserMessage(input));
}

export function classifyAntigravityError(rawMessage: string): {
  kind: AntigravityErrorKind;
  message: string;
} {
  const message = String(rawMessage ?? "").trim() || "Antigravity CLI execution failed.";
  const lower = message.toLowerCase();

  if (
    lower.includes("not logged in") ||
    lower.includes("login") ||
    lower.includes("sign in") ||
    lower.includes("authentication") ||
    lower.includes("unauthenticated") ||
    lower.includes("unauthorized") ||
    lower.includes("credentials") ||
    lower.includes("oauth") ||
    /\b401\b/.test(lower)
  ) {
    return { kind: "auth", message };
  }

  if (
    lower.includes("rate limit") ||
    lower.includes("quota") ||
    lower.includes("resource_exhausted") ||
    lower.includes("capacity") ||
    lower.includes("too many requests") ||
    /\b429\b/.test(lower)
  ) {
    return { kind: "rate_limit", message };
  }

  if (
    lower.includes("conversation not found") ||
    lower.includes("unknown conversation") ||
    (lower.includes("conversation") && lower.includes("not found"))
  ) {
    return { kind: "session_not_found", message };
  }

  if (
    lower.includes("econnreset") ||
    lower.includes("etimedout") ||
    lower.includes("enotfound") ||
    lower.includes("network")
  ) {
    return { kind: "network", message };
  }

  return { kind: "unknown", message };
}

export class AntigravityStreamEventParser {
  private conversationId = "";
  private emittedToolSteps = new Set<number>();
  private completedToolSteps = new Set<number>();
  private toolMetaByStep = new Map<number, { tool: string; input: Record<string, unknown> }>();
  private emittedRootText = false;

  resetTurn(): void {
    this.emittedToolSteps.clear();
    this.completedToolSteps.clear();
    this.toolMetaByStep.clear();
    this.emittedRootText = false;
  }

  getConversationId(): string {
    return this.conversationId;
  }

  hasEmittedText(): boolean {
    return this.emittedRootText;
  }

  parseObject(rawObj: unknown): AntigravityParsedEvent[] {
    const obj = asPlainObj(rawObj);
    if (!obj) return [];

    const convTop = typeof obj.conversation_id === "string" ? obj.conversation_id.trim() : "";
    if (convTop) {
      this.conversationId = convTop;
    }

    const eventType = String(obj.event ?? "");

    if (eventType === "init") {
      const initRec = asPlainObj(obj.init) ?? {};
      const cid = String(initRec.conversation_id ?? convTop ?? this.conversationId).trim();
      if (cid) this.conversationId = cid;
      const model = typeof initRec.model === "string" ? initRec.model : undefined;
      const permissionMode = typeof initRec.permission_mode === "string" ? initRec.permission_mode : undefined;
      return cid
        ? [
            {
              type: "session_init",
              conversationId: cid,
              ...(model ? { model } : {}),
              ...(permissionMode ? { permissionMode } : {}),
            },
          ]
        : [];
    }

    if (eventType === "step_update") {
      const su = asPlainObj(obj.step_update);
      if (!su) return [];
      const cid = typeof su.conversation_id === "string" ? su.conversation_id.trim() : "";
      if (cid) this.conversationId = cid;

      const stepType = String(su.step_type ?? "");
      const state = String(su.state ?? "").toUpperCase();
      const stepIndex = typeof su.step_index === "number" ? su.step_index : -1;
      const out: AntigravityParsedEvent[] = [];

      if (stepType === "agent_response") {
        const thoughtDelta =
          typeof su.thought_delta === "string"
            ? su.thought_delta
            : typeof su.thinking_delta === "string"
              ? su.thinking_delta
              : "";
        if (thoughtDelta) {
          out.push({ type: "thinking", text: thoughtDelta });
        }
        const textDelta = typeof su.text_delta === "string" ? su.text_delta : "";
        if (textDelta) {
          this.emittedRootText = true;
          out.push({ type: "delta", text: textDelta });
        }
        return out;
      }

      if (stepType === "tool" && stepIndex >= 0) {
        const info = asPlainObj(su.tool_info) ?? {};
        const toolName = String(su.tool_name ?? info.name ?? "tool").trim() || "tool";
        const params = asPlainObj(info.parameters) ?? {};
        const id = `agy_step_${stepIndex}`;

        if (!this.emittedToolSteps.has(stepIndex)) {
          this.emittedToolSteps.add(stepIndex);
          this.toolMetaByStep.set(stepIndex, { tool: toolName, input: params });
          out.push({ type: "tool_start", id, tool: toolName, input: params });
        }

        if ((state === "DONE" || state === "ERROR" || state === "FAILED") && !this.completedToolSteps.has(stepIndex)) {
          this.completedToolSteps.add(stepIndex);
          const meta = this.toolMetaByStep.get(stepIndex) ?? { tool: toolName, input: params };
          const output =
            typeof info.output === "string"
              ? info.output
              : typeof info.error === "string"
                ? info.error
                : info.output !== undefined
                  ? JSON.stringify(info.output)
                  : "";
          const isError = state === "ERROR" || state === "FAILED" || Boolean(info.is_error || info.error);
          out.push({
            type: "tool_result",
            id,
            tool: meta.tool,
            output,
            isError,
            input: meta.input,
          });
        }
        return out;
      }

      return out;
    }

    if (eventType === "result") {
      const resRec = asPlainObj(obj.result) ?? {};
      const cid = String(resRec.conversation_id ?? convTop ?? this.conversationId).trim();
      if (cid) this.conversationId = cid;

      const status = String(resRec.status ?? "").toUpperCase();
      const usageRec = asPlainObj(resRec.usage) ?? {};
      const inputTokens = asInt(usageRec.input_tokens);
      const outputTokens = asInt(usageRec.output_tokens);
      const thinkingTokens = asInt(usageRec.thinking_tokens);
      const cacheReadTokens = asInt(usageRec.cache_read_tokens);
      const totalTokens = asInt(usageRec.total_tokens) || inputTokens + outputTokens;
      const durationSec = Number(resRec.duration_seconds);
      const durationMs = Number.isFinite(durationSec) && durationSec >= 0 ? Math.round(durationSec * 1000) : undefined;

      const isError = status !== "" && status !== "SUCCESS" && status !== "OK";
      const errMsg = typeof resRec.error === "string" ? resRec.error : "";
      const text =
        isError
          ? errMsg || (typeof resRec.response === "string" ? resRec.response : "")
          : typeof resRec.response === "string"
            ? resRec.response
            : "";

      const classified = isError ? classifyAntigravityError(text) : null;

      return [
        {
          type: "usage",
          inputTokens,
          outputTokens,
          thinkingTokens,
          cacheReadTokens,
          ...(durationMs !== undefined ? { durationMs } : {}),
          ...(cid ? { conversationId: cid } : {}),
        },
        {
          type: "result",
          text,
          isError,
          ...(classified ? { errorKind: classified.kind } : {}),
          ...(cid ? { conversationId: cid } : {}),
          ...(durationMs !== undefined ? { durationMs } : {}),
          usage: {
            inputTokens,
            outputTokens,
            thinkingTokens,
            cacheReadTokens,
            totalTokens,
          },
        },
      ];
    }

    return [];
  }

  parseLine(line: string): AntigravityParsedEvent[] {
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
