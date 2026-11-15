import { create } from "zustand";

import type { BrowserEvent } from "@/lib/bridge";

export interface BrowserTab {
  id: string;

  url: string;
  title: string;
  loading: boolean;
  canBack: boolean;
  canForward: boolean;

  favicon?: string;
}

let seq = 0;
const makeId = () => `t${Date.now().toString(36)}${(seq += 1).toString(36)}`;

const FAVICON_MAX_CHARS = 100000;

const renderableFavicon = (value: string): string | undefined =>
  value.startsWith("data:image/") && value.length <= FAVICON_MAX_CHARS ? value : undefined;

const makeTab = (): BrowserTab => ({
  id: makeId(),
  url: "",
  title: "",
  loading: false,
  canBack: false,
  canForward: false,
});

interface BrowserState {
  tabs: BrowserTab[];
  activeId: string;

  ensureOne(): void;
  newTab(): void;
  closeTab(id: string): void;
  selectTab(id: string): void;

  commit(url: string): void;

  openUrl(url: string): void;

  ingest(event: BrowserEvent): void;
  active(): BrowserTab | undefined;
}

const BROWSER_EMOJI_RE =
  /(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u2600-\u27BF])(?:\uFE0F|\uFE0E|[\u{1F3FB}-\u{1F3FF}])?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation}|[\u2600-\u27BF])(?:\uFE0F|\uFE0E|[\u{1F3FB}-\u{1F3FF}])?)+|[0-9#*]\uFE0F?\u20E3|[\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?|\p{Emoji_Presentation}(?:\uFE0F|\uFE0E)?|[\u231A-\u23FF\u2600-\u27BF\u2B05-\u2B55][\uFE0E\uFE0F]?|[\u2139\u2194-\u21AA\u24C2\u25AA-\u25FE\u2934-\u2935\u3030\u303D\u3297\u3299]\uFE0F|[\uFE0E\uFE0F\u200D\u20E3]/gu;

function sanitizeBrowserTitle(text: string): string {
  return String(text ?? "").replace(BROWSER_EMOJI_RE, "").replace(/[ \t]{2,}/g, " ").trim();
}

const patchActive = (tabs: BrowserTab[], activeId: string, patch: Partial<BrowserTab>) =>
  tabs.map((tab) => (tab.id === activeId ? { ...tab, ...patch } : tab));

export const useBrowser = create<BrowserState>((set, get) => ({
  tabs: [],
  activeId: "",

  ensureOne: () => {
    if (get().tabs.length === 0) {
      const tab = makeTab();
      set({ tabs: [tab], activeId: tab.id });
    }
  },

  newTab: () => {
    const tab = makeTab();
    set((state) => ({ tabs: [...state.tabs, tab], activeId: tab.id }));
  },

  closeTab: (id) => {
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== id);

      if (tabs.length === 0) {
        const tab = makeTab();
        return { tabs: [tab], activeId: tab.id };
      }

      let activeId = state.activeId;
      if (id === state.activeId) activeId = tabs[Math.min(index, tabs.length - 1)].id;
      return { tabs, activeId };
    });
  },

  selectTab: (id) => set({ activeId: id }),

  commit: (url) => set((state) => ({ tabs: patchActive(state.tabs, state.activeId, { url }) })),

  openUrl: (url) =>
    set((state) => {
      const activeBlank = state.tabs.some((tab) => tab.id === state.activeId && tab.url === "");
      if (activeBlank) return { tabs: patchActive(state.tabs, state.activeId, { url }) };
      const tab: BrowserTab = { ...makeTab(), url };
      return { tabs: [...state.tabs, tab], activeId: tab.id };
    }),

  ingest: (event) =>
    set((state) => {

      const known = event.tabId ? state.tabs.some((tab) => tab.id === event.tabId) : false;
      if (event.tabId && !known) return state;
      const id = event.tabId && known ? event.tabId : state.activeId;
      const patch: Partial<BrowserTab> = {};
      if (event.url !== undefined) patch.url = event.url;
      if (event.title !== undefined) patch.title = sanitizeBrowserTitle(event.title);
      if (event.loading !== undefined) patch.loading = event.loading;
      if (event.canGoBack !== undefined) patch.canBack = event.canGoBack;
      if (event.canGoForward !== undefined) patch.canForward = event.canGoForward;
      if (event.favicon !== undefined) {
        const renderable = renderableFavicon(event.favicon);
        if (renderable) patch.favicon = renderable;
        else if (!event.favicon) patch.favicon = undefined;
      }
      return { tabs: patchActive(state.tabs, id, patch) };
    }),

  active: () => get().tabs.find((tab) => tab.id === get().activeId),
}));
