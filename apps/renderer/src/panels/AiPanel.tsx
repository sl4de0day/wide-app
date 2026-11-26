import { ChevronDown, ChevronRight, ListTree, MoreHorizontal, Pin, PinOff, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { MenuItem, MenuSeparator, PopoverMenu } from "@/components/Menu";
import { bridge, type AiSessionMeta } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { basename, cn } from "@/lib/utils";
import { AI_CHAT_PATH, useEditor } from "@/stores/editor";
import { useAi } from "@/stores/ai";
import { useLayout } from "@/stores/layout";
import { useWorkspace } from "@/stores/workspace";

type GroupKey = "pinned" | "today" | "yesterday" | "week" | "month" | "earlier";

const GROUP_LABELS: Record<GroupKey, string> = {
  pinned: "Pinned",
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  month: "This month",
  earlier: "Earlier",
};

function useWhen(): (at: number) => GroupKey {
  return useMemo(() => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const day = 86_400_000;
    return (at: number) => {
      if (!at) return "earlier";
      if (at >= midnight) return "today";
      if (at >= midnight - day) return "yesterday";
      if (at >= midnight - 7 * day) return "week";
      if (at >= midnight - 30 * day) return "month";
      return "earlier";
    };
  }, []);
}

const clock = (at: number) => {
  if (!at) return "";
  const when = new Date(at);
  return `${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
};

const PINNED_STORAGE_KEY = "wide.ai.pinned_sessions";
function getStoredPinned(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function openSession(session: AiSessionMeta, title: string, revealIndex?: number): void {
  if (session.root && session.root !== useWorkspace.getState().root) {
    useWorkspace.setState({
      root: session.root,
      rootName: basename(session.root),
      folders: [{ path: session.root, name: basename(session.root) }],
      workflowPath: null,
      workflowName: "",
      children: {},
      expanded: new Set(),
    });
    void bridge.openRecentProject(session.root);
  }
  useEditor.getState().openAiChat(session.id, title);
  if (revealIndex !== undefined) useAi.setState({ revealTurn: { session: session.id, index: revealIndex } });
}

function RowMenu({
  anchor,
  pinned,
  expanded,
  onClose,
  onTogglePin,
  onToggleQuestions,
  onDelete,
}: {
  anchor: HTMLElement;
  pinned: boolean;
  expanded: boolean;
  onClose: () => void;
  onTogglePin: () => void;
  onToggleQuestions: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);

  return (
    <PopoverMenu anchor={anchor} onClose={onClose}>
      <MenuItem
        icon={pinned ? <PinOff className="size-icon-sm" strokeWidth={1.5} /> : <Pin className="size-icon-sm" strokeWidth={1.5} />}
        label={pinned ? t("Unpin conversation") : t("Pin conversation")}
        onSelect={() => {
          onTogglePin();
          onClose();
        }}
      />
      <MenuItem
        icon={<ListTree className="size-icon-sm" strokeWidth={1.5} />}
        label={expanded ? t("Hide the questions") : t("Show the questions")}
        onSelect={() => {
          onToggleQuestions();
          onClose();
        }}
      />
      <MenuSeparator />
      <MenuItem
        icon={<Trash2 className="size-icon-sm" strokeWidth={1.5} />}
        label={confirming ? t("Delete for good") : t("Delete this conversation")}
        danger
        onSelect={() => {
          if (!confirming) {
            setConfirming(true);
            return;
          }
          onDelete();
          onClose();
        }}
      />
    </PopoverMenu>
  );
}

function SessionRow({
  session,
  open,
  pinned,
  onTogglePin,
}: {
  session: AiSessionMeta;
  open: boolean;
  pinned: boolean;
  onTogglePin: () => void;
}) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const title = session.title || t("New conversation");

  const turns = useAi((state) => (expanded ? state.chats[session.id]?.turns : undefined));
  const loaded = useAi((state) => (expanded ? state.chats[session.id]?.loaded === true : false));
  const questions = useMemo(() => (turns ?? []).filter((turn) => turn.role === "user"), [turns]);

  const toggleQuestions = () => {
    const next = !expanded;
    setExpanded(next);
    if (next) void useAi.getState().openChat(session.id);
  };

  const detail = [
    session.root ? basename(session.root) : "",
    clock(session.updatedAt),
    session.count > 0 ? t("{count} messages", { count: session.count }) : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="px-2">
      <div
        className={cn(
          "group relative flex h-row items-center rounded-lg transition-colors duration-100",
          open ? "bg-selected" : "hover:bg-hover",
          menuAnchor && !open && "bg-hover",
        )}
      >
        <button
          type="button"
          onClick={() => openSession(session, title)}
          title={detail ? `${title}\n${detail}` : title}
          className={cn(
            "flex h-full min-w-0 flex-1 items-center gap-2 rounded-lg pl-3 pr-9 text-left text-body",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            open ? "text-fg-bright" : "text-fg-muted group-hover:text-fg",
          )}
        >
          <span className="truncate">{title}</span>
        </button>
        <button
          type="button"
          onClick={(event) => setMenuAnchor(menuAnchor ? null : event.currentTarget)}
          title={t("More actions")}
          aria-label={t("More actions")}
          aria-haspopup="menu"
          aria-expanded={Boolean(menuAnchor)}
          className={cn(
            "absolute right-1.5 flex size-6 items-center justify-center rounded-md text-fg-dim transition-opacity duration-100 hover:bg-hover hover:text-fg",
            menuAnchor ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
          )}
        >
          <MoreHorizontal className="size-icon" strokeWidth={1.75} />
        </button>
      </div>

      {menuAnchor && (
        <RowMenu
          anchor={menuAnchor}
          pinned={pinned}
          expanded={expanded}
          onClose={() => setMenuAnchor(null)}
          onTogglePin={onTogglePin}
          onToggleQuestions={toggleQuestions}
          onDelete={() => void useAi.getState().deleteSession(session.id)}
        />
      )}

      {expanded && (
        <div className="wide-enter-fade mb-1 ml-3 border-l border-line pl-2">
          {!loaded ? (
            <p className="px-2 py-1 text-caption text-fg-faint">{t("Reading…")}</p>
          ) : questions.length === 0 ? (
            <p className="px-2 py-1 text-caption text-fg-faint">{t("Nothing asked yet.")}</p>
          ) : (
            questions.map((question, index) => (
              <button
                key={question.id}
                type="button"
                onClick={() => openSession(session, title, index)}
                title={question.text}
                className="flex h-row-sm w-full items-center rounded-md px-2 text-left transition-colors duration-100 hover:bg-hover"
              >
                <span className="min-w-0 flex-1 truncate text-meta text-fg-dim">{question.text}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const close = () => {
    onChange("");
    useLayout.getState().setSearchOpen(false);
  };

  return (
    <div className="wide-enter-fade mx-2 mb-2 flex h-row items-center gap-2 rounded-lg bg-hover px-3">
      <Search className="size-icon-sm shrink-0 text-fg-faint" strokeWidth={1.5} />
      <input
        ref={ref}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
        placeholder={t("Search conversations")}
        aria-label={t("Search conversations")}
        spellCheck={false}
        className="min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-faint"
      />
      <button
        type="button"
        onClick={close}
        title={t("Close search")}
        aria-label={t("Close search")}
        className="shrink-0 rounded-sm text-fg-faint transition-colors duration-100 hover:text-fg"
      >
        <X className="size-icon-sm" strokeWidth={1.75} />
      </button>
    </div>
  );
}

export function AiPanel() {
  const t = useT();
  const when = useWhen();
  const root = useWorkspace((state) => state.root);
  const sessions = useAi((state) => state.sessions);
  const activeId = useEditor((state) =>
    state.activePath?.startsWith(AI_CHAT_PATH) ? state.activePath.slice(AI_CHAT_PATH.length) : null,
  );
  const searchOpen = useLayout((state) => state.searchOpen);
  const collapsedGroups = useLayout((state) => state.collapsedGroups);
  const [query, setQuery] = useState("");
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => getStoredPinned());

  const togglePin = (id: string) => {
    setPinnedIds((current) => {
      const next = current.includes(id) ? current.filter((x) => x !== id) : [id, ...current];
      try {
        localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(next));
      } catch {
        return next;
      }
      return next;
    });
  };

  useEffect(() => {
    void useAi.getState().load();
  }, [root]);

  useEffect(() => {
    if (!searchOpen) setQuery("");
  }, [searchOpen]);

  const shown = useMemo(() => {
    const raw = query.trim().toLowerCase();
    if (!raw) return sessions;
    return sessions.filter((session) => session.title.toLowerCase().includes(raw));
  }, [sessions, query]);

  const groups = useMemo(() => {
    const out: { key: GroupKey; rows: AiSessionMeta[] }[] = [];
    const pinnedSet = new Set(pinnedIds);
    const pinnedRows = shown.filter((s) => pinnedSet.has(s.id));
    if (pinnedRows.length > 0) out.push({ key: "pinned", rows: pinnedRows });
    for (const session of shown.filter((s) => !pinnedSet.has(s.id))) {
      const key = when(session.updatedAt || session.createdAt);
      const last = out[out.length - 1];
      if (last && last.key === key) last.rows.push(session);
      else out.push({ key, rows: [session] });
    }
    return out;
  }, [shown, when, pinnedIds]);

  return (
    <div className="flex h-full flex-col">
      {searchOpen && <SearchField value={query} onChange={setQuery} />}

      <div className="min-h-0 flex-1 overflow-auto pb-2">
        {sessions.length === 0 ? (
          <p className="px-5 py-3 text-meta leading-relaxed text-fg-faint">
            {t("No conversations yet. Start one and it will be kept here.")}
          </p>
        ) : shown.length === 0 ? (
          <p className="px-5 py-3 text-meta text-fg-faint">{t("Nothing matched that.")}</p>
        ) : (
          groups.map((group) => {
            const collapsed = !query && collapsedGroups.includes(group.key);
            return (
              <section key={group.key} className="mb-1.5">
                <button
                  type="button"
                  onClick={() => useLayout.getState().toggleGroup(group.key)}
                  aria-expanded={!collapsed}
                  className="group/caption mx-2 flex h-row-sm items-center gap-1 rounded-md px-3 text-caption font-medium text-fg-faint transition-colors duration-100 hover:text-fg-dim"
                >
                  <span>{t(GROUP_LABELS[group.key])}</span>
                  {collapsed ? (
                    <ChevronRight className="size-3 opacity-70" strokeWidth={2} />
                  ) : (
                    <ChevronDown className="size-3 opacity-0 transition-opacity duration-100 group-hover/caption:opacity-70" strokeWidth={2} />
                  )}
                </button>
                {!collapsed &&
                  group.rows.map((session) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      open={session.id === activeId}
                      pinned={pinnedIds.includes(session.id)}
                      onTogglePin={() => togglePin(session.id)}
                    />
                  ))}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}
