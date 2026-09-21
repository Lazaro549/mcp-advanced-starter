import { describe, it, expect, vi } from "vitest";
import { NotesStore } from "../../src/server/store.js";

function makeServerStub() {
  type Handler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>;
  const tools = new Map<string, Handler>();
  const createMessage = vi.fn();
  return {
    registerTool: (_name: string, _schema: unknown, handler: Handler) => {
      tools.set(_name, handler);
    },
    invoke: (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      const h = tools.get(name);
      if (!h) throw new Error(`Tool not registered: ${name}`);
      return h(args, extra);
    },
    server: { createMessage },
    _createMessage: createMessage,
  };
}

describe("summarize-note tool", () => {
  it("returns error for unknown note id", async () => {
    const { registerSummarizeNoteTool } = await import("../../src/server/tools/summarizeNote.js");
    const store = new NotesStore();
    const server = makeServerStub();
    registerSummarizeNoteTool(server as unknown as Parameters<typeof registerSummarizeNoteTool>[0], store);

    const result = (await server.invoke("summarize-note", { id: "nonexistent" })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("No note found");
  });

  it("calls sampling and returns structured content on success", async () => {
    const { registerSummarizeNoteTool } = await import("../../src/server/tools/summarizeNote.js");
    const store = new NotesStore();
    const note = store.create({ title: "My Note", body: "Important content", tags: [], priority: "medium" });

    const server = makeServerStub();
    server._createMessage.mockResolvedValue({
      content: { type: "text", text: "A concise summary." },
      model: "claude-mock",
    });
    registerSummarizeNoteTool(server as unknown as Parameters<typeof registerSummarizeNoteTool>[0], store);

    const result = (await server.invoke("summarize-note", { id: note.id })) as {
      content: Array<{ text: string }>;
      structuredContent: { id: string; summary: string; model: string };
    };

    expect(server._createMessage).toHaveBeenCalledOnce();
    expect(result.structuredContent.id).toBe(note.id);
    expect(result.structuredContent.summary).toBe("A concise summary.");
    expect(result.structuredContent.model).toBe("claude-mock");
    expect(result.content[0]!.text).toBe("A concise summary.");
  });

  it("returns error when client does not support sampling", async () => {
    const { registerSummarizeNoteTool } = await import("../../src/server/tools/summarizeNote.js");
    const store = new NotesStore();
    const note = store.create({ title: "Note", body: "body", tags: [], priority: "low" });

    const server = makeServerStub();
    server._createMessage.mockRejectedValue(new Error("sampling not supported"));
    registerSummarizeNoteTool(server as unknown as Parameters<typeof registerSummarizeNoteTool>[0], store);

    const result = (await server.invoke("summarize-note", { id: note.id })) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("sampling");
  });

  it("passes note title and body to the sampling request", async () => {
    const { registerSummarizeNoteTool } = await import("../../src/server/tools/summarizeNote.js");
    const store = new NotesStore();
    const note = store.create({ title: "Unique Title XYZ", body: "Unique body ABC", tags: [], priority: "low" });

    const server = makeServerStub();
    server._createMessage.mockResolvedValue({
      content: { type: "text", text: "summary" },
      model: "mock",
    });
    registerSummarizeNoteTool(server as unknown as Parameters<typeof registerSummarizeNoteTool>[0], store);

    await server.invoke("summarize-note", { id: note.id });

    const callArg = server._createMessage.mock.calls[0]![0] as {
      messages: Array<{ content: { text: string } }>;
    };
    expect(callArg.messages[0]!.content.text).toContain("Unique Title XYZ");
    expect(callArg.messages[0]!.content.text).toContain("Unique body ABC");
  });

  it("handles non-text sampling response gracefully", async () => {
    const { registerSummarizeNoteTool } = await import("../../src/server/tools/summarizeNote.js");
    const store = new NotesStore();
    const note = store.create({ title: "N", body: "b", tags: [], priority: "low" });

    const server = makeServerStub();
    server._createMessage.mockResolvedValue({
      content: { type: "image", data: "base64..." },
      model: "mock",
    });
    registerSummarizeNoteTool(server as unknown as Parameters<typeof registerSummarizeNoteTool>[0], store);

    const result = (await server.invoke("summarize-note", { id: note.id })) as {
      structuredContent: { summary: string };
    };
    expect(result.structuredContent.summary).toBe("(non-text response)");
  });
});
