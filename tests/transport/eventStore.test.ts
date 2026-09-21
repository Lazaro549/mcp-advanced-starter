import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryEventStore } from "../../src/server/eventStore.js";

describe("InMemoryEventStore", () => {
  let store: InMemoryEventStore;

  beforeEach(() => {
    store = new InMemoryEventStore();
  });

  it("stores an event and returns a non-empty eventId", async () => {
    const eventId = await store.storeEvent("stream-1", { jsonrpc: "2.0", method: "ping", id: 1 });
    expect(eventId).toBeTruthy();
    expect(eventId).toContain("stream-1");
  });

  it("replays events after a given lastEventId", async () => {
    const msg1 = { jsonrpc: "2.0" as const, method: "a", id: 1 };
    const msg2 = { jsonrpc: "2.0" as const, method: "b", id: 2 };
    const msg3 = { jsonrpc: "2.0" as const, method: "c", id: 3 };

    const id1 = await store.storeEvent("s1", msg1);
    const id2 = await store.storeEvent("s1", msg2);
    await store.storeEvent("s1", msg3);

    const replayed: unknown[] = [];
    await store.replayEventsAfter(id1, {
      send: async (_eid, msg) => { replayed.push(msg); },
    });

    expect(replayed).toHaveLength(2);
    expect(replayed[0]).toEqual(msg2);
    expect(replayed[1]).toEqual(msg3);
  });

  it("returns empty string for unknown lastEventId", async () => {
    const streamId = await store.replayEventsAfter("nonexistent", {
      send: async () => {},
    });
    expect(streamId).toBe("");
  });

  it("does not replay events from a different stream", async () => {
    const msg1 = { jsonrpc: "2.0" as const, method: "x", id: 1 };
    const msg2 = { jsonrpc: "2.0" as const, method: "y", id: 2 };

    const id1 = await store.storeEvent("stream-A", msg1);
    await store.storeEvent("stream-B", msg2);

    const replayed: unknown[] = [];
    await store.replayEventsAfter(id1, {
      send: async (_eid, msg) => { replayed.push(msg); },
    });

    // stream-B's event should not appear
    expect(replayed).toHaveLength(0);
  });

  it("returns the streamId from replayEventsAfter", async () => {
    const id = await store.storeEvent("my-stream", { jsonrpc: "2.0", method: "test", id: 1 });
    const returnedStreamId = await store.replayEventsAfter(id, { send: async () => {} });
    expect(returnedStreamId).toBe("my-stream");
  });
});
