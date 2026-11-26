import { useT } from "@/lib/i18n";
import { diffCounts, lineDiff } from "@/lib/lineDiff";
import { basename } from "@/lib/utils";
import { type AiToolStep } from "@/stores/ai";

export function resolvePath(root: string, path: string): string {
  if (!path) return "";
  if (/^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\")) return path;
  if (!root) return "";
  const separator = root.includes("\\") ? "\\" : "/";
  const base = root.replace(/[\\/]+$/, "");
  const rest = separator === "\\" ? path.replace(/\//g, "\\") : path.replace(/\\/g, "/");
  return `${base}${separator}${rest}`;
}

export function stepTarget(step: AiToolStep): string {
  const input = step.input as {
    path?: string;
    Path?: string;
    file_path?: string;
    filePath?: string;
    TargetFile?: string;
    target_file?: string;
    AbsolutePath?: string;
    absolute_path?: string;
    file?: string;
    query?: string;
    Query?: string;
    pattern?: string;
    Pattern?: string;
    DirectoryPath?: string;
    SearchDirectory?: string;
    command?: string;
    CommandLine?: string;
    description?: string;
    subagent_type?: string;
    tab?: string;
    operation?: string;
    url?: string;
    method?: string;
    manifest?: string;
    action?: string;
    ref?: string;
    selector?: string;
    text?: string;
    key?: string;
    id?: string;
    toolId?: string;
  } | null;
  if (step.name === "Agent" || step.name === "Task") {
    return String(input?.description || input?.subagent_type || "Subagent");
  }
  if (step.name.startsWith("browser_")) {
    const labelMap: Record<string, string> = {
      browser_open: "Browser: Open",
      browser_navigate: "Browser: Navigate",
      browser_snapshot: "Browser: Snapshot",
      browser_click: "Browser: Click",
      browser_type: "Browser: Type",
      browser_press: "Browser: Press",
      browser_hover: "Browser: Hover",
      browser_select: "Browser: Select",
      browser_scroll: "Browser: Scroll",
      browser_wait: "Browser: Wait",
      browser_extract: "Browser: Extract",
      browser_console: "Browser: Console",
      browser_cookies: "Browser: Cookies",
      browser_eval: "Browser: Eval JS",
      browser_screenshot: "Browser: Screenshot",
      browser_close: "Browser: Close",
    };
    const head = labelMap[step.name] || step.name;
    const detail = input?.url || input?.ref || input?.selector || input?.key || input?.text || "";
    return detail ? `${head} (${String(detail).slice(0, 60)})` : head;
  }
  if (input?.url) {
    const m = String(input.method || "GET").toUpperCase();
    return `${m} ${input.url}`;
  }
  if (step.name === "run_security_scan" && !input?.path) {
    return "Project Security";
  }
  if (step.name === "check_dependencies" && !input?.manifest && !input?.path) {
    return "Project Dependencies";
  }
  if (step.name === "get_open_tabs" || step.name === "ui_state_get") {
    return step.name === "ui_state_get" ? "IDE Live State" : "Open Tabs";
  }
  if (step.name === "manage_catcher" || step.name === "catcher_control") {
    const cin = step.input as { action?: string; limit?: number; intercept?: boolean } | null;
    const act = String(cin?.action || "status").toLowerCase();
    if (act === "start") return "Catcher: Start Proxy";
    if (act === "stop") return "Catcher: Stop Proxy";
    if (act === "get_traffic" || act === "traffic") return "Catcher: Inspect Traffic";
    if (act === "set_intercept") return `Catcher: Intercept ${cin?.intercept ? "ON" : "OFF"}`;
    return `Catcher: ${act}`;
  }
  if (input?.action && (step.name.endsWith("_control") || step.name.includes("pitcher_") || step.name.includes("findings_") || step.name.includes("lsp_") || step.name.includes("terminal_session") || step.name.includes("wide_custom") || step.name === "run_tests")) {
    const suffix = input.path || input.file || input.key || input.toolId || input.id || "";
    return suffix ? `${step.name}: ${input.action} (${suffix})` : `${step.name}: ${input.action}`;
  }
  if (step.name === "fileChange") {
    const ch = (step.input as { changes?: Array<{ path?: string }> } | null)?.changes?.[0]?.path;
    if (ch) return String(ch);
  }
  return String(
    input?.manifest ??
      input?.TargetFile ??
      input?.target_file ??
      input?.AbsolutePath ??
      input?.absolute_path ??
      input?.Path ??
      input?.file_path ??
      input?.filePath ??
      input?.path ??
      input?.file ??
      input?.tab ??
      input?.operation ??
      input?.pattern ??
      input?.Pattern ??
      input?.query ??
      input?.Query ??
      input?.DirectoryPath ??
      input?.SearchDirectory ??
      input?.command ??
      input?.CommandLine ??
      "",
  );
}

export const OPENS_A_FILE = new Set([
  "read_file",
  "open_file",
  "view_file",
  "write_file",
  "edit_file",
  "write_to_file",
  "replace_file_content",
  "multi_replace_file_content",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "fileChange",
]);

export interface InspectorTarget {
  key: string;
  path: string;
  relativePath: string;
  action: "edited" | "created" | "analyzed";
  oldContent: string;
  newContent: string;
  targetLine?: number;
}

export function extractLineRange(step: AiToolStep, rawTarget: string): string {
  const input = (step.input && typeof step.input === "object" ? step.input : {}) as Record<string, unknown>;
  const start = input.StartLine ?? input.start_line ?? input.start ?? input.fromLine ?? input.from ?? input.offset;
  const end = input.EndLine ?? input.end_line ?? input.end ?? input.toLine ?? input.to;
  const single = input.line ?? input.Line ?? input.lineNumber;
  if (start !== undefined && end !== undefined) {
    return `#L${start}-${end}`;
  }
  if (start !== undefined && input.offset !== undefined && typeof input.limit === "number") {
    return `#L${start}-${Number(start) + input.limit - 1}`;
  }
  if (start !== undefined) {
    return `#L${start}`;
  }
  if (single !== undefined) {
    return `#L${single}`;
  }
  const match = String(rawTarget).match(/(?:#L|:)(\d+)(?:-(\d+))?/i);
  if (match) {
    return match[2] ? `#L${match[1]}-${match[2]}` : `#L${match[1]}`;
  }
  return "";
}

export function extractCommandInfo(step: AiToolStep): { commandText: string; exitCode: number | null } {
  const input = (step.input && typeof step.input === "object" ? step.input : {}) as Record<string, unknown>;
  let commandText = "";
  if (typeof input.toolSummary === "string" && input.toolSummary.trim()) {
    commandText = input.toolSummary.trim();
  } else if (typeof input.description === "string" && input.description.trim() && typeof input.command === "string") {
    commandText = `${input.description.trim()}: ${input.command.trim()}`;
  } else if (typeof input.command === "string" && input.command.trim()) {
    commandText = input.command.trim();
  } else if (typeof input.CommandLine === "string" && input.CommandLine.trim()) {
    commandText = input.CommandLine.trim();
  } else if (Array.isArray(input.args)) {
    commandText = `git ${input.args.map(String).join(" ")}`;
  } else {
    commandText = stepTarget(step) || step.name;
  }

  let exitCode: number | null = null;
  const rawResult = step.result || "";
  const exitMatch = rawResult.match(/^exit\s+(\d+)/i) || rawResult.match(/exited with code\s+(\d+)/i);
  if (exitMatch) {
    exitCode = parseInt(exitMatch[1], 10);
  }

  return { commandText, exitCode };
}

export function cleanCommandResult(raw: string): string {
  return raw.replace(/^exit\s+\d+\r?\n?/i, "").trim() || "(no output)";
}

export interface EnrichedStep {
  key: string;
  step: AiToolStep;
  rawTarget: string;
  fullPath: string;
  fileName: string;
  actionLabel: string;
  actionKind: "edited" | "created" | "analyzed" | "command" | "other";
  added: number;
  removed: number;
  lineRange: string;
  commandText: string;
  exitCode: number | null;
  httpStatus?: number | null;
  isHttp?: boolean;
  isSecurity?: boolean;
  isBrowser?: boolean;
}

export function parseHttpStatusFromResult(raw: string): number | null {
  if (!raw) return null;
  const jsonMatch = raw.match(/"status"\s*:\s*(\d{3})/);
  if (jsonMatch) return Number(jsonMatch[1]);
  const lineMatch = raw.match(/\bHTTP\/[\d.]+\s+(\d{3})\b/i);
  if (lineMatch) return Number(lineMatch[1]);
  return null;
}

export function enrichSteps(steps: AiToolStep[], root: string, t: ReturnType<typeof useT>, turnId: string): EnrichedStep[] {
  return steps.map((step, index) => {
    const rawTarget = stepTarget(step);
    const fullPath = step.filePath || (OPENS_A_FILE.has(step.name) ? resolvePath(root, rawTarget) : "");
    const fileName = fullPath ? basename(fullPath) : basename(rawTarget) || rawTarget;
    let actionLabel = step.name;
    let actionKind: "edited" | "created" | "analyzed" | "command" | "other" = "other";

    if (step.name === "read_file" || step.name === "open_file" || step.name === "view_file" || step.name === "Read") {
      actionLabel = t("Analyzed");
      actionKind = "analyzed";
    } else if (step.name === "write_file" || step.name === "write_to_file" || step.name === "Write" || step.name === "fileChange") {
      if (step.existed === false) {
        actionLabel = t("Created");
        actionKind = "created";
      } else {
        actionLabel = t("Edited");
        actionKind = "edited";
      }
    } else if (
      step.name === "edit_file" ||
      step.name === "replace_file_content" ||
      step.name === "multi_replace_file_content" ||
      step.name === "Edit" ||
      step.name === "MultiEdit"
    ) {
      actionLabel = t("Edited");
      actionKind = "edited";
    } else if (
      step.name === "run_command" ||
      step.name === "Bash" ||
      step.name === "commandExecution" ||
      step.name === "git" ||
      step.name === "send_http_request" ||
      step.name === "pitcher_send" ||
      step.name === "repeater_send" ||
      step.name === "intruder_attack" ||
      step.name === "manage_catcher" ||
      step.name === "catcher_control" ||
      step.name === "terminal_session" ||
      step.name === "engine_control" ||
      step.name === "debug_control" ||
      step.name === "wide_custom_tool_run" ||
      step.name === "run_tests" ||
      step.name.startsWith("browser_")
    ) {
      actionLabel = t("Ran");
      actionKind = "command";
    } else if (
      step.name === "search" ||
      step.name === "grep_search" ||
      step.name === "find_by_name" ||
      step.name === "find_relevant" ||
      step.name === "lsp_navigate" ||
      step.name === "Grep" ||
      step.name === "Glob" ||
      step.name === "WebSearch"
    ) {
      actionLabel = t("Searched");
    } else if (
      step.name === "list_dir" ||
      step.name === "create_dir" ||
      step.name === "open_tool_tab" ||
      step.name === "get_open_tabs" ||
      step.name === "ui_state_get" ||
      step.name === "vault_list_refs" ||
      step.name === "pitcher_env" ||
      step.name === "Agent" ||
      step.name === "Task" ||
      step.name === "WebFetch" ||
      step.name === "TodoWrite"
    ) {
      actionLabel = t("Explored");
    } else if (
      step.name === "get_diagnostics" ||
      step.name === "transform_data" ||
      step.name === "run_security_scan" ||
      step.name === "check_dependencies" ||
      step.name === "findings_query" ||
      step.name === "findings_baseline" ||
      step.name === "oast_control" ||
      step.name === "oast_poll" ||
      step.name.startsWith("catcher_")
    ) {
      actionLabel = t("Analyzed");
      actionKind = "analyzed";
    }

    let added = typeof step.added === "number" ? step.added : 0;
    let removed = typeof step.removed === "number" ? step.removed : 0;

    if (added === 0 && removed === 0 && (actionKind === "edited" || actionKind === "created")) {
      if (step.newContent !== undefined && step.oldContent !== undefined) {
        const counts = diffCounts(lineDiff(step.oldContent, step.newContent));
        added = counts.added;
        removed = counts.removed;
      } else if (step.input) {
        const input = step.input as Record<string, unknown>;
        const find = typeof input.find === "string"
          ? input.find
          : typeof input.old_string === "string"
            ? input.old_string
            : typeof input.old_str === "string"
              ? input.old_str
              : "";
        const replace = typeof input.replace === "string"
          ? input.replace
          : typeof input.new_string === "string"
            ? input.new_string
            : typeof input.new_str === "string"
              ? input.new_str
              : "";
        if (find || replace) {
          const counts = diffCounts(lineDiff(find, replace));
          added = counts.added;
          removed = counts.removed;
        } else if (typeof input.content === "string") {
          const lines = input.content.split("\n").length;
          added = lines;
          removed = step.existed === false ? 0 : Math.max(1, Math.round(lines * 0.5));
        }
      }
    }

    if (actionKind === "edited" && added === 0 && removed === 0) {
      added = 1;
      removed = 1;
    }

    const lineRange = actionKind === "analyzed" ? extractLineRange(step, rawTarget) : "";
    const isBrowser = step.name.startsWith("browser_");
    const isHttp = step.name === "send_http_request" || step.name === "pitcher_send" || step.name === "repeater_send" || step.name === "intruder_attack";
    const isSecurity =
      step.name === "run_security_scan" ||
      step.name === "check_dependencies" ||
      step.name === "manage_catcher" ||
      step.name.startsWith("catcher_") ||
      step.name.startsWith("findings_") ||
      step.name.startsWith("oast_") ||
      step.name === "vault_list_refs";
    const httpStatus = isHttp ? parseHttpStatusFromResult(step.result) : null;
    const { commandText, exitCode } = extractCommandInfo(step);

    return {
      key: `${turnId}-step-${index}`,
      step,
      rawTarget,
      fullPath,
      fileName,
      actionLabel,
      actionKind,
      added,
      removed,
      lineRange,
      commandText: isHttp || isBrowser ? rawTarget : commandText,
      exitCode,
      httpStatus,
      isHttp,
      isSecurity,
      isBrowser,
    };
  });
}
