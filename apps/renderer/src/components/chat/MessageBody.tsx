import { Check, Copy, Terminal } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { syntaxHighlighting } from "@codemirror/language";
import { codeHighlight } from "@/editor/theme";
import { languageFor } from "@/editor/languages";
import { splitChatSegments, renderProse } from "@/lib/chatMarkdown";
import { useT } from "@/lib/i18n";
import { copyText } from "@/lib/utils";
import { toast } from "@/stores/toast";
import { useRun } from "@/stores/run";
import { useCommandPalette } from "@/stores/commands";

export function normalizeLangToExt(lang: string): string {
  const l = (lang || "").trim().toLowerCase();
  switch (l) {
    case "javascript":
    case "js":
      return "js";
    case "typescript":
    case "ts":
      return "ts";
    case "tsx":
      return "tsx";
    case "jsx":
      return "jsx";
    case "html":
      return "html";
    case "css":
      return "css";
    case "scss":
    case "sass":
      return "scss";
    case "json":
    case "jsonc":
      return "json";
    case "python":
    case "py":
      return "py";
    case "rust":
    case "rs":
      return "rs";
    case "go":
    case "golang":
      return "go";
    case "sql":
      return "sql";
    case "bash":
    case "sh":
    case "shell":
    case "zsh":
      return "sh";
    case "powershell":
    case "ps1":
    case "pwsh":
      return "ps1";
    case "yaml":
    case "yml":
      return "yaml";
    case "toml":
      return "toml";
    case "markdown":
    case "md":
      return "md";
    case "dockerfile":
    case "docker":
      return "dockerfile";
    case "c":
    case "cpp":
    case "c++":
      return "c";
    case "java":
      return "java";
    case "php":
      return "php";
    case "ruby":
    case "rb":
      return "rb";
    default:
      return l || "txt";
  }
}

export const codeBlockTheme = EditorView.theme({
  "&": {
    fontSize: "12px",
    fontFamily: "var(--font-mono)",
    backgroundColor: "transparent",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
    overflow: "auto",
    maxHeight: "440px",
  },
  ".cm-content": {
    padding: "8px 0",
  },
  ".cm-line": {
    padding: "0 12px 0 8px",
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
    minWidth: "28px",
    paddingRight: "8px",
    textAlign: "right",
    color: "var(--fg-faint)",
    fontSize: "11px",
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

export const CodeBlock = memo(function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);

  const isShell = useMemo(() => /^(bash|sh|shell|zsh|powershell|ps1|pwsh|cmd|bat)$/i.test(lang), [lang]);

  const copy = async () => {
    if (await copyText(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const runInTerminal = () => {
    useCommandPalette.getState().runById("view.terminal");
    useRun.getState().send(code.trim());
    toast.success(t("Running in terminal."));
  };

  const codeRef = useRef(code);
  codeRef.current = code;

  useEffect(() => {
    let active = true;
    const mount = async () => {
      if (!containerRef.current) return;
      const ext = normalizeLangToExt(lang);
      const grammar = await languageFor(`snippet.${ext}`);
      if (!active || !containerRef.current) return;

      const extensions = [
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        lineNumbers(),
        codeBlockTheme,
        syntaxHighlighting(codeHighlight),
      ];
      if (grammar) extensions.push(grammar);

      const state = EditorState.create({
        doc: codeRef.current,
        extensions,
      });

      if (viewRef.current) {
        viewRef.current.setState(state);
      } else {
        viewRef.current = new EditorView({
          state,
          parent: containerRef.current,
        });
      }
    };

    void mount();
    return () => {
      active = false;
    };
  }, [lang]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const length = view.state.doc.length;
    if (code.length > length && view.state.sliceDoc(0, length) === code.slice(0, length)) {
      view.dispatch({ changes: { from: length, insert: code.slice(length) } });
      return;
    }
    const current = view.state.doc.toString();
    if (current !== code) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: code },
      });
    }
  }, [code]);

  useEffect(() => {
    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, []);

  const iconBtn = "flex items-center gap-1 rounded-md px-1.5 py-1 text-fg-faint transition-colors duration-100 hover:bg-hover hover:text-fg text-[11px]";
  const lineCount = code.split("\n").length;

  return (
    <div className="my-3 overflow-hidden rounded-xl border border-line bg-canvas shadow-sm">
      <div className="flex items-center justify-between border-b border-line bg-panel/80 px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="rounded bg-canvas/80 px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider text-accent border border-line/60">
            {lang || t("Code")}
          </span>
          <span className="text-[11px] text-fg-faint">
            {t("{count} lines", { count: lineCount })}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {isShell && (
            <button
              type="button"
              onClick={runInTerminal}
              title={t("Run in terminal")}
              aria-label={t("Run in terminal")}
              className={iconBtn}
            >
              <Terminal className="size-3.5" strokeWidth={1.75} />
              <span className="hidden sm:inline">{t("Run")}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void copy()}
            title={copied ? t("Copied") : t("Copy")}
            aria-label={t("Copy")}
            className={iconBtn}
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-accent" strokeWidth={2} />
                <span className="text-accent text-[11px]">{t("Copied")}</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" strokeWidth={1.75} />
                <span className="hidden sm:inline">{t("Copy")}</span>
              </>
            )}
          </button>
        </div>
      </div>
      <div ref={containerRef} className="overflow-hidden bg-canvas" />
    </div>
  );
});

const ProseBlock = memo(function ProseBlock({ text }: { text: string }) {
  return <div className="flex flex-col gap-2">{renderProse(text)}</div>;
});

export function MessageBody({ text }: { text: string }) {
  const segments = useMemo(() => splitChatSegments(text), [text]);
  return (
    <div className="flex flex-col">
      {segments.map((seg, i) =>
        seg.type === "code" ? (
          <CodeBlock key={i} lang={seg.lang} code={seg.code} />
        ) : (
          <ProseBlock key={i} text={seg.text} />
        ),
      )}
    </div>
  );
}
