import { ChevronRight, ExternalLink } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { basename, cn } from "@/lib/utils";
import { openWideToolTab, type AiToolStep } from "@/stores/ai";
import { useAiBrowser } from "@/stores/aiBrowser";
import { useWorkspace } from "@/stores/workspace";
import { FileTypeBadge } from "./FileTypeBadge";
import { cleanCommandResult, enrichSteps, type EnrichedStep, type InspectorTarget } from "./steps";

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

function useElapsed(since: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;
}

export function AgentProcessStream({
  steps,
  streaming,
  activeInspectKey,
  onInspectFile,
  onFailure,
  turnId,
  thoughtSec = 0,
  startedAt,
}: {
  steps: AiToolStep[];
  streaming: boolean;
  activeInspectKey: string;
  onInspectFile: (target: InspectorTarget) => void;
  onFailure: (message: string) => void;
  turnId: string;
  thoughtSec?: number;
  startedAt?: number;
}) {
  const t = useT();
  const root = useWorkspace((state) => state.root) ?? "";
  const liveBrowserFrame = useAiBrowser((state) => state.frame);
  const liveBrowserUrl = useAiBrowser((state) => state.url);
  const enrichedSteps = useMemo(() => enrichSteps(steps, root, t, turnId), [steps, root, t, turnId]);
  const [expandedCommands, setExpandedCommands] = useState<Record<string, boolean>>({});
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  const isExpanded = userExpanded ?? false;
  const elapsed = useElapsed(streaming ? startedAt : undefined);

  const summary = useMemo(() => {
    const counts = { command: 0, edited: 0, created: 0, analyzed: 0, other: 0 };
    for (const item of enrichedSteps) counts[item.actionKind] += 1;
    const parts: string[] = [];
    if (counts.command) parts.push(counts.command === 1 ? t("Ran 1 command") : t("Ran {count} commands", { count: counts.command }));
    if (counts.edited) parts.push(counts.edited === 1 ? t("Edited 1 file") : t("Edited {count} files", { count: counts.edited }));
    if (counts.created) parts.push(counts.created === 1 ? t("Created 1 file") : t("Created {count} files", { count: counts.created }));
    if (counts.analyzed) parts.push(counts.analyzed === 1 ? t("Analyzed 1 item") : t("Analyzed {count} items", { count: counts.analyzed }));
    if (counts.other) parts.push(counts.other === 1 ? t("1 other step") : t("{count} other steps", { count: counts.other }));
    return parts.join(" · ");
  }, [enrichedSteps, t]);

  const totalAdded = useMemo(() => enrichedSteps.reduce((acc, s) => acc + s.added, 0), [enrichedSteps]);
  const totalRemoved = useMemo(() => enrichedSteps.reduce((acc, s) => acc + s.removed, 0), [enrichedSteps]);

  const toggleCommand = (key: string) => {
    setExpandedCommands((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleStepClick = async (item: EnrichedStep) => {
    if (!item.fullPath) return;
    const startLineMatch = item.lineRange.match(/#L(\d+)/);
    const targetLine = startLineMatch ? parseInt(startLineMatch[1], 10) : undefined;

    if (item.step.newContent !== undefined && item.step.oldContent !== undefined) {
      onInspectFile({
        key: item.key,
        path: item.fullPath,
        relativePath: item.rawTarget || basename(item.fullPath),
        action: item.actionKind === "edited" || item.actionKind === "created" ? item.actionKind : "analyzed",
        oldContent: item.step.oldContent,
        newContent: item.step.newContent,
        targetLine,
      });
      return;
    }
    if (item.actionKind === "edited" && item.step.input) {
      const input = item.step.input as Record<string, unknown>;
      const find = typeof input.find === "string" ? input.find : (typeof input.old_str === "string" ? input.old_str : "");
      const replace = typeof input.replace === "string" ? input.replace : (typeof input.new_str === "string" ? input.new_str : "");
      if (find || replace) {
        onInspectFile({
          key: item.key,
          path: item.fullPath,
          relativePath: item.rawTarget || basename(item.fullPath),
          action: "edited",
          oldContent: find,
          newContent: replace,
          targetLine,
        });
        return;
      }
    }
    const read = await bridge.readFile(item.fullPath).catch(() => null);
    if (!read || read.error || read.content == null) {
      onFailure(t("{name} could not be opened.", { name: item.fileName }));
      return;
    }
    onInspectFile({
      key: item.key,
      path: item.fullPath,
      relativePath: item.rawTarget || basename(item.fullPath),
      action: item.actionKind === "edited" || item.actionKind === "created" ? item.actionKind : "analyzed",
      oldContent: item.step.oldContent ?? "",
      newContent: item.step.newContent ?? read.content,
      targetLine,
    });
  };

  if (enrichedSteps.length === 0 && !streaming) return null;

  const last = enrichedSteps[enrichedSteps.length - 1];
  const liveLabel = last
    ? `${last.actionLabel} ${last.actionKind === "command" ? last.commandText : last.fileName}`.trim()
    : t("Working");

  return (
    <div className="flex flex-col gap-1">
      {enrichedSteps.length > 0 && (
        <button
          type="button"
          onClick={() => setUserExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          className="group/proc -mx-2 flex w-fit max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-body text-fg-faint transition-colors duration-100 hover:text-fg-dim select-none"
        >
          <span className="truncate">{summary}</span>
          {!streaming && thoughtSec > 0 && <span className="shrink-0">· {formatElapsed(thoughtSec)}</span>}
          {(totalAdded > 0 || totalRemoved > 0) && (
            <span className="flex shrink-0 items-center gap-1 font-mono text-meta">
              {totalAdded > 0 && <span className="text-status-ok">+{totalAdded}</span>}
              {totalRemoved > 0 && <span className="text-status-error">−{totalRemoved}</span>}
            </span>
          )}
          <ChevronRight
            className={cn("size-icon-sm shrink-0 transition-transform duration-150", isExpanded && "rotate-90")}
            strokeWidth={1.75}
          />
        </button>
      )}

      {isExpanded && enrichedSteps.length > 0 && (
        <div className="wide-enter-fade ml-1 flex flex-col gap-0.5 border-l border-line pl-3">
          {enrichedSteps.map((item) => {
            const isSelected = activeInspectKey === item.key;
            const isCommand = item.actionKind === "command";
            const isCommandExpanded = Boolean(expandedCommands[item.key]);

            return (
              <div key={item.key} className="flex flex-col">
                <div
                  onClick={() => {
                    if (isCommand) {
                      toggleCommand(item.key);
                    } else if (item.fullPath) {
                      void handleStepClick(item);
                    }
                  }}
                  className={cn(
                    "wide-step-item group flex min-h-7 items-center gap-2 rounded-md px-2 -mx-2 text-left transition-colors duration-100 cursor-pointer select-none",
                    isSelected
                      ? "bg-selected text-fg"
                      : "hover:bg-hover text-fg-dim",
                  )}
                >
                  <span className="text-meta text-fg-faint shrink-0">
                    {item.actionLabel}
                  </span>

                  {(item.added > 0 || item.removed > 0) && (
                    <span className="flex items-center gap-1 font-mono text-[11px] shrink-0 select-none">
                      {item.added > 0 && <span className="text-status-ok font-semibold">+{item.added}</span>}
                      {item.removed > 0 && <span className="text-status-error font-semibold">−{item.removed}</span>}
                    </span>
                  )}

                  <FileTypeBadge fileName={item.fileName} isCommand={isCommand} isHttp={item.isHttp} isSecurity={item.isSecurity} isBrowser={item.isBrowser} />

                  <span
                    className={cn(
                      "min-w-0 truncate text-meta transition-colors",
                      isCommand
                        ? "font-mono text-fg-dim group-hover:text-fg"
                        : "text-fg-muted group-hover:text-fg",
                    )}
                    title={item.fullPath || item.commandText || item.fileName}
                  >
                    {isCommand ? item.commandText : item.fileName}
                  </span>

                  {item.httpStatus != null && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold shrink-0 select-none",
                        item.httpStatus >= 200 && item.httpStatus < 300 && "bg-status-ok/12 text-status-ok",
                        item.httpStatus >= 300 && item.httpStatus < 400 && "bg-status-warn/12 text-status-warn",
                        item.httpStatus >= 400 && "bg-status-error/12 text-status-error",
                      )}
                    >
                      {item.httpStatus}
                    </span>
                  )}

                  {item.step.staged && (
                    <span className="rounded bg-status-warn/12 px-1.5 py-0.5 font-mono text-[10px] font-medium text-status-warn shrink-0 select-none">
                      {t("Staged")}
                    </span>
                  )}

                  {item.step.verification && (
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 font-mono text-[10px] font-medium shrink-0 select-none",
                        item.step.verification.errors > 0
                          ? "bg-status-error/12 text-status-error"
                          : item.step.verification.warnings > 0
                            ? "bg-status-warn/12 text-status-warn"
                            : "border border-line bg-panel text-fg-dim",
                      )}
                      title={item.step.verification.diagnostics?.map((d) => `L${d.line}: ${d.message}`).join("\n") || ""}
                    >
                      {item.step.verification.errors > 0
                        ? t("{count} errors", { count: item.step.verification.errors })
                        : item.step.verification.warnings > 0
                          ? t("{count} warnings", { count: item.step.verification.warnings })
                          : t("0 errors")}
                    </span>
                  )}

                  {item.isBrowser && item.step.name !== "browser_close" && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openWideToolTab("browser");
                      }}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/15 transition-colors shrink-0"
                    >
                      <ExternalLink className="size-2.5" strokeWidth={2} />
                      <span>{t("Open")}</span>
                    </button>
                  )}

                  {item.lineRange && (
                    <span className="font-mono text-[11px] text-fg-faint/70 select-none shrink-0">
                      {item.lineRange}
                    </span>
                  )}

                  {isCommand && item.exitCode !== null && item.exitCode !== 0 && (
                    <span className="text-[11px] text-status-error shrink-0 select-none">
                      · {t("Exited with code {code}", { code: item.exitCode })}
                    </span>
                  )}

                  {isCommand && (
                    <ChevronRight
                      className={cn(
                        "size-3 text-fg-faint/60 group-hover:text-fg transition-transform shrink-0 ml-auto",
                        isCommandExpanded && "rotate-90",
                      )}
                      strokeWidth={2}
                    />
                  )}
                </div>

                {isCommand && isCommandExpanded && (
                  <div className="mb-1.5 mt-0.5 flex flex-col gap-2">
                    {item.isBrowser && liveBrowserFrame && (
                      <button
                        type="button"
                        onClick={() => openWideToolTab("browser")}
                        className="group/thumb relative w-fit overflow-hidden rounded-lg border border-line/70 bg-canvas text-left shadow-sm"
                      >
                        <img
                          src={liveBrowserFrame.startsWith("data:") ? liveBrowserFrame : `data:image/jpeg;base64,${liveBrowserFrame}`}
                          alt={liveBrowserUrl || "Browser"}
                          className="block max-h-36 w-auto object-cover"
                        />
                        {liveBrowserUrl && (
                          <div className="truncate border-t border-line/60 bg-panel/90 px-2 py-0.5 font-mono text-[10px] text-fg-dim">
                            {liveBrowserUrl}
                          </div>
                        )}
                      </button>
                    )}
                    <div className="max-h-56 overflow-auto whitespace-pre-wrap rounded-lg bg-panel px-3 py-2 font-mono text-caption text-fg-dim select-text wide-enter-fade">
                      {cleanCommandResult(item.step.result)}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {streaming && (
        <div className="wide-step-item flex min-w-0 items-center gap-2.5 py-1 select-none" role="status">
          <span className="flex shrink-0 items-center gap-0.5 text-accent" aria-hidden="true">
            <span className="wide-wave-dot size-1 rounded-full bg-current" />
            <span className="wide-wave-dot size-1 rounded-full bg-current" />
            <span className="wide-wave-dot size-1 rounded-full bg-current" />
          </span>
          <span className="wide-shimmer-text min-w-0 truncate text-body">{liveLabel}</span>
          {elapsed > 0 && <span className="shrink-0 text-meta text-fg-faint">{formatElapsed(elapsed)}</span>}
        </div>
      )}
    </div>
  );
}
