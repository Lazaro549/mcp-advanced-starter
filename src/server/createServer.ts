import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { NotesStore } from "./store.js";
import { registerCreateNoteTool } from "./tools/createNote.js";
import { registerIndexRootsTool } from "./tools/indexRoots.js";
import { registerSearchNotesTool } from "./tools/searchNotes.js";
import { registerSummarizeNoteTool } from "./tools/summarizeNote.js";

/**
 * Builds one DevNotes MCP server instance.
 *
 * This is a plain factory rather than a module-level singleton on purpose:
 * `src/server/http.ts` needs a *fresh* server (and a fresh NotesStore) per
 * session so that two concurrent clients don't see each other's notes —
 * call `createServer()` once per session there, and once total in
 * `src/server/stdio.ts`, which only ever has one caller anyway.
 */
export function createServer(): McpServer {
  const server = new McpServer(
    { name: "devnotes-mcp", title: "DevNotes MCP", version: "1.0.0" },
    {
      capabilities: {
        // Tools are auto-advertised from registerTool() calls below; logging
        // is opt-in and has to be declared explicitly.
        logging: {},
      },
      instructions:
        "DevNotes is a small notes server built to exercise MCP's advanced features. " +
        "create-note demonstrates elicitation, search-notes demonstrates pagination, " +
        "summarize-note demonstrates sampling, and index-roots demonstrates roots plus " +
        "progress/logging notifications.",
    }
  );

  const store = new NotesStore();
  seedDemoNotes(store);

  registerCreateNoteTool(server, store);
  registerSearchNotesTool(server, store);
  registerSummarizeNoteTool(server, store);
  registerIndexRootsTool(server, store);

  return server;
}

/** A couple of notes so search/summarize have something to work with on a fresh start. */
function seedDemoNotes(store: NotesStore): void {
  store.create({
    title: "Welcome to DevNotes",
    body:
      "This server ships with a couple of seed notes so search-notes and summarize-note have " +
      "something to work with immediately. Try: search-notes with an empty query, then " +
      "summarize-note on whichever id comes back first.",
    tags: ["devnotes", "readme"],
    priority: "low",
  });
  store.create({
    title: "MCP: Advanced Topics — things worth remembering",
    body:
      "Sampling shifts inference cost and complexity from server to client. Roots let a server " +
      "read specific client-approved directories without ever choosing a path itself. Streamable " +
      "HTTP replaced HTTP+SSE as the recommended remote transport; stateless mode trades " +
      "resumability for easy horizontal scaling.",
    tags: ["mcp", "course-notes"],
    priority: "medium",
  });
}
