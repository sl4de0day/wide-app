import { ChevronLeft, Database, Search, Settings, SquarePen } from "lucide-react";
import { Suspense, lazy, type ReactNode } from "react";

import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AiPanel } from "@/panels/AiPanel";
import { useAi } from "@/stores/ai";
import { SETTINGS_PATH, useEditor } from "@/stores/editor";
import { useLayout } from "@/stores/layout";

const DatabasePanel = lazy(() => import("@/panels/DatabasePanel").then((m) => ({ default: m.DatabasePanel })));

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-row w-full items-center gap-3 rounded-lg px-3 text-left text-body transition-colors duration-100",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        active ? "bg-selected text-fg-bright" : "text-fg-muted hover:bg-hover hover:text-fg",
      )}
    >
      <span className="flex size-icon-lg shrink-0 items-center justify-center">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

export async function startConversation(title: string): Promise<void> {
  const id = await useAi.getState().newSession();
  if (!id) return;
  useLayout.getState().setSidebarView("chats");
  useEditor.getState().openAiChat(id, title);
}

export function Sidebar() {
  const t = useT();
  const view = useLayout((state) => state.sidebarView);
  const searchOpen = useLayout((state) => state.searchOpen);
  const settingsOpen = useEditor((state) => state.activePath === SETTINGS_PATH);

  return (
    <aside className="wide-enter-side flex w-sidebar shrink-0 flex-col bg-panel" aria-label={t("Sidebar")}>
      <nav className="flex shrink-0 flex-col gap-0.5 px-2 pb-3 pt-2">
        <NavItem
          icon={<SquarePen className="size-icon" strokeWidth={1.5} />}
          label={t("New conversation")}
          onClick={() => void startConversation(t("New conversation"))}
        />
        <NavItem
          icon={<Search className="size-icon" strokeWidth={1.5} />}
          label={t("Search")}
          active={searchOpen && view === "chats"}
          onClick={() => useLayout.getState().setSearchOpen(!(searchOpen && view === "chats"))}
        />
        <NavItem
          icon={<Database className="size-icon" strokeWidth={1.5} />}
          label={t("Database")}
          active={view === "database"}
          onClick={() => useLayout.getState().setSidebarView(view === "database" ? "chats" : "database")}
        />
      </nav>

      <div className="min-h-0 flex-1 overflow-hidden">
        {view === "database" ? (
          <div className="flex h-full flex-col">
            <button
              type="button"
              onClick={() => useLayout.getState().setSidebarView("chats")}
              className="mx-2 mb-1 flex h-row-sm shrink-0 items-center gap-1 rounded-md px-3 text-caption font-medium text-fg-faint transition-colors duration-100 hover:text-fg-dim"
            >
              <ChevronLeft className="size-3" strokeWidth={2} />
              {t("Conversations")}
            </button>
            <div className="min-h-0 flex-1 overflow-hidden">
              <Suspense fallback={null}>
                <DatabasePanel />
              </Suspense>
            </div>
          </div>
        ) : (
          <AiPanel />
        )}
      </div>

      <div className="shrink-0 px-2 pb-2 pt-1">
        <NavItem
          icon={<Settings className="size-icon" strokeWidth={1.5} />}
          label={t("Settings")}
          active={settingsOpen}
          onClick={() => useEditor.getState().openSettings()}
        />
      </div>
    </aside>
  );
}
