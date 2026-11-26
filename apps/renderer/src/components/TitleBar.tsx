import { ChevronDown, Copy, ExternalLink, FileDown, GitBranch, Globe, PanelLeft, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import logo from "@/assets/wide-logo.png";
import { MenuItem, MenuSeparator, PopoverMenu } from "@/components/Menu";
import { bridge } from "@/lib/bridge";
import { copyConversation, exportConversation } from "@/lib/chatExport";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAi } from "@/stores/ai";
import { useAiBrowser } from "@/stores/aiBrowser";
import { useCodeberg } from "@/stores/codeberg";
import { useExtensions } from "@/stores/extensions";
import { toast } from "@/stores/toast";
import { AI_CHAT_PATH, useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";
import { useRecentProjects } from "@/stores/recentProjects";
import { useWorkspace } from "@/stores/workspace";

function IconButton({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "no-drag flex size-8 shrink-0 items-center justify-center rounded-md transition-colors duration-100",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-selected text-fg-bright" : "text-fg-dim hover:bg-hover hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function ConversationMenu({ id, anchor, onClose }: { id: string; anchor: HTMLElement; onClose: () => void }) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);

  return (
    <PopoverMenu anchor={anchor} onClose={onClose} align="start" width={288}>
      <MenuItem
        icon={<Copy className="size-icon-sm" strokeWidth={1.5} />}
        label={t("Copy the conversation")}
        onSelect={() => {
          onClose();
          void copyConversation();
        }}
      />
      <MenuItem
        icon={<FileDown className="size-icon-sm" strokeWidth={1.5} />}
        label={t("Export the conversation to Markdown")}
        onSelect={() => {
          onClose();
          void exportConversation();
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
          onClose();
          void useAi.getState().deleteSession(id);
        }}
      />
    </PopoverMenu>
  );
}

export function TitleBar() {
  const t = useT();
  const rootName = useWorkspace((state) => state.rootName);
  const workflowName = useWorkspace((state) => state.workflowName);
  const projectLabel = workflowName || rootName;
  const activeTab = useEditor((state) => state.tabs.find((tab) => tab.path === state.activePath));
  const activeAiChatId = activeTab?.kind === "ai-chat" ? activeTab.path.slice(AI_CHAT_PATH.length) : null;
  const currentChatId =
    activeAiChatId ||
    useEditor.getState().tabs.find((tab) => tab.kind === "ai-chat")?.path.slice(AI_CHAT_PATH.length) ||
    null;
  const currentSessionTitle = useAi((state) => (currentChatId ? state.sessions.find((s) => s.id === currentChatId)?.title : null));
  const activeSessionTitle = useAi((state) =>
    activeAiChatId ? state.sessions.find((s) => s.id === activeAiChatId)?.title : null,
  );
  const canOpenIde = Boolean(currentChatId || rootName);
  const sidebarCollapsed = useLayout((state) => state.sidebarCollapsed);
  const browserActive = useAiBrowser((state) => state.active);
  const browserOpen = useAiBrowser((state) => state.drawerOpen);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const hasCodeberg = useExtensions((state) => state.installed.has("codeberg"));
  const branch = useCodeberg((state) => (state.status?.repository ? (state.status.branch?.name ?? "") : ""));

  const chatTitle = activeAiChatId ? activeSessionTitle || activeTab?.name || t("New conversation") : null;

  const openIde = async () => {
    const currentChat = currentChatId ? useAi.getState().chats[currentChatId] : null;
    const currentRoot = useWorkspace.getState().root || currentChat?.root || "";
    const currentTitle = activeTab?.name || currentSessionTitle || t("New conversation");
    if (currentChatId) {
      if (currentChat?.history?.length) {
        await bridge.aiSaveSession(currentChatId, currentRoot, currentChat.history);
      }
      await bridge.aiActiveChat({ id: currentChatId, root: currentRoot, title: currentTitle });
    }
    const res = await bridge.launchIde({ projectPath: currentRoot, chatId: currentChatId || undefined });
    if (res && res.ok) toast.success(t("Wide IDE opened"));
    else toast.error(res?.error || t("Failed to open Wide IDE"));
  };

  return (
    <header
      className="drag-region flex shrink-0 items-center gap-1 bg-chrome pr-[140px]"
      style={{ height: "var(--h-titlebar)" }}
    >
      <div
        className={cn("flex min-w-0 shrink-0 items-center gap-1 pr-2", !sidebarCollapsed && "w-sidebar")}
      >
        <span className="flex shrink-0 items-center justify-center" style={{ width: "var(--w-activitybar)" }}>
          <img
            src={logo}
            alt=""
            width={44}
            height={44}
            aria-hidden="true"
            draggable={false}
            className="size-11 shrink-0 select-none"
          />
        </span>

        <IconButton
          title={sidebarCollapsed ? t("Show sidebar") : t("Hide sidebar")}
          onClick={() => useLayout.getState().toggleSidebar()}
        >
          <PanelLeft className="size-icon-lg" strokeWidth={1.5} />
        </IconButton>

        <button
          type="button"
          title={t("Project")}
          onClick={() => useRecentProjects.getState().open()}
          className={cn(
            "no-drag flex h-8 min-w-0 items-center gap-1.5 rounded-md px-2 text-meta text-fg-dim",
            "transition-colors duration-100 hover:bg-hover hover:text-fg",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        >
          <span className="truncate font-medium">{projectLabel || t("Open project")}</span>
          <ChevronDown className="size-3 shrink-0" strokeWidth={2} />
        </button>

        {hasCodeberg && branch && (
          <span title={t("Git branch")} className="wide-enter-fade flex min-w-0 shrink items-center gap-1 text-fg-faint">
            <GitBranch className="size-3 shrink-0" strokeWidth={1.75} />
            <span className="truncate text-caption">{branch}</span>
          </span>
        )}
      </div>

      {activeAiChatId && chatTitle && (
        <button
          type="button"
          onClick={(event) => setMenuAnchor(menuAnchor ? null : event.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={Boolean(menuAnchor)}
          title={chatTitle}
          className={cn(
            "no-drag flex h-8 min-w-0 max-w-[480px] items-center gap-1.5 rounded-md px-2.5 text-body text-fg",
            "transition-colors duration-100 hover:bg-hover",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            menuAnchor && "bg-hover",
          )}
        >
          <span className="truncate">{chatTitle}</span>
          <ChevronDown className="size-icon-sm shrink-0 text-fg-dim" strokeWidth={1.75} />
        </button>
      )}

      {menuAnchor && activeAiChatId && (
        <ConversationMenu id={activeAiChatId} anchor={menuAnchor} onClose={() => setMenuAnchor(null)} />
      )}

      <div className="min-w-4 flex-1" />

      {canOpenIde && (
        <button
          type="button"
          title={t("Open in Wide IDE")}
          onClick={() => void openIde()}
          className={cn(
            "no-drag flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-meta text-fg-dim",
            "transition-colors duration-100 hover:bg-hover hover:text-fg",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          )}
        >
          <ExternalLink className="size-icon-sm" strokeWidth={1.5} />
          <span>{t("Open in Wide IDE")}</span>
        </button>
      )}

      {browserActive && (
        <IconButton
          title={browserOpen ? t("Hide the AI browser") : t("Show the AI browser")}
          active={browserOpen}
          onClick={() => useAiBrowser.getState().toggleDrawer()}
        >
          <Globe className="size-icon-lg" strokeWidth={1.5} />
        </IconButton>
      )}
    </header>
  );
}
