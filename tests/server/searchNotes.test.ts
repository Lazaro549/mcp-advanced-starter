import { describe, it, expect, beforeEach } from "vitest";
import { NotesStore } from "../../src/server/store.js";

function makeServerStub() {
  type Handler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>;
  const tools = new Map<string, Handler>();
  return {
    registerTool: (_name: string, _schema: unknown, handler: Handler) => {
      tools.set(_name, handler);
    },
    invoke: (name: string, args: Record<string, unknown>) => {
      const h = tools.get(name);
      if (!h) throw new Error(`Tool not registered: ${name}`);
      return h(args, {});
    },
  };
}

describe("search-notes tool", () => {
  let store: NotesStore;
  let server: ReturnType<typeof makeServerStub>;

  beforeEach(async () => {
    const { registerSearchNotesTool } = await import("../../src/server/tools/searchNotes.js");
    store = new NotesStore();
    server = makeServerStub();
    registerSearchNotesTool(server as unknown as Parameters<typeof registerSearchNotesTool>[0], store);
  });

  it("returns empty results when store is empty", async () => {
    const result = (await server.invoke("search-notes", { query: "anything" })) as {
      structuredContent: { notes: unknown[]; nextCursor?: string };
      content: Array<{ text: string }>;
    };
    expect(result.structuredContent.notes).toEqual([]);
    expect(result.structuredContent.nextCursor).toBeUndefined();
    expect(result.content[0]!.text).toContain("No matching notes");
  });

  it("returns all notes for empty query", async () => {
    store.create({ title: "A", body: "a", tags: [], priority: "low" });
    store.create({ title: "B", body: "b", tags: [], priority: "low" });

    const result = (await server.invoke("search-notes", { query: "" })) as {
      structuredContent: { notes: unknown[] };
    };
    expect(result.structuredContent.notes).toHaveLength(2);
  });

  it("filters by query", async () => {
    store.create({ title: "Alpha", body: "first", tags: [], priority: "low" });
    store.create({ title: "Beta", body: "second", tags: [], priority: "low" });

    const result = (await server.invoke("search-notes", { query: "alpha" })) as {
      structuredContent: { notes: Array<{ title: string }> };
    };
    expect(result.structuredContent.notes).toHaveLength(1);
    expect(result.structuredContent.notes[0]!.title).toBe("Alpha");
  });

  it("paginates results with cursor", async () => {
    for (let i = 0; i < 7; i++) {
      store.create({ title: `Note ${i}`, body: "body", tags: [], priority: "low" });
    }

    const page1 = (await server.invoke("search-notes", { query: "", pageSize: 3 })) as {
      structuredContent: { notes: unknown[]; nextCursor?: string };
    };
    expect(page1.structuredContent.notes).toHaveLength(3);
    expect(page1.structuredContent.nextCursor).toBeDefined();

    const page2 = (await server.invoke("search-notes", {
      query: "",
      pageSize: 3,
      cursor: page1.structuredContent.nextCursor,
    })) as { structuredContent: { notes: unknown[]; nextCursor?: string } };
    expect(page2.structuredContent.notes).toHaveLength(3);
    expect(page2.structuredContent.nextCursor).toBeDefined();

    const page3 = (await server.invoke("search-notes", {
      query: "",
      pageSize: 3,
      cursor: page2.structuredContent.nextCursor,
    })) as { structuredContent: { notes: unknown[]; nextCursor?: string } };
    expect(page3.structuredContent.notes).toHaveLength(1);
    expect(page3.structuredContent.nextCursor).toBeUndefined();
  });

  it("returns structured content with expected fields", async () => {
    store.create({ title: "Structured", body: "body", tags: ["t1"], priority: "high" });

    const result = (await server.invoke("search-notes", { query: "Structured" })) as {
      structuredContent: { notes: Array<{ id: string; title: string; tags: string[]; priority: string; updatedAt: string }> };
    };
    const note = result.structuredContent.notes[0]!;
    expect(note.id).toBeTruthy();
    expect(note.title).toBe("Structured");
    expect(note.tags).toEqual(["t1"]);
    expect(note.priority).toBe("high");
    expect(note.updatedAt).toBeTruthy();
  });

  it("text summary mentions cursor when more pages exist", async () => {
    for (let i = 0; i < 6; i++) {
      store.create({ title: `N${i}`, body: "b", tags: [], priority: "low" });
    }
    const result = (await server.invoke("search-notes", { query: "", pageSize: 3 })) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0]!.text).toContain("cursor");
  });
});
