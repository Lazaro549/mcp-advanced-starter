# Streamable HTTP notes

Streamable HTTP replaced the old HTTP+SSE transport as the recommended way to
run an MCP server remotely. A single `/mcp` endpoint handles POST (client to
server), GET (opens a long-lived stream the server can push notifications and
requests down), and DELETE (explicit session teardown).

Two modes:

- **Stateful** — the server issues a session id on `initialize` and keeps a
  transport per session. Pair it with an `EventStore` and it becomes
  resumable: a client that drops mid-stream can reconnect with
  `Last-Event-ID` and pick up only what it missed.
- **Stateless** — no session id, no server-held state between requests. Every
  POST gets a brand-new server + transport pair. Trivial to run behind a load
  balancer with no sticky sessions, at the cost of resumability and anything
  that depends on a request outliving one HTTP exchange.

Point `index-roots` at this folder (`--root <path-to-this-folder>` in the demo
client) to pull this file in as a note.
