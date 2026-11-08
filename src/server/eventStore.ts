import type { EventStore } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * Bounded in-memory resumability store for local/demo deployments.
 * Events expire after 15 minutes and the store retains at most 10,000 events.
 * This is not durable or shared across replicas; production deployments should
 * use a shared store with equivalent TTL and capacity policies.
 */
const EVENT_TTL_MS = 15 * 60 * 1000;
const MAX_EVENTS = 10_000;

interface StoredEvent {
  streamId: string;
  message: JSONRPCMessage;
  storedAt: number;
}

export class InMemoryEventStore implements EventStore {
  private events = new Map<string, StoredEvent>();

  private generateEventId(streamId: string): string {
    return `${streamId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private pruneExpired(now = Date.now()): void {
    for (const [id, event] of this.events) {
      if (now - event.storedAt > EVENT_TTL_MS) this.events.delete(id);
    }
  }

  async storeEvent(streamId: string, message: JSONRPCMessage): Promise<string> {
    this.pruneExpired();
    const eventId = this.generateEventId(streamId);
    this.events.set(eventId, { streamId, message, storedAt: Date.now() });

    while (this.events.size > MAX_EVENTS) {
      const oldest = this.events.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.events.delete(oldest);
    }
    return eventId;
  }

  async replayEventsAfter(
    lastEventId: string,
    { send }: { send: (eventId: string, message: JSONRPCMessage) => Promise<void> }
  ): Promise<string> {
    this.pruneExpired();
    const lastEvent = this.events.get(lastEventId);
    if (!lastEvent) return "";

    let pastLastEvent = false;
    for (const [eventId, event] of this.events) {
      if (event.streamId !== lastEvent.streamId) continue;
      if (eventId === lastEventId) {
        pastLastEvent = true;
        continue;
      }
      if (pastLastEvent) await send(eventId, event.message);
    }
    return lastEvent.streamId;
  }
}
