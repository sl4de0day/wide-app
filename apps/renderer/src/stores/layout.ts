import { create } from "zustand";

const SIDEBAR_KEY = "wide.layout.sidebar_collapsed";
const GROUPS_KEY = "wide.layout.collapsed_groups";

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

export type SidebarView = "chats" | "database";

interface LayoutState {
  sidebarCollapsed: boolean;
  sidebarView: SidebarView;
  searchOpen: boolean;
  collapsedGroups: string[];
  toggleSidebar(): void;
  setSidebarView(view: SidebarView): void;
  setSearchOpen(open: boolean): void;
  toggleGroup(key: string): void;
}

export const useLayout = create<LayoutState>((set, get) => ({
  sidebarCollapsed: readFlag(SIDEBAR_KEY),
  sidebarView: "chats",
  searchOpen: false,
  collapsedGroups: readList(GROUPS_KEY),
  toggleSidebar() {
    const next = !get().sidebarCollapsed;
    write(SIDEBAR_KEY, next ? "1" : "0");
    set({ sidebarCollapsed: next });
  },
  setSidebarView(view) {
    set({ sidebarView: view, sidebarCollapsed: false });
  },
  setSearchOpen(open) {
    set(open ? { searchOpen: true, sidebarView: "chats", sidebarCollapsed: false } : { searchOpen: false });
  },
  toggleGroup(key) {
    const current = get().collapsedGroups;
    const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key];
    write(GROUPS_KEY, JSON.stringify(next));
    set({ collapsedGroups: next });
  },
}));
