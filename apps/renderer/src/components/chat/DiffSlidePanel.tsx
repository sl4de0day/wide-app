import { ExternalLink, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { highlightCode } from "@lezer/highlight";
import { codeHighlight, editorTheme } from "@/editor/theme";
import { languageFor } from "@/editor/languages";
import { useT } from "@/lib/i18n";
import { diffCounts, lineDiff } from "@/lib/lineDiff";
import { basename, cn } from "@/lib/utils";
import { useEditor } from "@/stores/editor";
import { FileTypeBadge } from "./FileTypeBadge";
import type { InspectorTarget } from "./steps";

export interface NumberedDiffRow {
  index: number;
  type: "same" | "add" | "del";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export const codeViewerTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--canvas)",
    color: "var(--fg)",
    fontSize: "var(--editor-font-size, 13px)",
    fontFamily: "var(--font-mono)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.65",
    overflow: "auto",
    height: "100%",
  },
  ".cm-content": {
    padding: "8px 0",
  },
  ".cm-line": {
    padding: "0 14px 0 8px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-gutters": {
    backgroundColor: "transparent",
    borderRight: "1px solid var(--line)",
    color: "var(--fg-faint)",
    userSelect: "none",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    minWidth: "36px",
    paddingRight: "10px",
    textAlign: "right",
    color: "var(--fg-faint)",
    fontSize: "10.5px",
  },
  ".cm-activeLine": {
    backgroundColor: "transparent",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "transparent",
  },
  "::selection": {
    backgroundColor: "var(--mono-600)",
    color: "var(--mono-50)",
  },
});

export function CodeViewer({
  code,
  path,
  initialLine,
}: {
  code: string;
  path: string;
  initialLine?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    let active = true;
    const mount = async () => {
      if (!containerRef.current) return;
      const grammar = await languageFor(path);
      if (!active || !containerRef.current) return;

      const extensions = [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineNumbers(),
        editorTheme,
        codeViewerTheme,
        syntaxHighlighting(codeHighlight),
      ];
      if (grammar) extensions.push(grammar);

      const state = EditorState.create({
        doc: code,
        extensions,
      });

      if (viewRef.current) {
        viewRef.current.setState(state);
      } else {
        const view = new EditorView({
          state,
          parent: containerRef.current,
        });
        viewRef.current = view;
      }

      if (viewRef.current && initialLine && initialLine > 1) {
        const view = viewRef.current;
        const line = Math.min(initialLine, view.state.doc.lines);
        const pos = view.state.doc.line(line).from;
        view.dispatch({
          effects: EditorView.scrollIntoView(pos, { y: "center" }),
        });
      }
    };

    void mount();
    return () => {
      active = false;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
      }
    };
  }, [path, code, initialLine]);

  return <div ref={containerRef} className="h-full w-full overflow-hidden bg-canvas" />;
}

export function tokenizeLines(code: string, grammar: any): { text: string; classes: string }[][] | null {
  if (!code) return [];
  const parser = grammar?.language?.parser;
  if (!parser) return null;
  try {
    const tree = parser.parse(code);
    const lines: { text: string; classes: string }[][] = [];
    let cur: { text: string; classes: string }[] = [];
    highlightCode(
      code,
      tree,
      codeHighlight,
      (text, classes) => {
        cur.push({ text, classes });
      },
      () => {
        lines.push(cur);
        cur = [];
      },
    );
    lines.push(cur);
    return lines;
  } catch {
    return null;
  }
}

export function DiffSlidePanel({
  target,
  onClose,
}: {
  target: InspectorTarget;
  onClose: () => void;
}) {
  const t = useT();
  const hasDiff = target.action !== "analyzed" && target.oldContent !== target.newContent;
  const [mode, setMode] = useState<"changes" | "full">(() => (hasDiff ? "changes" : "full"));
  const [grammar, setGrammar] = useState<any>(null);
  const firstChangeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void languageFor(target.path).then((g) => {
      if (active) setGrammar(g);
    });
    return () => {
      active = false;
    };
  }, [target.path]);

  useEffect(() => {
    setMode(target.action !== "analyzed" && target.oldContent !== target.newContent ? "changes" : "full");
  }, [target.key, target.action, target.oldContent, target.newContent]);

  const rawRows = useMemo(
    () =>
      target.action === "analyzed"
        ? target.newContent.split("\n").map((text) => ({ type: "same" as const, text }))
        : lineDiff(target.oldContent, target.newContent),
    [target.action, target.oldContent, target.newContent],
  );

  const { added, removed } = useMemo(() => diffCounts(rawRows), [rawRows]);

  const numberedRows = useMemo<NumberedDiffRow[]>(() => {
    let oldNo = 1;
    let newNo = 1;
    return rawRows.map((row, index) => {
      if (row.type === "same") {
        const item: NumberedDiffRow = { index, type: "same", text: row.text, oldLine: oldNo, newLine: newNo };
        oldNo += 1;
        newNo += 1;
        return item;
      }
      if (row.type === "del") {
        const item: NumberedDiffRow = { index, type: "del", text: row.text, oldLine: oldNo, newLine: null };
        oldNo += 1;
        return item;
      }
      const item: NumberedDiffRow = { index, type: "add", text: row.text, oldLine: null, newLine: newNo };
      newNo += 1;
      return item;
    });
  }, [rawRows]);

  const changedRows = useMemo(() => {
    return numberedRows.filter((r) => r.type !== "same");
  }, [numberedRows]);

  const firstChangedLine = useMemo(() => {
    for (const r of numberedRows) {
      if (r.type !== "same") return r.newLine ?? r.oldLine ?? 1;
    }
    return 1;
  }, [numberedRows]);

  const targetInitialLine = useMemo(() => {
    if (target.targetLine && target.targetLine > 0) return target.targetLine;
    return firstChangedLine;
  }, [target.targetLine, firstChangedLine]);

  useEffect(() => {
    if (mode === "changes") {
      const timer = setTimeout(() => {
        firstChangeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [target.key, mode]);

  const { newTokens, oldTokens } = useMemo(() => {
    if (mode !== "changes" || !hasDiff) return { newTokens: null, oldTokens: null };
    return {
      newTokens: tokenizeLines(target.newContent, grammar),
      oldTokens: target.oldContent ? tokenizeLines(target.oldContent, grammar) : null,
    };
  }, [mode, hasDiff, grammar, target.newContent, target.oldContent]);

  return (
    <div className="wide-enter-fade flex h-full w-[min(580px,56%)] shrink-0 flex-col border-l border-line bg-panel shadow-2xl">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line bg-canvas/70 px-3.5 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <FileTypeBadge fileName={target.path} />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-mono text-[12px] font-semibold text-fg" title={target.path}>
              {basename(target.path)}
            </span>
            <span className="truncate font-mono text-[10px] text-fg-faint" title={target.path}>
              {target.relativePath || target.path}
            </span>
          </div>
          {(added > 0 || removed > 0) && (
            <div className="flex shrink-0 items-center gap-1.5 pl-1">
              {added > 0 && (
                <span className="rounded bg-status-ok/12 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-status-ok">
                  +{added}
                </span>
              )}
              {removed > 0 && (
                <span className="rounded bg-status-error/12 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-status-error">
                  −{removed}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {hasDiff && (
            <div className="flex items-center rounded-lg border border-line bg-canvas p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setMode("changes")}
                className={cn(
                  "rounded-md px-2 py-0.5 transition-colors",
                  mode === "changes" ? "bg-accent text-bg font-medium" : "text-fg-faint hover:text-fg",
                )}
              >
                {t("Changes")}
              </button>
              <button
                type="button"
                onClick={() => setMode("full")}
                className={cn(
                  "rounded-md px-2 py-0.5 transition-colors",
                  mode === "full" ? "bg-accent text-bg font-medium" : "text-fg-faint hover:text-fg",
                )}
              >
                {t("Full file")}
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => void useEditor.getState().revealAt(target.path, targetInitialLine, 1)}
            title={t("Open in editor")}
            aria-label={t("Open in editor")}
            className="flex items-center gap-1 rounded-lg border border-line/70 px-2 py-1 text-[11px] text-fg-dim transition-colors hover:bg-hover hover:text-fg"
          >
            <ExternalLink className="size-3" strokeWidth={1.75} />
            <span className="hidden xl:inline">{t("Open in editor")}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            title={t("Close")}
            aria-label={t("Close")}
            className="flex size-7 items-center justify-center rounded-lg text-fg-faint transition-colors hover:bg-hover hover:text-fg"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </div>
      </div>

      {mode === "full" || !hasDiff ? (
        <div className="min-h-0 flex-1 overflow-hidden bg-canvas">
          <CodeViewer code={target.newContent} path={target.path} initialLine={targetInitialLine} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto bg-canvas font-mono text-[12px] leading-[1.65]">
          {changedRows.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-fg-faint text-[12px]">
              {t("No changes.")}
            </div>
          ) : (
            changedRows.map((row, idx) => {
              const prev = idx > 0 ? changedRows[idx - 1] : null;
              const hasGap =
                prev &&
                ((row.oldLine != null && prev.oldLine != null && Math.abs(row.oldLine - prev.oldLine) > 1) ||
                  (row.newLine != null && prev.newLine != null && Math.abs(row.newLine - prev.newLine) > 1));

              const lineNo = row.type === "del" ? row.oldLine : (row.newLine ?? row.oldLine);
              const tokens =
                row.type === "del"
                  ? oldTokens && row.oldLine ? oldTokens[row.oldLine - 1] : null
                  : newTokens && row.newLine ? newTokens[row.newLine - 1] : null;

              return (
                <div key={row.index} className="flex flex-col">
                  {hasGap && (
                    <div className="flex items-center justify-center gap-2 border-y border-line/40 bg-panel/70 px-3 py-1 font-mono text-[10px] text-fg-faint select-none">
                      <span>···</span>
                    </div>
                  )}
                  <div
                    ref={idx === 0 ? firstChangeRef : undefined}
                    className={cn(
                      "flex items-stretch border-l-[3px] px-2 py-0.5",
                      row.type === "add" && "border-status-ok/60 bg-status-ok/10 text-fg",
                      row.type === "del" && "border-status-error/60 bg-status-error/10 text-fg",
                    )}
                  >
                    <span
                      className={cn(
                        "w-10 shrink-0 select-none pr-2.5 text-right font-mono text-[10.5px] tabular-nums",
                        row.type === "add" ? "text-status-ok/75" : "text-status-error/75",
                      )}
                    >
                      {lineNo ?? ""}
                    </span>
                    <span
                      className={cn(
                        "w-4 shrink-0 select-none text-center font-bold text-[12px]",
                        row.type === "add" ? "text-status-ok" : "text-status-error",
                      )}
                    >
                      {row.type === "add" ? "+" : "−"}
                    </span>
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-all pl-1.5 font-mono text-[12px]">
                      {tokens && tokens.length > 0 ? (
                        tokens.map((tok, ti) => (
                          <span key={ti} className={tok.classes || undefined}>
                            {tok.text}
                          </span>
                        ))
                      ) : (
                        row.text || " "
                      )}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
