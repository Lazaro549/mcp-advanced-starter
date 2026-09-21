import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import type { NotesStore, Priority } from "../store.js";

const PRIORITIES = ["low", "medium", "high"] as const satisfies readonly Priority[];

/**
 * Elicitation demo: `priority` is an optional input. When the caller leaves
 * it out, instead of silently defaulting we pause the tool call and ask the
 * *user* to choose — a small, concrete example of `elicitation/create`.
 *
 * Elicitation is an optional client capability. Clients that don't support
 * it (or a human who dismisses the prompt) shouldn't break the tool, so any
 * non-"accept" outcome — decline, cancel, or an unsupporting client throwing
 * on the request — just falls back to `undefined` and the caller defaults.
 */
async function elicitPriority(
  server: McpServer,
  extra: RequestHandlerExtra<ServerRequest, ServerNotification>
): Promise<Priority | undefined> {
  try {
    const result = await server.server.elicitInput(
      {
        message: "What priority should this note have?",
        requestedSchema: {
          type: "object",
          properties: {
            priority: {
              type: "string",
              title: "Priority",
              enum: [...PRIORITIES],
              enumNames: ["Low", "Medium", "High"],
            },
          },
          required: ["priority"],
        },
      },
      { relatedRequestId: extra.requestId }
    );

    if (result.action !== "accept" || !result.content) return undefined;
    const value = result.content["priority"];
    return typeof value === "string" && (PRIORITIES as readonly string[]).includes(value)
      ? (value as Priority)
      : undefined;
  } catch {
    return undefined;
  }
}

export function registerCreateNoteTool(server: McpServer, store: NotesStore): void {
  server.registerTool(
    "create-note",
    {
      title: "Create note",
      description:
        "Create a new note. Omit `priority` to see MCP elicitation in action — the server will " +
        "pause and ask you to pick one interactively instead of silently defaulting.",
      inputSchema: {
        title: z.string().min(1).max(200).describe("Short note title"),
        body: z.string().min(1).describe("Note contents (markdown is fine)"),
        tags: z.array(z.string()).default([]).describe("Freeform tags, e.g. ['mcp', 'todo']"),
        priority: z
          .enum(PRIORITIES)
          .optional()
          .describe("low | medium | high — leave unset to be asked interactively"),
      },
      outputSchema: {
        id: z.string(),
        title: z.string(),
        priority: z.enum(PRIORITIES),
        createdAt: z.string(),
      },
    },
    async ({ title, body, tags, priority }, extra) => {
      const resolvedPriority = priority ?? (await elicitPriority(server, extra)) ?? "medium";
      const note = store.create({ title, body, tags, priority: resolvedPriority });

      return {
        content: [{ type: "text", text: `Created "${note.title}" (${note.id}) — priority: ${note.priority}` }],
        structuredContent: {
          id: note.id,
          title: note.title,
          priority: note.priority,
          createdAt: note.createdAt,
        },
      };
    }
  );
}
