import { describe, it, expect, beforeEach, vi } from "vitest";
import { NotesStore } from "../../src/server/store.js";

// Minimal McpServer stub that captures registerTool calls and lets us invoke handlers
function makeServerStub() {
  type Handler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>;
  const tools = new Map<string, Handler>();
  return {
    registerTool: (_name: string, _schema: unknown, handler: Handler) => {
      tools.set(_name, handler);
    },
    invoke: (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      const h = tools.get(name);
      if (!h) throw new Error(`Tool not registered: ${name}`);
      return h(args, extra);
    },
    server: {
      elicitInput: vi.fn(),
    },
  };
}

describe("create-note tool", () => {
  it("creates a note with supplied priority", async () => {
    const { registerCreateNoteTool } = await import("../../src/server/tools/createNote.js");
    const store = new NotesStore();
    const server = makeServerStub() as unknown as Parameters<typeof registerCreateNoteTool>[0];
    registerCreateNoteTool(server, store);

    const result = (await (server as ReturnType<typeof makeServerStub>).invoke("create-note", {
      title: "Test note",
      body: "Hello world",
      tags: ["test"],
      priority: "high",
    })) as { structuredContent: { id: string; title: string; priority: string; createdAt: string } };

    expect(result.structuredContent.title).toBe("Test note");
    expect(result.structuredContent.priority).toBe("high");
    expect(result.structuredContent.id).toBeTruthy();
    expect(result.structuredContent.createdAt).toBeTruthy();
  });

  it("defaults to medium priority when elicitation returns undefined", async () => {
    const { registerCreateNoteTool } = await import("../../src/server/tools/createNote.js");
    const store = new NotesStore();
    const server = makeServerStub();
    // elicitInput throws → elicitPriority returns undefined → defaults to "medium"
    server.server.elicitInput.mockRejectedValue(new Error("not supported"));
    registerCreateNoteTool(server as unknown as Parameters<typeof registerCreateNoteTool>[0], store);

    const result = (await server.invoke("create-note", {
      title: "No priority",
      body: "body",
      tags: [],
    })) as { structuredContent: { priority: string } };

    expect(result.structuredContent.priority).toBe("medium");
  });

  it("uses elicited priority when elicitation succeeds", async () => {
    const { registerCreateNoteTool } = await import("../../src/server/tools/createNote.js");
    const store = new NotesStore();
    const server = makeServerStub();
    server.server.elicitInput.mockResolvedValue({ action: "accept", content: { priority: "high" } });
    registerCreateNoteTool(server as unknown as Parameters<typeof registerCreateNoteTool>[0], store);

    const result = (await server.invoke("create-note", {
      title: "Elicited",
      body: "body",
      tags: [],
      // no priority supplied
    })) as { structuredContent: { priority: string } };

    expect(result.structuredContent.priority).toBe("high");
  });

  it("falls back to medium when elicitation is declined", async () => {
    const { registerCreateNoteTool } = await import("../../src/server/tools/createNote.js");
    const store = new NotesStore();
    const server = makeServerStub();
    server.server.elicitInput.mockResolvedValue({ action: "decline", content: null });
    registerCreateNoteTool(server as unknown as Parameters<typeof registerCreateNoteTool>[0], store);

    const result = (await server.invoke("create-note", {
      title: "Declined",
      body: "body",
      tags: [],
    })) as { structuredContent: { priority: string } };

    expect(result.structuredContent.priority).toBe("medium");
  });

  it("returns structured content alongside text content", async () => {
    const { registerCreateNoteTool } = await import("../../src/server/tools/createNote.js");
    const store = new NotesStore();
    const server = makeServerStub();
    server.server.elicitInput.mockRejectedValue(new Error("no"));
    registerCreateNoteTool(server as unknown as Parameters<typeof registerCreateNoteTool>[0], store);

    const result = (await server.invoke("create-note", {
      title: "Structured",
      body: "body",
      tags: [],
      priority: "low",
    })) as { content: Array<{ type: string; text: string }>; structuredContent: object };

    expect(result.content[0]!.type).toBe("text");
    expect(result.content[0]!.text).toContain("Structured");
    expect(result.structuredContent).toBeDefined();
  });
});
