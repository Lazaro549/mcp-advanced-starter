import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotesStore } from "../store.js";

/**
 * Pagination demo. `store.search` returns a page plus an opaque `nextCursor`
 * — the same shape MCP uses natively for `resources/list`, `tools/list`,
 * etc. The tool never interprets the cursor, only forwards whatever the
 * store handed back; callers are expected to do the same (pass it back
 * verbatim on the next call, stop when it's absent).
 */
export function registerSearchNotesTool(server: McpServer, store: NotesStore): void {
  server.registerTool(
    "search-notes",
    {
      title: "Search notes",
      description:
        "Full-text search over note titles, bodies, and tags. Results are paginated — pass the " +
        "`cursor` from a previous response to fetch the next page, and stop once no cursor comes back.",
      inputSchema: {
        query: z.string().default("").describe("Search text; empty string matches every note"),
        cursor: z.string().optional().describe("Opaque cursor from a previous response's nextCursor"),
        pageSize: z.number().int().min(1).max(50).default(5).describe("Results per page"),
      },
      outputSchema: {
        notes: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            tags: z.array(z.string()),
            priority: z.enum(["low", "medium", "high"]),
            updatedAt: z.string(),
          })
        ),
        nextCursor: z.string().optional(),
      },
    },
    async ({ query, cursor, pageSize }) => {
      const { page, nextCursor } = store.search(query, { cursor, pageSize });

      const summaryLines = page.map((n) => `- [${n.priority}] ${n.title} (${n.id})`);
      const summary =
        page.length === 0
          ? "No matching notes."
          : `${summaryLines.join("\n")}${nextCursor ? `\n\n${page.length} shown, more available — pass cursor "${nextCursor}" for the next page.` : "\n\nEnd of results."}`;

      return {
        content: [{ type: "text", text: summary }],
        structuredContent: {
          notes: page.map((n) => ({
            id: n.id,
            title: n.title,
            tags: n.tags,
            priority: n.priority,
            updatedAt: n.updatedAt,
          })),
          nextCursor,
        },
      };
    }
  );
}
