import { describe, expect, it } from "vitest";
import { InMemoryEventStore } from "../../src/server/eventStore.js";

describe("InMemoryEventStore", () => {
  it("replays only events after the requested event in the same stream", async () => {
    const store = new InMemoryEventStore();
    const first = await store.storeEvent("stream-a", { jsonrpc: "2.0", method: "notifications/progress" });
    const second = await store.storeEvent("stream-a", { jsonrpc: "2.0", method: "notifications/message" });
    await store.storeEvent("stream-b", { jsonrpc: "2.0", method: "notifications/message" });

    const replayed: string[] = [];
    const stream = await store.replayEventsAfter(first, async (id) => { replayed.push(id); });
    expect(stream).toBe("stream-a");
    expect(replayed).toEqual([second]);
  });

  it("returns an empty stream for unknown or evicted event ids", async () => {
    const store = new InMemoryEventStore();
    expect(await store.replayEventsAfter("missing", async () => undefined)).toBe("");
  });
});
