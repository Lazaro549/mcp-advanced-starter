import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotesStore } from "../store.js";

/**
 * Roots + progress demo, combined because they naturally show up together:
 * the client decides which local folders the server is allowed to see
 * (`roots/list`), and importing files from one is exactly the kind of
 * multi-step operation worth reporting progress on.
 *
 * Progress is opt-in per request: MCP clients that want updates attach a
 * `progressToken` to the call's `_meta`. We only ever send
 * `notifications/progress` when one is present — sending them unconditionally
 * would violate the spec for clients that never asked.
 */
export function registerIndexRootsTool(server: McpServer, store: NotesStore): void {
  server.registerTool(
    "index-roots",
    {
      title: "Index roots into notes",
      description:
        "Ask the connected client which local folders it exposes (MCP roots), then import " +
        ".md/.markdown/.txt files from each as notes, reporting progress as it goes.",
      inputSchema: {},
      outputSchema: {
        rootsSeen: z.number(),
        notesImported: z.number(),
        importedTitles: z.array(z.string()),
      },
    },
    async (_args, extra) => {
      let roots;
      try {
        ({ roots } = await server.server.listRoots(undefined, { relatedRequestId: extra.requestId }));
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `The connected client doesn't support roots (or declined the request): ${String(error)}`,
            },
          ],
        };
      }

      if (roots.length === 0) {
        return {
          content: [
            {
              type: "text",
              text:
                "The client didn't expose any roots. In the demo client, pass --root <path> to grant " +
                "one, or point Claude Desktop / MCP Inspector at a workspace folder.",
            },
          ],
        };
      }

      const progressToken = extra._meta?.progressToken;
      const imported: string[] = [];
      let filesSoFar = 0;
      // Best-effort total across roots so progress reads as "3 of 11", not
      // three separate 1-of-N bars — matched to the store's own scan order.
      const roughTotal = roots.length * 200; // MAX_FILES_PER_ROOT in store.ts

      // Logging vs. progress: progress is structured and UI-bound (a number
      // out of a total); logging is a free-text trace a client can surface in
      // a console/log panel. Both are notifications; they serve different ends.
      await server.sendLoggingMessage(
        { level: "info", logger: "index-roots", data: `Starting import across ${roots.length} root(s)` },
        extra.sessionId
      );

      for (const root of roots) {
        const notes = await store.importFromRoot(root.uri, async (fileName, index, total) => {
          filesSoFar++;
          if (progressToken === undefined) return;
          await extra.sendNotification({
            method: "notifications/progress",
            params: {
              progressToken,
              progress: filesSoFar,
              total: roughTotal,
              message: `${root.name ?? root.uri}: imported ${fileName} (${index}/${total})`,
            },
          });
        });
        imported.push(...notes.map((n) => n.title));
      }

      const summary =
        imported.length === 0
          ? `Checked ${roots.length} root(s), found no .md/.markdown/.txt files to import.`
          : `Imported ${imported.length} note(s) from ${roots.length} root(s):\n${imported.map((t) => `- ${t}`).join("\n")}`;

      await server.sendLoggingMessage(
        { level: "info", logger: "index-roots", data: `Import complete: ${imported.length} note(s) created` },
        extra.sessionId
      );

      return {
        content: [{ type: "text", text: summary }],
        structuredContent: { rootsSeen: roots.length, notesImported: imported.length, importedTitles: imported },
      };
    }
  );
}
