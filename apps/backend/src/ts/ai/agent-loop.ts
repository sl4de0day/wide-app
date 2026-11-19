import type { AiInteractionMode, AiToolMode } from "./tool-registry";

export interface AiTurnExecutionContext {
  toolMode: AiToolMode;
  interactionMode: AiInteractionMode;
  allowBrowser: boolean;
  reviewEnabled: boolean;
  stagedFiles: Map<string, string>;
}

export interface AiDoomLoopTracker {
  check(name: string, input: unknown): string | null;
  record(name: string, input: unknown, resultText: unknown): void;
}

export function aiStableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => aiStableStringify(v)).join(",")}]`;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${aiStableStringify(rec[k])}`).join(",")}}`;
}

export function aiCreateDoomLoopTracker(): AiDoomLoopTracker {
  const callCounts = new Map<string, number>();
  let lastFailTool = "";
  let consecutiveFailCount = 0;

  return {
    check(name: string, input: unknown): string | null {
      const sig = `${name}:${aiStableStringify(input ?? {})}`;
      const hits = (callCounts.get(sig) || 0) + 1;
      callCounts.set(sig, hits);
      if (hits > 3) {
        return `Circuit breaker triggered: "${name}" was already invoked ${hits - 1} times with identical parameters. Stop repeating this call, analyze what happened, change parameters or tool, or present current findings to the user.`;
      }
      if (lastFailTool === name && consecutiveFailCount >= 3) {
        return `Circuit breaker triggered: "${name}" failed 3 times consecutively. Do not call "${name}" again in the same way; use another tool or inform the user concisely.`;
      }
      return null;
    },
    record(name: string, _input: unknown, resultText: unknown): void {
      const str = String(resultText ?? "");
      const failed = /^(That tool failed:|UNKNOWN_TOOL:|SCHEMA_VALIDATION_ERROR|PERMISSION_DENIED|TOOL_DISABLED_IN_MODE|Unknown tool|Missing required|Permission denied|Command blocked|Invalid |Navigation failed|Browser .* failed|Proxy .* failed|Replay failed|Intruder failed|Error:|exit [1-9])/i.test(
        str.trim(),
      );
      if (failed) {
        if (lastFailTool === name) consecutiveFailCount += 1;
        else {
          lastFailTool = name;
          consecutiveFailCount = 1;
        }
      } else if (lastFailTool === name) {
        lastFailTool = "";
        consecutiveFailCount = 0;
      }
    },
  };
}
