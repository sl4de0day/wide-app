import { create } from "zustand";

import { useAi } from "@/stores/ai";

export interface QueuedMessage {
  id: string;
  text: string;
}

interface ChatLike {
  loaded?: boolean;
  activeTurn: string | null;
}

interface QueueState {
  queues: Record<string, QueuedMessage[]>;
  paused: Record<string, boolean>;
  enqueue(sessionId: string, text: string): void;
  remove(sessionId: string, messageId: string): void;
  clear(sessionId: string): void;
  pause(sessionId: string): void;
  resume(sessionId: string): void;
  sendNow(sessionId: string, messageId: string): void;
}

const EMPTY: QueuedMessage[] = [];

let counter = 0;
function nextId(): string {
  counter += 1;
  return `q${Date.now().toString(36)}${counter}`;
}

export function readyToDrain(
  queues: Record<string, QueuedMessage[]>,
  paused: Record<string, boolean>,
  chats: Record<string, ChatLike | undefined>,
  configured: boolean,
): string[] {
  if (!configured) return [];
  return Object.keys(queues).filter((sessionId) => {
    const queue = queues[sessionId];
    const chat = chats[sessionId];
    return queue.length > 0 && !paused[sessionId] && Boolean(chat?.loaded) && !chat?.activeTurn;
  });
}

export const useAiQueue = create<QueueState>((set, get) => ({
  queues: {},
  paused: {},
  enqueue(sessionId, text) {
    const message = text.trim();
    if (!message) return;
    set((state) => ({
      queues: { ...state.queues, [sessionId]: [...(state.queues[sessionId] ?? EMPTY), { id: nextId(), text: message }] },
    }));
  },
  remove(sessionId, messageId) {
    set((state) => {
      const rest = (state.queues[sessionId] ?? EMPTY).filter((item) => item.id !== messageId);
      const queues = { ...state.queues };
      if (rest.length > 0) queues[sessionId] = rest;
      else delete queues[sessionId];
      return { queues };
    });
  },
  clear(sessionId) {
    set((state) => {
      const queues = { ...state.queues };
      delete queues[sessionId];
      const paused = { ...state.paused };
      delete paused[sessionId];
      return { queues, paused };
    });
  },
  pause(sessionId) {
    if (!get().queues[sessionId]?.length) return;
    set((state) => ({ paused: { ...state.paused, [sessionId]: true } }));
  },
  resume(sessionId) {
    set((state) => {
      const paused = { ...state.paused };
      delete paused[sessionId];
      return { paused };
    });
  },
  sendNow(sessionId, messageId) {
    const queue = get().queues[sessionId] ?? EMPTY;
    const item = queue.find((entry) => entry.id === messageId);
    if (!item) return;
    set((state) => {
      const paused = { ...state.paused };
      delete paused[sessionId];
      return {
        paused,
        queues: { ...state.queues, [sessionId]: [item, ...queue.filter((entry) => entry.id !== messageId)] },
      };
    });
  },
}));

let draining = false;

export function drainQueues(): void {
  if (draining) return;
  const ai = useAi.getState();
  for (const sessionId of Object.keys(useAiQueue.getState().queues)) {
    if (!ai.chats[sessionId]) useAiQueue.getState().clear(sessionId);
  }
  const { queues, paused } = useAiQueue.getState();
  const sessions = readyToDrain(queues, paused, ai.chats, Boolean(ai.config));
  if (sessions.length === 0) return;
  draining = true;
  try {
    for (const sessionId of sessions) {
      const [next] = useAiQueue.getState().queues[sessionId] ?? EMPTY;
      if (!next) continue;
      useAiQueue.getState().remove(sessionId, next.id);
      void useAi.getState().ask(sessionId, next.text);
    }
  } finally {
    draining = false;
  }
}

export function subscribeAiQueue(): () => void {
  const offAi = useAi.subscribe(() => drainQueues());
  const offQueue = useAiQueue.subscribe(() => drainQueues());
  return () => {
    offAi();
    offQueue();
  };
}
