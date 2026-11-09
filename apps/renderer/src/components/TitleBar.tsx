import { ChevronDown, ExternalLink, GitBranch } from "lucide-react";
import { type ReactNode } from "react";

import logo from "@/assets/wide-logo.png";
import { bridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAi } from "@/stores/ai";
import { useCodeberg } from "@/stores/codeberg";
import { useExtensions } from "@/stores/extensions";
import { toast } from "@/stores/toast";
import { AI_CHAT_PATH, useEditor } from "@/stores/editor";
import { useRecentProjects } from "@/stores/recentProjects";
import { useWorkspace } from "@/stores/workspace";

function TitleButton({
  title,
  onClick,
  active,
  children,
}: {
  title: string;
  onClick?: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cn(
        "no-drag flex h-6.5 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-fg-dim",
        "transition-colors duration-150 hover:bg-hover hover:text-fg",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active && "bg-hover text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function TitleBar() {
  const rootName = useWorkspace((state) => state.rootName);
  const workflowName = useWorkspace((state) => state.workflowName);
  const projectLabel = workflowName || rootName;
  const activeTab = useEditor((state) => state.tabs.find((tab) => tab.path === state.activePath));
  const activeAiChatId = activeTab?.kind === "ai-chat" ? activeTab.path.slice(AI_CHAT_PATH.length) : null;
  const activeAiChat = useAi((state) => (activeAiChatId ? state.chats[activeAiChatId] : null));
  const hasActiveChat = Boolean(activeTab?.kind === "ai-chat" && activeAiChatId);

  const hasCodeberg = useExtensions((state) => state.installed.has("codeberg"));
  const branch = useCodeberg((state) =>
    state.status?.repository ? (state.status.branch?.name ?? "") : "",
  );

  const t = useT();

  return (
    <header
      className={cn(
        "drag-region flex shrink-0 items-center gap-1.5 border-b border-line/40 bg-chrome pr-[140px]",
      )}
      style={{ height: "var(--h-titlebar)" }}
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

      <TitleButton title={t("Project")} onClick={() => useRecentProjects.getState().open()}>
        <span className="max-w-48 truncate font-medium text-fg">{projectLabel || t("Open project")}</span>
        <ChevronDown className="size-3 shrink-0" strokeWidth={2} />
      </TitleButton>

      {hasCodeberg && branch && (
        <span
          title={t("Git branch")}
          className="wide-enter-fade ml-1 flex shrink-0 items-center gap-1 text-fg-dim"
        >
          <GitBranch className="size-3" strokeWidth={1.75} />
          <span className="max-w-32 truncate text-[11px]">{branch}</span>
        </span>
      )}

      <div className="flex-1" />

      {hasActiveChat && (
        <button
          type="button"
          title={t("Open project in Wide IDE")}
          onClick={async () => {
            const currentRoot = useWorkspace.getState().root || activeAiChat?.root || "";
            if (activeAiChatId) {
              await bridge.aiActiveChat({
                id: activeAiChatId,
                root: currentRoot,
                title: activeTab?.name || "New conversation",
              });
            }
            const res = await bridge.launchIde({ projectPath: currentRoot });
            if (res && res.ok) {
              toast.success(t("Wide IDE opened"));
            } else {
              toast.error(res?.error || t("Failed to open Wide IDE"));
            }
          }}
          style={{ display: "none" }}
          className="hidden no-drag mr-2 flex h-6.5 shrink-0 items-center gap-1.5 rounded-md bg-accent/20 px-2.5 text-[12px] font-medium text-fg-bright transition-colors hover:bg-accent/35"
        >
          <ExternalLink className="size-3.5" strokeWidth={1.75} />
          <span>Open IDE</span>
        </button>
      )}
    </header>
  );
}
