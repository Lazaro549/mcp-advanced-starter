import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { NotesStore } from "../store.js";

/**
 * Sampling demo. The server has no model of its own and no API key — it
 * asks the *connected client* to run a completion via `sampling/createMessage`
 * and gets the text back. This is the cost/complexity shift the course talks
 * about: the client (which is already paying for and holding credentials to
 * an LLM) does the inference; the server just describes what it needs.
 *
 * `maxTokens` is required by the spec even though the client has final say
 * over the actual model and generation params — think of it as a budget hint,
 * not a guarantee.
 */
export function registerSummarizeNoteTool(server: McpServer, store: NotesStore): void {
  server.registerTool(
    "summarize-note",
    {
      title: "Summarize note",
      description:
        "Summarize a note in one or two sentences by asking the connected client's LLM to do it " +
        "(MCP sampling) — the server itself never calls a model API directly.",
      inputSchema: {
        id: z.string().describe("Note id, as returned by create-note or search-notes"),
      },
      outputSchema: {
        id: z.string(),
        summary: z.string(),
        model: z.string(),
      },
    },
    async ({ id }, extra) => {
      const note = store.get(id);
      if (!note) {
        return { isError: true, content: [{ type: "text", text: `No note found with id "${id}".` }] };
      }

      let result;
      try {
        result = await server.server.createMessage(
          {
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: `Summarize the following note in one or two plain-English sentences. ` +
                    `Return only the summary, no preamble.\n\nTitle: ${note.title}\n\n${note.body}`,
                },
              },
            ],
            systemPrompt: "You are a terse note-summarization assistant.",
            maxTokens: 200,
          },
          { relatedRequestId: extra.requestId }
        );
      } catch (error) {
        // Sampling is an optional client capability — a client that doesn't
        // declare it will reject this request outright.
        return {
          isError: true,
          content: [
            {
              type: "text",
              text:
                "The connected client doesn't support sampling (or declined the request), " +
                `so no summary could be generated. Underlying error: ${String(error)}`,
            },
          ],
        };
      }

      const summary = result.content.type === "text" ? result.content.text.trim() : "(non-text response)";

      return {
        content: [{ type: "text", text: summary }],
        structuredContent: { id: note.id, summary, model: result.model },
      };
    }
  );
}
