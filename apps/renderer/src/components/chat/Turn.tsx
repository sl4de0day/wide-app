import { AlertCircle, Check, ChevronRight, Copy, Pencil, RefreshCw, RotateCcw } from "lucide-react";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { plainText } from "@/lib/plainText";
import { cn, copyText } from "@/lib/utils";
import { useAi, type AiTurn } from "@/stores/ai";
import { AgentProcessStream } from "./AgentProcessStream";
import { MessageBody } from "./MessageBody";
import { BODY, QUESTION, tokens } from "./shared";
import type { InspectorTarget } from "./steps";

function TurnAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-7 items-center justify-center rounded-md text-fg-faint transition-colors duration-100",
        danger ? "hover:bg-status-error/12 hover:text-status-error" : "hover:bg-hover hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export const Turn = memo(function Turn({
  turn,
  divider,
  last,
  activeInspectKey,
  onInspectFile,
  onFailure,
  onRegenerate,
  onEdit,
  onUndoToHere,
}: {
  turn: AiTurn;
  divider: boolean;
  last: boolean;
  activeInspectKey: string;
  onInspectFile: (target: InspectorTarget) => void;
  onFailure: (message: string) => void;
  onRegenerate: () => void;
  onEdit?: (text: string) => void;
  onUndoToHere?: (turn: AiTurn) => void;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);

  const shown = turn.text;
  const hasThinking = Boolean(turn.thinking && turn.thinking.trim().length > 0);

  const thoughtSec = useMemo(() => {
    if (!turn.startedAt || turn.streaming) return 0;
    const end = turn.endedAt ?? Date.now();
    return Math.max(1, Math.round((end - turn.startedAt) / 1000));
  }, [turn.startedAt, turn.endedAt, turn.streaming]);

  const reasoning = useMemo(
    () => (hasThinking && turn.thinking ? plainText(turn.thinking) : ""),
    [turn.thinking, hasThinking],
  );

  const copy = async () => {
    if (await copyText(shown)) setCopied(true);
  };

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyIcon = copied ? (
    <Check className="size-icon-sm text-status-ok" strokeWidth={2} />
  ) : (
    <Copy className="size-icon-sm" strokeWidth={1.5} />
  );

  if (turn.role === "user") {
    return (
      <div
        {...{ [QUESTION]: "" }}
        className={cn("group/user flex w-full flex-col items-end gap-1", divider && "mt-4")}
      >
        <div className="max-w-[85%] rounded-2xl bg-raised px-4 py-2.5">
          <p className={cn("whitespace-pre-wrap text-left", BODY)}>{turn.text}</p>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/user:opacity-100 focus-within:opacity-100">
          <TurnAction label={copied ? t("Copied") : t("Copy")} onClick={() => void copy()}>
            {copyIcon}
          </TurnAction>
          {onEdit && (
            <TurnAction label={t("Edit this message")} onClick={() => onEdit(turn.text)}>
              <Pencil className="size-icon-sm" strokeWidth={1.5} />
            </TurnAction>
          )}
          {onUndoToHere && (
            <TurnAction label={t("Undo to this point")} onClick={() => void onUndoToHere(turn)} danger>
              <RotateCcw className="size-icon-sm" strokeWidth={1.5} />
            </TurnAction>
          )}
        </div>
      </div>
    );
  }

  const showStream = turn.steps.length > 0 || (turn.streaming && !shown);
  const showFooter = !turn.streaming && (shown || last || (turn.usage && turn.usage.total > 0) || thoughtSec > 0);

  const usageTitle = turn.usage
    ? [
        `In: ${tokens(turn.usage.input)}`,
        `Out: ${tokens(turn.usage.output)}`,
        turn.usage.cacheRead ? `Cache: ${tokens(turn.usage.cacheRead)}` : "",
        typeof turn.usage.costUsd === "number" && turn.usage.costUsd > 0 ? `$${turn.usage.costUsd.toFixed(4)}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="group/turn flex w-full flex-col gap-3 self-start text-left">
      {showStream && (
        <AgentProcessStream
          steps={turn.steps}
          streaming={turn.streaming}
          activeInspectKey={activeInspectKey}
          onInspectFile={onInspectFile}
          onFailure={onFailure}
          turnId={turn.id}
          thoughtSec={thoughtSec}
          startedAt={turn.startedAt}
        />
      )}

      {shown && (
        <div className={cn("min-w-0", BODY)}>
          <MessageBody text={shown} />
          {turn.streaming && <span className="wide-caret ml-1 inline-block" aria-hidden="true" />}
        </div>
      )}

      {showFooter && (
        <div
          className={cn(
            "-ml-1.5 flex items-center gap-0.5 transition-opacity duration-100",
            last ? "opacity-100" : "opacity-0 group-hover/turn:opacity-100 focus-within:opacity-100",
          )}
        >
          {shown && (
            <TurnAction label={copied ? t("Copied") : t("Copy the answer")} onClick={() => void copy()}>
              {copyIcon}
            </TurnAction>
          )}
          {last && (
            <TurnAction label={t("Regenerate the answer")} onClick={onRegenerate}>
              <RefreshCw className="size-icon-sm" strokeWidth={1.5} />
            </TurnAction>
          )}
          {onUndoToHere && (
            <TurnAction label={t("Undo to this point")} onClick={() => void onUndoToHere(turn)} danger>
              <RotateCcw className="size-icon-sm" strokeWidth={1.5} />
            </TurnAction>
          )}
          <div className="ml-2 flex min-w-0 items-center gap-2 text-caption text-fg-faint">
            {thoughtSec > 0 &&
              (hasThinking ? (
                <button
                  type="button"
                  onClick={() => setShowReasoning((v) => !v)}
                  aria-expanded={showReasoning}
                  className="flex items-center gap-0.5 transition-colors hover:text-fg"
                >
                  <span>{t("Thought for {sec}s", { sec: thoughtSec })}</span>
                  <ChevronRight
                    className={cn("size-3 transition-transform duration-150", showReasoning && "rotate-90")}
                    strokeWidth={2}
                  />
                </button>
              ) : (
                <span>{t("Thought for {sec}s", { sec: thoughtSec })}</span>
              ))}
            {turn.usage && turn.usage.total > 0 && (
              <span title={usageTitle}>
                {t("{count} tokens", { count: tokens(turn.usage.total) })}
                {typeof turn.usage.costUsd === "number" && turn.usage.costUsd > 0
                  ? ` · $${turn.usage.costUsd.toFixed(3)}`
                  : ""}
              </span>
            )}
          </div>
        </div>
      )}

      {showReasoning && reasoning && (
        <div className="wide-enter-fade max-h-52 overflow-auto whitespace-pre-wrap border-l-2 border-line pl-3 text-meta text-fg-dim">
          {reasoning}
        </div>
      )}

      {turn.error && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-status-error/10 px-4 py-3 text-meta text-status-error">
          <div className="flex min-w-0 items-center gap-2">
            <AlertCircle className="size-icon shrink-0" strokeWidth={1.75} />
            <span>{t(turn.error)}</span>
          </div>
          {turn.errorKind === "auth" && (
            <button
              type="button"
              onClick={() => {
                const activeProvider = useAi.getState().config?.provider;
                if (activeProvider === "antigravity") {
                  void bridge.aiAntigravityLogin();
                } else if (activeProvider === "codex") {
                  void bridge.aiCodexLogin();
                } else {
                  void bridge.aiClaudeCodeLogin();
                }
              }}
              className="h-row-sm shrink-0 rounded-lg bg-raised px-3 text-meta font-medium text-fg transition-colors hover:bg-hover"
            >
              {t("Sign in")}
            </button>
          )}
        </div>
      )}
    </div>
  );
});
