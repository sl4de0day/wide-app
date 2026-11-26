import { beforeEach, describe, expect, it } from "vitest";

import { readyToDrain, useAiQueue } from "@/stores/aiQueue";

const reset = () => useAiQueue.setState({ queues: {}, paused: {} });

describe("message queue", () => {
  beforeEach(reset);

  it("keeps messages in the order they were queued and ignores blank text", () => {
    const queue = useAiQueue.getState();
    queue.enqueue("s1", "first");
    queue.enqueue("s1", "   ");
    queue.enqueue("s1", " second ");
    expect(useAiQueue.getState().queues.s1.map((item) => item.text)).toEqual(["first", "second"]);
  });

  it("drops the session entry once its last message is removed", () => {
    useAiQueue.getState().enqueue("s1", "only");
    const [item] = useAiQueue.getState().queues.s1;
    useAiQueue.getState().remove("s1", item.id);
    expect(useAiQueue.getState().queues.s1).toBeUndefined();
  });

  it("pauses only a session that has queued messages", () => {
    useAiQueue.getState().pause("s1");
    expect(useAiQueue.getState().paused.s1).toBeUndefined();
    useAiQueue.getState().enqueue("s1", "later");
    useAiQueue.getState().pause("s1");
    expect(useAiQueue.getState().paused.s1).toBe(true);
  });

  it("moves a message to the front and resumes when sent now", () => {
    const queue = useAiQueue.getState();
    queue.enqueue("s1", "a");
    queue.enqueue("s1", "b");
    queue.pause("s1");
    const second = useAiQueue.getState().queues.s1[1];
    useAiQueue.getState().sendNow("s1", second.id);
    expect(useAiQueue.getState().queues.s1.map((item) => item.text)).toEqual(["b", "a"]);
    expect(useAiQueue.getState().paused.s1).toBeUndefined();
  });
});

describe("readyToDrain", () => {
  const queues = { s1: [{ id: "1", text: "x" }], s2: [{ id: "2", text: "y" }], s3: [] };

  it("sends only to idle, loaded, unpaused sessions", () => {
    const chats = {
      s1: { loaded: true, activeTurn: null },
      s2: { loaded: true, activeTurn: "s2#1" },
      s3: { loaded: true, activeTurn: null },
    };
    expect(readyToDrain(queues, {}, chats, true)).toEqual(["s1"]);
    expect(readyToDrain(queues, { s1: true }, chats, true)).toEqual([]);
  });

  it("waits while the chat is not loaded or no model is configured", () => {
    const chats = { s1: { loaded: false, activeTurn: null }, s2: undefined };
    expect(readyToDrain(queues, {}, chats, true)).toEqual([]);
    expect(readyToDrain(queues, {}, { s1: { loaded: true, activeTurn: null } }, false)).toEqual([]);
  });
});
