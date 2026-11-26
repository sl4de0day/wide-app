import { ArrowDown, ArrowUp, AtSign, CornerDownRight, Mic, MicOff, Square, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelPicker, useModelLabel } from "@/components/ai/ModelPicker";
import { bridge } from "@/lib/bridge";
import { exportConversation } from "@/lib/chatExport";
import { useT } from "@/lib/i18n";
import { basename, cn } from "@/lib/utils";
import { toast } from "@/stores/toast";
import { AI_IMAGE_PROVIDERS, keptChatUiFor, useAi, type AiImage, type AiTurn } from "@/stores/ai";
import { useAiQueue, type QueuedMessage } from "@/stores/aiQueue";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { confirm } from "@/stores/confirm";
import { BrowserToggle, EmptyChat, InteractionModeToggle, PermissionBanner, PlusMenu, ToolModeToggle, useSpeechInput } from "./chat/ComposerControls";
import { DiffSlidePanel } from "./chat/DiffSlidePanel";
import { Turn } from "./chat/Turn";
import { BODY, QUESTION } from "./chat/shared";
import type { InspectorTarget } from "./chat/steps";

const NOTHING_ATTACHED: string[] = [];
const NO_IMAGES: AiImage[] = [];
const NO_QUEUE: QueuedMessage[] = [];

const SLASH_COMMANDS: { name: string; label: string; prompt: string; open?: boolean }[] = [
  { name: "explain", label: "Explain the current file", prompt: "Explain what the current file does, step by step. Read it first." },
  { name: "summarize", label: "Summarize the file", prompt: "Summarize the current file: its purpose, its key functions, and how it fits into the project. Read it first." },
  { name: "review", label: "Review for issues", prompt: "Review the current file for bugs, security issues, and code smells, ranked by severity. Read it first." },
  { name: "fix", label: "Find and fix bugs", prompt: "Review the current file for bugs and fix them. Read the file first, then apply the fix." },
  { name: "security", label: "Security audit", prompt: "Audit the current file for security vulnerabilities — injection, XSS, auth/access control, SSRF, path traversal, hard-coded secrets, unsafe deserialization. List each with severity and a fix. Read it first." },
  { name: "harden", label: "Harden the code", prompt: "Harden the current file against security vulnerabilities and apply the fixes. Read it first." },
  { name: "cwe", label: "Find CWE weaknesses", prompt: "Identify the CWE weaknesses present in the current file, cite the CWE id for each, and explain how to remediate them. Read it first." },
  { name: "threats", label: "Threat model", prompt: "Produce a short threat model for the current file: assets, entry points, trust boundaries, likely attacks, and mitigations. Read it first." },
  { name: "refactor", label: "Refactor for clarity", prompt: "Refactor the current file to be cleaner and simpler without changing its behavior. Read it first, then apply the change." },
  { name: "simplify", label: "Simplify the code", prompt: "Simplify the current file: remove dead code and redundancy while keeping the behavior identical. Read it first." },
  { name: "optimize", label: "Improve performance", prompt: "Find and fix performance problems in the current file without changing behavior. Read it first." },
  { name: "types", label: "Improve the types", prompt: "Add or tighten the TypeScript types in the current file, removing any 'any'. Read it first." },
  { name: "tests", label: "Write tests", prompt: "Write unit tests for the current file. Read it first and follow the project's existing test style." },
  { name: "doc", label: "Document the code", prompt: "Add clear documentation comments to the current file, matching the surrounding style. Read it first." },
  { name: "log", label: "Add logging", prompt: "Add helpful, non-noisy logging to the current file. Read it first." },
  { name: "example", label: "Show a usage example", prompt: "Show a concise usage example for the code in the current file. Read it first." },
  { name: "commit-message", label: "Write a commit message", prompt: "Write a concise, conventional commit message for the current git changes. Inspect the changes first." },
  { name: "name", label: "Suggest better names", prompt: "Suggest clearer names for the variables, functions, and types in the current file. Read it first." },
  { name: "plan", label: "Plan an implementation", prompt: "Propose a step-by-step implementation plan for: ", open: true },
  { name: "regex", label: "Write a regex", prompt: "Write a regular expression, with an explanation and examples, for: ", open: true },
  { name: "find", label: "Find in the project", prompt: "Search the project and tell me where: ", open: true },
  { name: "payload", label: "Suggest test payloads", prompt: "Suggest attack payloads (for authorized security testing) to probe: ", open: true },
  { name: "git", label: "Analyze git history", prompt: "Analyze the recent git log and diff for this project. Summarize what changed, why, and flag anything suspicious." },
  { name: "deps", label: "Audit dependencies", prompt: "Read the package.json (or equivalent) in this project and audit all dependencies: check for outdated packages, known vulnerabilities, and unnecessary bloat." },
  { name: "diagram", label: "Generate a diagram", prompt: "Generate a Mermaid diagram that visualizes the architecture or data flow of the current file or project. Read relevant files first." },
  { name: "translate", label: "Translate code to another language", prompt: "Translate the code in the current file to: ", open: true },
  { name: "perf", label: "Profile and optimize", prompt: "Analyze the current file for performance bottlenecks. Identify the top issues and propose concrete optimizations. Read it first." },
  { name: "commit", label: "Commit with AI message", prompt: "Inspect the current git diff/status, write a concise conventional commit message, and show it to me for approval before committing." },
  { name: "compact", label: "Summarize and compact history", prompt: "Summarize our conversation so far, highlighting the key decisions, tasks completed, and next steps." },
  { name: "todo", label: "Task breakdown checklist", prompt: "Break down the implementation into a structured checklist with '- [ ]' tasks for: ", open: true },
  { name: "pr", label: "PR / Code Review", prompt: "Perform a thorough Pull Request review of the current changes. Check for bugs, edge cases, performance, security, and maintainability. Inspect the diff first." },
  { name: "compare", label: "Compare architectures / models", prompt: "Compare alternative architectural approaches, tradeoffs, pros and cons for: ", open: true },
];

export function AiChatView({ id }: { id: string }) {
  const t = useT();
  const root = useWorkspace((state) => state.root);
  const chat = useAi((state) => state.chats[id]);
  const revealTurn = useAi((state) => state.revealTurn);
  const pendingDraft = useAi((state) => state.pendingDraft);
  const attachments = useAi((state) => state.attachments[id] ?? NOTHING_ATTACHED);
  const { ready } = useModelLabel();

  const store = keptChatUiFor(id);
  const [draft, setDraft] = useState(store.draft);

  const onSpeechResult = useCallback((text: string) => {
    setDraft((current) => current ? `${current} ${text}` : text);
  }, []);
  const { listening, toggle: toggleSpeech, supported: speechSupported } = useSpeechInput(onSpeechResult);

  const stuck = useRef(true);
  const [atBottom, setAtBottom] = useState(true);

  const [slashIndex, setSlashIndex] = useState(0);
  const [slashHidden, setSlashHidden] = useState(false);
  const slashMatches = useMemo(() => {
    const match = /^\/([\w-]*)$/.exec(draft);
    return match ? SLASH_COMMANDS.filter((command) => command.name.startsWith(match[1].toLowerCase())) : [];
  }, [draft]);
  const slashOpen = slashMatches.length > 0 && !slashHidden;

  useEffect(() => {
    void useAi.getState().load();
  }, []);
  useEffect(() => {
    setSlashIndex(0);
    setSlashHidden(false);
  }, [draft]);
  const pickSlash = (command: { prompt: string; open?: boolean }) => {
    setDraft(command.open ? command.prompt : `${command.prompt} `);
    composer.current?.focus();
  };

  const openInstructions = useCallback(async () => {
    if (!root) {
      toast.error(t("Open a folder first."));
      return;
    }
    const sep = root.includes("\\") ? "\\" : "/";
    const targetPath = `${root.replace(/[\\/]+$/, "")}${sep}.wide${sep}ai-instructions.md`;
    try {
      const reply = await bridge.aiInstructionsGet(root);
      const filePath = reply?.ok && reply.path && reply.exists ? reply.path : targetPath;

      if (!reply?.exists) {
        const read = await bridge.readFile(filePath).catch(() => null);
        if (!read || read.error) {
          await bridge.writeFile(filePath, "");
          void useWorkspace.getState().refresh();
        }
      }

      await useEditor.getState().openFile(filePath);
    } catch {
      toast.error(t("Project AI instructions could not be opened."));
    }
  }, [root, t]);

  const images = useAi((state) => state.images[id] ?? NO_IMAGES);
  const providerSupportsImages = useAi((state) => {
    const config = state.config;
    if (!config) return false;
    return AI_IMAGE_PROVIDERS.has(config.tab === "local" ? "local" : config.provider);
  });

  const addImage = useCallback(
    (name: string, mime: string, data: string) => {
      if (!providerSupportsImages) {
        toast.error(t("This model cannot read images. Switch to Claude Code, Antigravity, Codex, or a local vision model."));
        return;
      }
      if (!useAi.getState().attachImage(id, { name, mime, data })) {
        toast.error(t("That image is too large, or too many are attached."));
      }
    },
    [id, providerSupportsImages, t],
  );

  const pickImage = useCallback(async () => {
    const picked = await bridge.openFile();
    if (!picked) return;
    if (!/\.(png|jpe?g|webp|gif)$/i.test(picked.name)) {
      toast.error(t("Pick a PNG, JPEG, WebP or GIF image."));
      return;
    }
    const reply = await bridge.readBinary(picked.path);
    if (!reply.ok || !reply.base64) {
      toast.error(t(reply.error ?? "That image could not be read."));
      return;
    }
    const ext = picked.name.split(".").pop()?.toLowerCase() ?? "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    addImage(picked.name, mime, reply.base64);
  }, [addImage, t]);

  const onPasteImages = useCallback(
    (event: React.ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
      if (files.length === 0) return;
      event.preventDefault();
      for (const file of files) {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result ?? "");
          const comma = result.indexOf(",");
          if (comma < 0) return;
          addImage(file.name || t("Pasted image"), file.type, result.slice(comma + 1));
        };
        reader.readAsDataURL(file);
      }
    },
    [addImage, t],
  );

  const [mentionFiles, setMentionFiles] = useState<{ path: string; relativePath: string }[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  useEffect(() => {
    if (!root) {
      setMentionFiles([]);
      return;
    }
    void bridge.listProjectFiles(root).then((reply) => setMentionFiles(reply.files ?? []));
  }, [root]);
  const mentionQuery = useMemo(() => {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(draft);
    return match ? match[1] : null;
  }, [draft]);
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return mentionFiles.filter((file) => !q || file.relativePath.toLowerCase().includes(q)).slice(0, 8);
  }, [mentionQuery, mentionFiles]);
  const mentionOpen = mentionMatches.length > 0;
  useEffect(() => {
    setMentionIndex(0);
  }, [mentionQuery]);
  const pickMention = (file: { path: string }) => {
    useAi.getState().attach(id, file.path);
    setDraft((current) => current.replace(/(^|\s)@([^\s@]*)$/, "$1").replace(/\s+$/, (m) => (m.includes("\n") ? m : " ")));
    composer.current?.focus();
  };

  const scroller = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  const frame = useRef(0);

  const loaded = chat?.loaded ?? false;

  const contextTokens = useMemo(() => {
    const turns = chat?.turns ?? [];
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const usage = turns[i].usage;
      if (usage && usage.total > 0) return usage.input + usage.output;
    }
    return 0;
  }, [chat?.turns]);

  useEffect(() => {
    void useAi.getState().openChat(id);
  }, [id]);

  useEffect(() => {
    store.draft = draft;
  }, [draft, store]);

  useEffect(() => {
    if (!pendingDraft || pendingDraft.session !== id) return;
    const addition = pendingDraft.text;
    useAi.setState({ pendingDraft: null });
    setDraft((current) => (current.trim() ? `${current.replace(/\s+$/, "")}\n\n${addition}` : addition));
    composer.current?.focus();
  }, [pendingDraft, id]);

  useEffect(() => {
    const element = composer.current;
    if (!element) return;
    element.style.height = "auto";
    const chrome = element.offsetHeight - element.clientHeight;
    element.style.height = `${Math.min(element.scrollHeight + chrome, 240)}px`;
  }, [draft]);

  const restored = useRef("");
  useEffect(() => {
    if (!loaded || restored.current === id) return;
    const element = scroller.current;
    if (!element) return;
    restored.current = id;

    if (store.pinned || store.scroll <= 0) {
      element.scrollTop = element.scrollHeight;
      stuck.current = true;
    } else {
      element.scrollTop = store.scroll;
      stuck.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32;
    }
    setAtBottom(stuck.current);
    composer.current?.focus();
  }, [id, store, loaded]);

  const turns = chat?.turns;
  useEffect(() => {
    if (!stuck.current) {
      setAtBottom(false);
      return;
    }
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const element = scroller.current;
      if (element && stuck.current) element.scrollTop = element.scrollHeight;
    });
  }, [turns]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const toBottom = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    stuck.current = true;
    setAtBottom(true);
  }, []);

  const onScroll = () => {
    const element = scroller.current;
    if (!element) return;
    const near = element.scrollHeight - element.scrollTop - element.clientHeight < 32;

    if (near !== stuck.current) setAtBottom(near);
    stuck.current = near;
    store.scroll = element.scrollTop;
    store.pinned = near;
  };

  const landOn = useCallback((mark: HTMLElement) => {
    const element = scroller.current;
    if (!element) return;
    const max = element.scrollHeight - element.clientHeight;
    const top = Math.min(Math.max(0, mark.offsetTop - 12), max);
    if (top === element.scrollTop) return;
    element.scrollTo({ top, behavior: "smooth" });

    const near = max - top < 32;
    stuck.current = near;
    setAtBottom(near);
    store.pinned = near;
  }, [store]);

  const at = useRef<number | null>(null);

  const jump = useCallback(
    (direction: -1 | 1) => {
      const element = scroller.current;
      if (!element) return;
      const marks = Array.from(element.querySelectorAll<HTMLElement>(`[${QUESTION}]`));
      if (marks.length === 0) return;

      let next: number;
      if (at.current === null) {
        const here = element.scrollTop;
        const tops = marks.map((mark) => mark.offsetTop);
        const found =
          direction < 0
            ? tops.reduce((best, top, index) => (top < here - 8 ? index : best), -1)
            : tops.findIndex((top) => top > here + 8);
        if (found < 0) return;
        next = found;
      } else {
        next = at.current + direction;
        if (next < 0 || next >= marks.length) return;
      }
      at.current = next;
      landOn(marks[next]);
    },
    [landOn],
  );

  useEffect(() => {
    if (!revealTurn || revealTurn.session !== id || !loaded) return;
    const element = scroller.current;
    const marks = element ? Array.from(element.querySelectorAll<HTMLElement>(`[${QUESTION}]`)) : [];
    const mark = marks[revealTurn.index];
    if (mark) {
      at.current = revealTurn.index;
      landOn(mark);
    }
    useAi.setState({ revealTurn: null });
  }, [revealTurn, id, loaded, landOn]);

  const active = chat?.activeTurn ?? null;
  const stopping = chat?.stopping ?? false;
  const queued = useAiQueue((state) => state.queues[id] ?? NO_QUEUE);
  const queuePaused = useAiQueue((state) => Boolean(state.paused[id]));

  const stopTurn = () => {
    useAiQueue.getState().pause(id);
    void useAi.getState().stop(id);
  };

  const enqueue = () => {
    const text = draft.trim();
    if (!text) return;
    useAiQueue.getState().enqueue(id, text);
    setDraft("");
    composer.current?.focus();
  };
  const error = chat?.error ?? "";

  useEffect(() => {
    if (active) return;
    const here = document.activeElement;
    if (here instanceof HTMLElement && here.dataset.stop === "") composer.current?.focus();
  }, [active]);

  const report = useCallback(
    (message: string) =>
      useAi.setState((state) =>
        state.chats[id] ? { chats: { ...state.chats, [id]: { ...state.chats[id], error: message } } } : state,
      ),
    [id],
  );

  const submit = () => {
    const text = draft.trim();
    if (!text || !ready || active || !loaded) return;
    useAiQueue.getState().resume(id);
    setDraft("");
    stuck.current = true;
    setAtBottom(true);
    void useAi.getState().ask(id, text);
    composer.current?.focus();
  };

  const [inspectedFile, setInspectedFile] = useState<InspectorTarget | null>(null);

  const handleInspectFile = useCallback((target: InspectorTarget) => {
    setInspectedFile((current) => (current?.key === target.key ? null : target));
  }, []);

  const handleRegenerate = useCallback(() => void useAi.getState().regenerate(id), [id]);

  const handleEditTurn = useCallback((text: string) => {
    setDraft(text);
    composer.current?.focus();
  }, []);

  const handleUndoToTurn = useCallback(
    async (turn: AiTurn) => {
      const ok = await confirm({
        title: t("Undo to this point?"),
        message: t("This will revert all file modifications and delete subsequent messages."),
        confirmLabel: t("Undo"),
        danger: true,
      });
      if (!ok) return;

      if (turn.role === "user" && turn.text) {
        setDraft(turn.text);
        composer.current?.focus();
      }

      await useAi.getState().undoToTurn(id, turn.id);
    },
    [id, t],
  );

  return (
    <div
      tabIndex={-1}
      className="wide-enter-fade flex h-full bg-canvas outline-none overflow-hidden"
      onWheel={() => {
        at.current = null;
      }}
      onPointerDown={() => {
        at.current = null;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && active && !stopping) {
          event.preventDefault();
          stopTurn();
          return;
        }
        if (event.key === "Escape" && !active && inspectedFile) {
          event.preventDefault();
          setInspectedFile(null);
          return;
        }
        if (!event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.key === "ArrowUp") {
          event.preventDefault();
          jump(-1);
        } else if (event.key === "ArrowDown") {
          event.preventDefault();
          jump(1);
        }
      }}
    >
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <div ref={scroller} onScroll={onScroll} className="h-full overflow-auto">
            <div className="mx-auto flex w-full max-w-reading flex-col gap-7 px-6 pb-10 pt-8">
              {!chat?.loaded ? null : chat.turns.length === 0 ? (
                <EmptyChat />
              ) : (
                chat.turns.map((turn, index) => (
                  <Turn
                    key={turn.id}
                    turn={turn}
                    divider={turn.role === "user" && index > 0}
                    last={turn.role === "assistant" && index === chat.turns.length - 1 && !active}
                    activeInspectKey={inspectedFile?.key ?? ""}
                    onInspectFile={handleInspectFile}
                    onFailure={report}
                    onRegenerate={handleRegenerate}
                    onEdit={turn.role === "user" && !active ? handleEditTurn : undefined}
                    onUndoToHere={!active ? handleUndoToTurn : undefined}
                  />
                ))
              )}
            </div>
          </div>

          {!atBottom && (
            <button
              type="button"
              onClick={toBottom}
              className="wide-enter-fade absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-raised px-3.5 py-1.5 text-meta text-fg-dim shadow-xl transition-colors duration-100 hover:text-fg"
            >
              <ArrowDown className="size-3" strokeWidth={2} />
              {active ? t("New text") : t("Latest")}
            </button>
          )}
        </div>

        {error && (
          <button
            type="button"
            onClick={() =>
              useAi.setState((state) => ({
                chats: state.chats[id]
                  ? { ...state.chats, [id]: { ...state.chats[id], error: "" } }
                  : state.chats,
              }))
            }
            className="wide-enter-fade mx-auto mb-1 w-[calc(100%-3rem)] max-w-reading shrink-0 rounded-xl bg-status-error/10 px-4 py-2.5 text-left text-meta text-status-error transition-colors hover:bg-status-error/15"
          >
            {t(error)}
          </button>
        )}

        <PermissionBanner sessionId={id} activeTurn={active} />

        <div className="shrink-0 px-6 pb-5 pt-2">
          <div className="relative mx-auto w-full max-w-reading">
            {mentionOpen && (
              <div className="absolute bottom-full left-0 z-50 mb-2 max-h-64 w-[min(380px,90%)] overflow-auto rounded-xl border border-line bg-raised p-1 shadow-2xl">
                {mentionMatches.map((file, index) => (
                  <button
                    key={file.path}
                    type="button"
                    ref={index === mentionIndex ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                    onMouseEnter={() => setMentionIndex(index)}
                    onClick={() => pickMention(file)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors duration-100",
                      index === mentionIndex ? "bg-hover" : "hover:bg-hover",
                    )}
                    title={file.relativePath}
                  >
                    <AtSign className="size-3.5 shrink-0 text-accent" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate text-meta text-fg">{file.relativePath}</span>
                  </button>
                ))}
              </div>
            )}
            {slashOpen && (
              <div className="absolute bottom-full left-0 z-50 mb-2 max-h-64 w-[min(380px,90%)] overflow-auto rounded-xl border border-line bg-raised p-1 shadow-2xl">
                {slashMatches.map((command, index) => (
                  <button
                    key={command.name}
                    type="button"
                    ref={index === slashIndex ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                    onMouseEnter={() => setSlashIndex(index)}
                    onClick={() => pickSlash(command)}
                    className={cn(
                      "flex w-full items-baseline gap-2.5 rounded-lg px-3 py-2 text-left transition-colors duration-100",
                      index === slashIndex ? "bg-hover" : "hover:bg-hover",
                    )}
                  >
                    <span className="shrink-0 font-mono text-caption font-semibold text-accent">/{command.name}</span>
                    <span className="min-w-0 flex-1 truncate text-meta text-fg-dim">{t(command.label)}</span>
                  </button>
                ))}
              </div>
            )}

            {!active && ready && loaded && (chat?.promptSuggestions?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1.5 pb-2">
                {(chat?.promptSuggestions ?? []).slice(0, 3).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      stuck.current = true;
                      setAtBottom(true);
                      void useAi.getState().ask(id, suggestion);
                      composer.current?.focus();
                    }}
                    className="rounded-full border border-line px-3 py-1 text-meta text-fg-dim transition-colors hover:bg-hover hover:text-fg"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}

            {queued.length > 0 && (
              <div className="wide-enter-fade mb-2 flex flex-col gap-1 rounded-xl border border-line bg-panel p-1.5">
                <div className="flex items-center justify-between gap-2 px-2 pb-0.5 pt-0.5 text-caption text-fg-faint">
                  <span>
                    {queuePaused
                      ? t("Queue paused · {count}", { count: queued.length })
                      : t("Queued · {count}", { count: queued.length })}
                  </span>
                  <button
                    type="button"
                    onClick={() => useAiQueue.getState().clear(id)}
                    className="rounded px-1 transition-colors hover:text-fg"
                  >
                    {t("Clear")}
                  </button>
                </div>
                {queued.map((item, index) => (
                  <div key={item.id} className="group/queued flex min-h-8 items-center gap-2 rounded-lg px-2 hover:bg-hover">
                    <CornerDownRight className="size-icon-sm shrink-0 text-fg-faint" strokeWidth={1.75} />
                    <span className="min-w-0 flex-1 truncate text-meta text-fg-muted" title={item.text}>
                      {item.text}
                    </span>
                    {queuePaused && index === 0 && !active && (
                      <button
                        type="button"
                        onClick={() => useAiQueue.getState().sendNow(id, item.id)}
                        className="h-6 shrink-0 rounded-md px-2 text-caption font-medium text-fg-dim transition-colors hover:bg-hover hover:text-fg"
                      >
                        {t("Send now")}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(item.text);
                        useAiQueue.getState().remove(id, item.id);
                        composer.current?.focus();
                      }}
                      title={t("Edit")}
                      aria-label={t("Edit")}
                      className="h-6 shrink-0 rounded-md px-2 text-caption text-fg-faint opacity-0 transition-opacity hover:text-fg group-hover/queued:opacity-100 focus-visible:opacity-100"
                    >
                      {t("Edit")}
                    </button>
                    <button
                      type="button"
                      onClick={() => useAiQueue.getState().remove(id, item.id)}
                      title={t("Remove")}
                      aria-label={t("Remove")}
                      className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-faint transition-colors hover:bg-hover hover:text-fg"
                    >
                      <X className="size-icon-sm" strokeWidth={1.75} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="relative rounded-2xl border border-line bg-raised px-2 py-2 shadow-lg transition-colors focus-within:border-line-strong">
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-2 pb-2 pt-1">
                  {attachments.map((path) => (
                    <span key={path} className="flex h-6 items-center gap-1 rounded-md bg-hover px-2 text-caption text-fg-dim" title={path}>
                      <AtSign className="size-3 shrink-0 text-fg-dim" strokeWidth={1.75} />
                      <span className="max-w-[160px] truncate">{basename(path)}</span>
                      <button type="button" onClick={() => useAi.getState().detach(id, path)} className="text-fg-faint hover:text-fg ml-0.5" aria-label={t("Remove")}>
                        <X className="size-3" strokeWidth={2} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {images.length > 0 && (
                <div className="flex flex-wrap gap-2 px-2 pb-2 pt-1">
                  {images.map((image) => (
                    <span key={image.id} className="group/img relative block" title={image.name}>
                      <img
                        src={`data:${image.mime};base64,${image.data}`}
                        alt={image.name}
                        className="block size-14 rounded-lg object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => useAi.getState().detachImage(id, image.id)}
                        aria-label={t("Remove")}
                        className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border border-line bg-panel text-fg-faint opacity-0 transition-opacity duration-100 hover:text-fg group-hover/img:opacity-100 shadow"
                      >
                        <X className="size-2.5" strokeWidth={2.5} />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="flex items-end gap-1">
                <PlusMenu
                  session={id}
                  onInsertMention={() => {
                    setDraft((cur) => (cur ? cur.endsWith(" ") ? cur + "@" : cur + " @" : "@"));
                    composer.current?.focus();
                  }}
                  onPickImage={() => void pickImage()}
                  onExport={(chat?.turns?.length ?? 0) > 0 ? () => void exportConversation() : undefined}
                  onOpenInstructions={root ? () => void openInstructions() : undefined}
                  onCompact={contextTokens > 0 ? () => void useAi.getState().compactChat(id) : undefined}
                />
                <textarea
                  ref={composer}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onPaste={onPasteImages}
                  onKeyDown={(event) => {
                    if (mentionOpen) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setMentionIndex((index) => (index + 1) % mentionMatches.length);
                        return;
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setMentionIndex((index) => (index - 1 + mentionMatches.length) % mentionMatches.length);
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setDraft((current) => current.replace(/(^|\s)@([^\s@]*)$/, "$1"));
                        return;
                      }
                      if ((event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) || event.key === "Tab") {
                        event.preventDefault();
                        const picked = mentionMatches[mentionIndex] ?? mentionMatches[0];
                        if (picked) pickMention(picked);
                        return;
                      }
                    }
                    if (slashOpen) {
                      if (event.key === "ArrowDown") {
                        event.preventDefault();
                        setSlashIndex((index) => (index + 1) % slashMatches.length);
                        return;
                      }
                      if (event.key === "ArrowUp") {
                        event.preventDefault();
                        setSlashIndex((index) => (index - 1 + slashMatches.length) % slashMatches.length);
                        return;
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        setSlashHidden(true);
                        return;
                      }
                      if ((event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) || event.key === "Tab") {
                        event.preventDefault();
                        const picked = slashMatches[slashIndex] ?? slashMatches[0];
                        if (picked) pickSlash(picked);
                        return;
                      }
                    }
                    if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      if (active) enqueue();
                      else submit();
                      return;
                    }
                    if (event.key !== "Enter" || event.shiftKey) return;
                    if (event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    if (active) return;
                    submit();
                  }}
                  placeholder={!ready ? t("Not set up yet") : active ? t("Press Ctrl+Enter to queue a message") : t("Ask anything…")}
                  rows={1}
                  spellCheck={false}
                  disabled={!ready}
                  className={cn(
                    "max-h-60 min-h-8 min-w-0 flex-1 resize-none overflow-auto bg-transparent px-1 py-1 outline-none",
                    "disabled:opacity-50 placeholder:text-fg-faint",
                    BODY,
                  )}
                />
                {speechSupported && (
                  <button
                    type="button"
                    onClick={toggleSpeech}
                    title={listening ? t("Stop listening") : t("Speak your message")}
                    aria-label={listening ? t("Stop listening") : t("Speak your message")}
                    aria-pressed={listening}
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full text-fg-dim transition-colors hover:bg-hover hover:text-fg",
                      listening && "bg-accent/15 text-accent hover:bg-accent/25 hover:text-accent",
                    )}
                  >
                    {listening ? <MicOff className="size-icon" strokeWidth={1.75} /> : <Mic className="size-icon" strokeWidth={1.75} />}
                  </button>
                )}
                {active ? (
                  <button
                    type="button"
                    onClick={stopTurn}
                    title={t("Stop")}
                    aria-label={t("Stop")}
                    disabled={stopping}
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-full bg-fg-bright text-canvas transition-opacity hover:opacity-85",
                      stopping && "opacity-50",
                    )}
                  >
                    <Square className="size-3 fill-current" strokeWidth={0} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!draft.trim() || !ready || !loaded}
                    title={t("Send")}
                    aria-label={t("Send")}
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fg-bright text-canvas transition-opacity hover:opacity-85 disabled:pointer-events-none disabled:bg-hover disabled:text-fg-faint"
                  >
                    <ArrowUp className="size-icon" strokeWidth={2.25} />
                  </button>
                )}
              </div>
            </div>

            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 px-1">
              <div className="flex min-w-0 items-center gap-0.5">
                <ModelPicker className="h-7 rounded-md px-2 text-meta font-normal text-fg-dim hover:bg-hover hover:text-fg" />
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <ToolModeToggle />
                <InteractionModeToggle />
                <BrowserToggle />
              </div>
            </div>
          </div>
        </div>
      </div>

      {inspectedFile && (
        <DiffSlidePanel target={inspectedFile} onClose={() => setInspectedFile(null)} />
      )}
    </div>
  );
}
