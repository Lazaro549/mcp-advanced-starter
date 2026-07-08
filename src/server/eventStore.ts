import type { EventStore } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

/**
 * Resumability for the Streamable HTTP transport.
 *
 * When a client's connection drops mid-stream (flaky wifi, a laptop closing,
 * a load balancer timing out), it can reconnect with a `Last-Event-ID` header
 * instead of starting over. The transport calls `replayEventsAfter` to figure
 * out what the client already saw and resend only what's missing.
 *
 * This implementation is deliberately the simplest thing that works: an
 * in-memory Map. It's perfect for local development and for understanding the
 * mechanism, but every event is lost on restart and it never evicts old
 * entries. A production deployment would back this with Redis/Postgres and
 * add TTL-based cleanup.
 */
export class InMemoryEventStore implements EventStore {
  private events = new Map<string, { streamId: string; message: JSONRPCMessage }>();

  private generateEventId(streamId: string): string {
    return `${streamId}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private streamIdFromEventId(eventId: string): string {
    return eventId.split("_")[0] ?? "";
  }

  async storeEvent(streamId: string, message: JSONRPCMessage): Promise<string> {
    const eventId = this.generateEventId(streamId);
    this.events.set(eventId, { streamId, message });
    return eventId;
  }

  async replayEventsAfter(
    lastEventId: string,
    { send }: { send: (eventId: string, message: JSONRPCMessage) => Promise<void> }
  ): Promise<string> {
    if (!lastEventId || !this.events.has(lastEventId)) return "";

    const streamId = this.streamIdFromEventId(lastEventId);
    if (!streamId) return "";

    const sorted = [...this.events.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let pastLastEvent = false;
    for (const [eventId, { streamId: eventStreamId, message }] of sorted) {
      if (eventStreamId !== streamId) continue;
      if (eventId === lastEventId) {
        pastLastEvent = true;
        continue;
      }
      if (pastLastEvent) await send(eventId, message);
    }
    return streamId;
  }
}
