export type CodexEffortLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type CodexErrorKind = "auth" | "session_not_found" | "rate_limit" | "unknown";

export interface CodexEffortOption {
  reasoningEffort: string;
  description: string;
}

export interface CodexModelInfo {
  id: string;
  model: string;
  displayName: string;
  description?: string;
  supportedReasoningEfforts: CodexEffortOption[];
  defaultReasoningEffort: string;
  inputModalities?: string[];
  isDefault?: boolean;
}

export type CodexParsedEvent =
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_start"; id: string; tool: string; input: Record<string, unknown> }
  | {
      type: "tool_result";
      id: string;
      tool: string;
      output: string;
      isError: boolean;
      changes?: Array<{ path: string; kind: string; diff: string }>;
    }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      reasoningTokens: number;
      totalTokens: number;
    }
  | {
      type: "turn_done";
      isError: boolean;
      message?: string;
      errorKind?: CodexErrorKind;
      durationMs?: number;
    };

export const DEFAULT_CODEX_MODELS: readonly CodexModelInfo[] = [
  {
    id: "gpt-6.2-sol",
    model: "gpt-6.2-sol",
    displayName: "GPT-6.2-Sol",
    description: "Fast, go-to model for coding and everyday work.",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Fast responses with lighter reasoning" },
      { reasoningEffort: "medium", description: "Balances speed and reasoning depth for everyday tasks" },
      { reasoningEffort: "high", description: "Greater reasoning depth for complex problems" },
      { reasoningEffort: "xhigh", description: "Extra high reasoning depth for complex problems" },
      { reasoningEffort: "max", description: "Maximum reasoning depth for the hardest problems" },
      { reasoningEffort: "ultra", description: "Maximum reasoning with automatic task delegation" },
    ],
    defaultReasoningEffort: "low",
    inputModalities: ["text", "image"],
    isDefault: true,
  },
  {
    id: "gpt-6.2-astra",
    model: "gpt-6.2-astra",
    displayName: "GPT-6.2-Astra",
    description: "Most capable model for complex coding and professional work.",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Fast responses with lighter reasoning" },
      { reasoningEffort: "medium", description: "Balances speed and reasoning depth for everyday tasks" },
      { reasoningEffort: "high", description: "Greater reasoning depth for complex problems" },
      { reasoningEffort: "xhigh", description: "Extra high reasoning depth for complex problems" },
      { reasoningEffort: "max", description: "Maximum reasoning depth for the hardest problems" },
      { reasoningEffort: "ultra", description: "Maximum reasoning with automatic task delegation" },
    ],
    defaultReasoningEffort: "low",
    inputModalities: ["text", "image"],
    isDefault: false,
  },
  {
    id: "gpt-6.1-terra",
    model: "gpt-6.1-terra",
    displayName: "GPT-6.1 Terra",
    description: "Efficient model for visual understanding and computer use.",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Fast responses with lighter reasoning" },
      { reasoningEffort: "medium", description: "Balances speed and reasoning depth for everyday tasks" },
      { reasoningEffort: "high", description: "Greater reasoning depth for complex problems" },
      { reasoningEffort: "xhigh", description: "Extra high reasoning depth for complex problems" },
      { reasoningEffort: "max", description: "Maximum reasoning depth for the hardest problems" },
      { reasoningEffort: "ultra", description: "Maximum reasoning with automatic task delegation" },
    ],
    defaultReasoningEffort: "low",
    inputModalities: ["text", "image"],
    isDefault: false,
  },
  {
    id: "gpt-6-luna",
    model: "gpt-6-luna",
    displayName: "GPT-6-Luna",
    description: "Fast and affordable model for easier tasks.",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Fast responses with lighter reasoning" },
      { reasoningEffort: "medium", description: "Balances speed and reasoning depth for everyday tasks" },
      { reasoningEffort: "high", description: "Greater reasoning depth for complex problems" },
      { reasoningEffort: "xhigh", description: "Extra high reasoning depth for complex problems" },
      { reasoningEffort: "max", description: "Maximum reasoning depth for the hardest problems" },
    ],
    defaultReasoningEffort: "medium",
    inputModalities: ["text", "image"],
    isDefault: false,
  },
  {
    id: "gpt-5.5",
    model: "gpt-5.5",
    displayName: "GPT-5.5",
    description: "Legacy coding model.",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Fast responses with lighter reasoning" },
      { reasoningEffort: "medium", description: "Balances speed and reasoning depth for everyday tasks" },
      { reasoningEffort: "high", description: "Greater reasoning depth for complex problems" },
      { reasoningEffort: "xhigh", description: "Extra high reasoning depth for complex problems" },
    ],
    defaultReasoningEffort: "medium",
    inputModalities: ["text", "image"],
    isDefault: false,
  },
];

const EFFORT_RANK: readonly string[] = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export function sanitizeCodexEnv(baseEnv: Record<string, string | undefined>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [key, val] of Object.entries(baseEnv)) {
    if (val === undefined) continue;
    const upper = key.toUpperCase();
    if (
      upper === "OPENAI_API_KEY" ||
      upper === "OPENAI_BASE_URL" ||
      upper === "OPENAI_ORG_ID" ||
      upper === "OPENAI_PROJECT_ID" ||
      upper === "CODEX_API_KEY"
    ) {
      continue;
    }
    clean[key] = val;
  }
  return clean;
}

export function normalizeCodexModelsResponse(raw: unknown): CodexModelInfo[] {
  const list = Array.isArray((raw as { data?: unknown })?.data)
    ? ((raw as { data: unknown[] }).data)
    : Array.isArray(raw)
      ? raw
      : [];
  const out: CodexModelInfo[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const rec = entry as Record<string, unknown>;
    if (rec.hidden === true) continue;
    const id = String(rec.model ?? rec.id ?? "").trim();
    if (!id) continue;
    const displayName = String(rec.displayName ?? id).trim() || id;
    const rawEfforts = Array.isArray(rec.supportedReasoningEfforts) ? rec.supportedReasoningEfforts : [];
    const supportedReasoningEfforts: CodexEffortOption[] = rawEfforts
      .map((opt) => {
        if (!opt || typeof opt !== "object") return null;
        const o = opt as Record<string, unknown>;
        const reasoningEffort = String(o.reasoningEffort ?? "").trim().toLowerCase();
        if (!reasoningEffort) return null;
        return {
          reasoningEffort,
          description: String(o.description ?? "").trim(),
        };
      })
      .filter((x): x is CodexEffortOption => x !== null);
    const defaultReasoningEffort =
      String(rec.defaultReasoningEffort ?? "").trim().toLowerCase() ||
      supportedReasoningEfforts[0]?.reasoningEffort ||
      "medium";
    const inputModalities = Array.isArray(rec.inputModalities)
      ? rec.inputModalities.map((m) => String(m))
      : ["text", "image"];
    out.push({
      id,
      model: id,
      displayName,
      description: typeof rec.description === "string" ? rec.description : "",
      supportedReasoningEfforts,
      defaultReasoningEffort,
      inputModalities,
      isDefault: Boolean(rec.isDefault),
    });
  }
  return out;
}

export function resolveCodexEffortForModel(
  modelId?: string | null,
  requestedEffort?: string | null,
  catalog: readonly CodexModelInfo[] = DEFAULT_CODEX_MODELS,
): string {
  const list = catalog.length > 0 ? catalog : DEFAULT_CODEX_MODELS;
  const cleanModel = String(modelId ?? "").trim();
  const target =
    (cleanModel && cleanModel.toLowerCase() !== "default"
      ? list.find((m) => m.id === cleanModel || m.model === cleanModel)
      : undefined) ||
    list.find((m) => m.isDefault) ||
    list[0];
  if (!target || target.supportedReasoningEfforts.length === 0) {
    return String(requestedEffort ?? "high").trim().toLowerCase() || "high";
  }
  const available = target.supportedReasoningEfforts.map((o) => o.reasoningEffort);
  const req = String(requestedEffort ?? "").trim().toLowerCase();
  if (req && available.includes(req)) {
    return req;
  }
  const reqIdx = EFFORT_RANK.indexOf(req);
  if (reqIdx >= 0) {
    let best = available[0];
    let bestDist = Infinity;
    for (const cand of available) {
      const candIdx = EFFORT_RANK.indexOf(cand);
      if (candIdx < 0) continue;
      const dist = Math.abs(candIdx - reqIdx);
      if (dist < bestDist) {
        bestDist = dist;
        best = cand;
      }
    }
    return best;
  }
  return available.includes(target.defaultReasoningEffort) ? target.defaultReasoningEffort : available[0];
}

export function parseCodexAccountResult(raw: unknown): {
  signedIn: boolean;
  authType: string;
  email: string;
  planType: string;
} {
  const rec = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const acc = rec.account && typeof rec.account === "object" ? (rec.account as Record<string, unknown>) : null;
  const authType = String(acc?.type ?? "").trim();
  if (authType !== "chatgpt") {
    return { signedIn: false, authType, email: "", planType: "" };
  }
  return {
    signedIn: true,
    authType,
    email: typeof acc?.email === "string" ? acc.email : "",
    planType: typeof acc?.planType === "string" ? acc.planType : "",
  };
}

export function buildCodexAppServerArgs(opts: { mcpUrl?: string; bearerEnvVar?: string } = {}): string[] {
  const args: string[] = ["app-server", "--listen", "stdio://"];
  const mcpUrl = String(opts.mcpUrl ?? "").trim();
  if (mcpUrl) {
    args.push("-c", `mcp_servers.wide.url=${JSON.stringify(mcpUrl)}`);
    const bearerEnv = String(opts.bearerEnvVar ?? "").trim();
    if (bearerEnv) {
      args.push("-c", `mcp_servers.wide.bearer_token_env_var=${JSON.stringify(bearerEnv)}`);
    }
  }
  return args;
}

export function buildCodexThreadStartParams(opts: {
  root?: string;
  model?: string;
  mode?: string;
  developerInstructions?: string;
  ephemeral?: boolean;
}): Record<string, unknown> {
  const isAsk = String(opts.mode ?? "agent").trim().toLowerCase() === "ask";
  const params: Record<string, unknown> = {
    approvalPolicy: "never",
    sandbox: isAsk ? "read-only" : "workspace-write",
  };
  const cleanModel = String(opts.model ?? "").trim();
  if (cleanModel && cleanModel.toLowerCase() !== "default") {
    params.model = cleanModel;
  }
  const cleanRoot = String(opts.root ?? "").trim();
  if (cleanRoot) {
    params.cwd = cleanRoot;
  }
  const instr = String(opts.developerInstructions ?? "").trim();
  if (instr) {
    params.developerInstructions = instr;
  }
  if (opts.ephemeral) {
    params.ephemeral = true;
  }
  return params;
}

export function buildCodexUserInputs(text: string, imagePaths: readonly string[] = []): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const imgPath of imagePaths) {
    const clean = String(imgPath ?? "").trim();
    if (clean) {
      out.push({ type: "localImage", path: clean });
    }
  }
  out.push({ type: "text", text: String(text || "Continue."), text_elements: [] });
  return out;
}

export function classifyCodexError(rawMessage: string): { kind: CodexErrorKind; message: string } {
  const message = String(rawMessage ?? "").trim() || "Codex CLI execution failed.";
  const lower = message.toLowerCase();
  if (
    lower.includes("not logged in") ||
    lower.includes("requires openai auth") ||
    lower.includes("requiresopenaiauth") ||
    lower.includes("unauthorized") ||
    lower.includes("login") ||
    lower.includes("sign in") ||
    lower.includes("authentication")
  ) {
    return { kind: "auth", message };
  }
  if (
    lower.includes("thread not found") ||
    lower.includes("no rollout found") ||
    (lower.includes("thread") && lower.includes("not found")) ||
    (lower.includes("session") && lower.includes("not found"))
  ) {
    return { kind: "session_not_found", message };
  }
  if (lower.includes("rate limit") || lower.includes("too many requests") || lower.includes("429") || lower.includes("quota")) {
    return { kind: "rate_limit", message };
  }
  return { kind: "unknown", message };
}

export class CodexAppServerNotificationParser {
  private readonly emittedDeltaItems = new Set<string>();
  private readonly wideMcpToolIds = new Set<string>();

  public feedNotification(method: string, params: Record<string, unknown> = {}): CodexParsedEvent[] {
    const out: CodexParsedEvent[] = [];

    if (method === "item/agentMessage/delta") {
      const itemId = String(params.itemId ?? "");
      const delta = typeof params.delta === "string" ? params.delta : "";
      if (delta) {
        if (itemId) this.emittedDeltaItems.add(itemId);
        out.push({ type: "delta", text: delta });
      }
      return out;
    }

    if (method === "item/reasoning/summaryTextDelta" || method === "item/reasoning/textDelta") {
      const delta = typeof params.delta === "string" ? params.delta : "";
      if (delta) {
        out.push({ type: "thinking", text: delta });
      }
      return out;
    }

    if (method === "item/started") {
      const item = params.item && typeof params.item === "object" ? (params.item as Record<string, unknown>) : null;
      if (!item) return out;
      const itemType = String(item.type ?? "");
      const id = String(item.id ?? "");
      if (itemType === "commandExecution") {
        out.push({
          type: "tool_start",
          id,
          tool: "commandExecution",
          input: {
            command: typeof item.command === "string" ? item.command : "",
            cwd: typeof item.cwd === "string" ? item.cwd : "",
          },
        });
      } else if (itemType === "fileChange") {
        const changes = Array.isArray(item.changes) ? item.changes : [];
        const firstPath =
          changes[0] && typeof changes[0] === "object" ? String((changes[0] as { path?: unknown }).path ?? "") : "";
        out.push({
          type: "tool_start",
          id,
          tool: "fileChange",
          input: {
            ...(firstPath ? { path: firstPath } : {}),
            changes,
          },
        });
      } else if (itemType === "mcpToolCall") {
        const server = String(item.server ?? "");
        const tool = String(item.tool ?? "");
        if (server === "wide") {
          this.wideMcpToolIds.add(id);
        } else if (tool) {
          out.push({
            type: "tool_start",
            id,
            tool,
            input: item.arguments && typeof item.arguments === "object" ? (item.arguments as Record<string, unknown>) : {},
          });
        }
      }
      return out;
    }

    if (method === "item/completed") {
      const item = params.item && typeof params.item === "object" ? (params.item as Record<string, unknown>) : null;
      if (!item) return out;
      const itemType = String(item.type ?? "");
      const id = String(item.id ?? "");

      if (itemType === "agentMessage") {
        const text = typeof item.text === "string" ? item.text : "";
        if (text && !this.emittedDeltaItems.has(id)) {
          out.push({ type: "delta", text });
        }
        return out;
      }

      if (itemType === "commandExecution") {
        const status = String(item.status ?? "");
        const exitCode = typeof item.exitCode === "number" ? item.exitCode : null;
        const output = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "";
        const isError = status === "failed" || (exitCode !== null && exitCode !== 0);
        out.push({ type: "tool_result", id, tool: "commandExecution", output, isError });
        return out;
      }

      if (itemType === "fileChange") {
        const status = String(item.status ?? "");
        const rawChanges = Array.isArray(item.changes) ? item.changes : [];
        const changes = rawChanges
          .map((ch) => {
            if (!ch || typeof ch !== "object") return null;
            const c = ch as Record<string, unknown>;
            const kindObj = c.kind && typeof c.kind === "object" ? (c.kind as { type?: unknown }) : null;
            return {
              path: String(c.path ?? ""),
              kind: String(kindObj?.type ?? c.kind ?? "update"),
              diff: String(c.diff ?? ""),
            };
          })
          .filter((x): x is { path: string; kind: string; diff: string } => x !== null && Boolean(x.path));
        const isError = status === "failed";
        const output = changes.map((c) => `${c.kind}: ${c.path}`).join("\n");
        out.push({ type: "tool_result", id, tool: "fileChange", output, isError, changes });
        return out;
      }

      if (itemType === "mcpToolCall") {
        if (this.wideMcpToolIds.has(id)) {
          this.wideMcpToolIds.delete(id);
          return out;
        }
        const tool = String(item.tool ?? "");
        const status = String(item.status ?? "");
        const err = item.error && typeof item.error === "object" ? (item.error as { message?: unknown }) : null;
        const res = item.result && typeof item.result === "object" ? (item.result as { content?: unknown }) : null;
        const output = err?.message
          ? String(err.message)
          : res?.content
            ? JSON.stringify(res.content)
            : "";
        if (tool) {
          out.push({
            type: "tool_result",
            id,
            tool,
            output,
            isError: status === "failed" || Boolean(err),
          });
        }
        return out;
      }

      return out;
    }

    if (method === "thread/tokenUsage/updated") {
      const tokenUsage =
        params.tokenUsage && typeof params.tokenUsage === "object"
          ? (params.tokenUsage as { last?: Record<string, unknown>; total?: Record<string, unknown> })
          : null;
      const last = tokenUsage?.last && typeof tokenUsage.last === "object" ? tokenUsage.last : tokenUsage?.total;
      if (last) {
        const inputTokens = Number(last.inputTokens ?? 0) || 0;
        const outputTokens = Number(last.outputTokens ?? 0) || 0;
        const cacheReadTokens = Number(last.cachedInputTokens ?? 0) || 0;
        const reasoningTokens = Number(last.reasoningOutputTokens ?? 0) || 0;
        const totalTokens = Number(last.totalTokens ?? inputTokens + outputTokens + reasoningTokens) || 0;
        out.push({ type: "usage", inputTokens, outputTokens, cacheReadTokens, reasoningTokens, totalTokens });
      }
      return out;
    }

    if (method === "turn/completed") {
      const turn = params.turn && typeof params.turn === "object" ? (params.turn as Record<string, unknown>) : {};
      const status = String(turn.status ?? "");
      const durationMs = typeof turn.durationMs === "number" ? turn.durationMs : undefined;
      if (status === "failed") {
        const err = turn.error && typeof turn.error === "object" ? (turn.error as Record<string, unknown>) : {};
        const classified = classifyCodexError(String(err.message ?? err.additionalDetails ?? "Codex turn failed."));
        out.push({
          type: "turn_done",
          isError: true,
          message: classified.message,
          errorKind: classified.kind,
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
      } else {
        out.push({
          type: "turn_done",
          isError: false,
          ...(durationMs !== undefined ? { durationMs } : {}),
        });
      }
      return out;
    }

    if (method === "error" && params.willRetry === false) {
      const err = params.error && typeof params.error === "object" ? (params.error as Record<string, unknown>) : {};
      const classified = classifyCodexError(String(err.message ?? err.additionalDetails ?? "Codex server error."));
      out.push({
        type: "turn_done",
        isError: true,
        message: classified.message,
        errorKind: classified.kind,
      });
    }

    return out;
  }
}
