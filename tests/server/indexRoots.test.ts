import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NotesStore } from "../../src/server/store.js";

function makeServerStub() {
  type Handler = (args: Record<string, unknown>, extra: Record<string, unknown>) => Promise<unknown>;
  const tools = new Map<string, Handler>();
  const listRoots = vi.fn();
  const sendLoggingMessage = vi.fn().mockResolvedValue(undefined);
  return {
    registerTool: (_name: string, _schema: unknown, handler: Handler) => {
      tools.set(_name, handler);
    },
    invoke: (name: string, args: Record<string, unknown>, extra: Record<string, unknown> = {}) => {
      const h = tools.get(name);
      if (!h) throw new Error(`Tool not registered: ${name}`);
      return h(args, extra);
    },
    server: { listRoots },
    sendLoggingMessage,
    _listRoots: listRoots,
  };
}

describe("index-roots tool", () => {
  let tmpDir: string;
  let server: ReturnType<typeof makeServerStub>;
  let store: NotesStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "devnotes-test-"));
    const { registerIndexRootsTool } = await import("../../src/server/tools/indexRoots.js");
    store = new NotesStore();
    server = makeServerStub();
    registerIndexRootsTool(server as unknown as Parameters<typeof registerIndexRootsTool>[0], store);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns error when client does not support roots", async () => {
    server._listRoots.mockRejectedValue(new Error("roots not supported"));

    const result = (await server.invoke("index-roots", {})) as {
      isError: boolean;
      content: Array<{ text: string }>;
    };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("roots");
  });

  it("returns informational message when no roots are exposed", async () => {
    server._listRoots.mockResolvedValue({ roots: [] });

    const result = (await server.invoke("index-roots", {})) as {
      content: Array<{ text: string }>;
    };
    expect(result.content[0]!.text).toContain("didn't expose any roots");
  });

  it("imports .md files from a valid root", async () => {
    await writeFile(path.join(tmpDir, "note1.md"), "# Hello\nThis is a test note.");
    await writeFile(path.join(tmpDir, "note2.md"), "# World\nAnother note.");

    const rootUri = pathToFileURL(tmpDir).href;
    server._listRoots.mockResolvedValue({ roots: [{ uri: rootUri, name: "test-root" }] });

    const result = (await server.invoke("index-roots", {})) as {
      structuredContent: { rootsSeen: number; notesImported: number; importedTitles: string[] };
    };
    expect(result.structuredContent.rootsSeen).toBe(1);
    expect(result.structuredContent.notesImported).toBe(2);
    expect(result.structuredContent.importedTitles).toHaveLength(2);
  });

  it("imports .txt files from a valid root", async () => {
    await writeFile(path.join(tmpDir, "plain.txt"), "Plain text note content.");

    const rootUri = pathToFileURL(tmpDir).href;
    server._listRoots.mockResolvedValue({ roots: [{ uri: rootUri, name: "test-root" }] });

    const result = (await server.invoke("index-roots", {})) as {
      structuredContent: { notesImported: number };
    };
    expect(result.structuredContent.notesImported).toBe(1);
  });

  it("skips non-note files", async () => {
    await writeFile(path.join(tmpDir, "image.png"), "fake image data");
    await writeFile(path.join(tmpDir, "script.js"), "console.log('hi')");
    await writeFile(path.join(tmpDir, "note.md"), "# Real note");

    const rootUri = pathToFileURL(tmpDir).href;
    server._listRoots.mockResolvedValue({ roots: [{ uri: rootUri, name: "test-root" }] });

    const result = (await server.invoke("index-roots", {})) as {
      structuredContent: { notesImported: number };
    };
    expect(result.structuredContent.notesImported).toBe(1);
  });

  it("rejects non-file:// URIs", async () => {
    server._listRoots.mockResolvedValue({ roots: [{ uri: "https://example.com/notes", name: "remote" }] });

    await expect(server.invoke("index-roots", {})).rejects.toThrow("file://");
  });

  it("sends progress notifications when progressToken is present", async () => {
    await writeFile(path.join(tmpDir, "a.md"), "# A");
    await writeFile(path.join(tmpDir, "b.md"), "# B");

    const rootUri = pathToFileURL(tmpDir).href;
    server._listRoots.mockResolvedValue({ roots: [{ uri: rootUri, name: "root" }] });

    const notifications: unknown[] = [];
    const extra = {
      _meta: { progressToken: "tok-1" },
      sendNotification: vi.fn(async (n: unknown) => { notifications.push(n); }),
    };

    await server.invoke("index-roots", {}, extra);
    expect(notifications.length).toBe(2);
    expect((notifications[0] as { method: string }).method).toBe("notifications/progress");
  });

  it("sends logging messages during import", async () => {
    await writeFile(path.join(tmpDir, "note.md"), "# Note");
    const rootUri = pathToFileURL(tmpDir).href;
    server._listRoots.mockResolvedValue({ roots: [{ uri: rootUri }] });

    await server.invoke("index-roots", {});
    expect(server.sendLoggingMessage).toHaveBeenCalledTimes(2);
  });

  it("returns structured content with correct shape", async () => {
    await writeFile(path.join(tmpDir, "x.md"), "# X");
    const rootUri = pathToFileURL(tmpDir).href;
    server._listRoots.mockResolvedValue({ roots: [{ uri: rootUri }] });

    const result = (await server.invoke("index-roots", {})) as {
      structuredContent: { rootsSeen: number; notesImported: number; importedTitles: string[] };
    };
    expect(typeof result.structuredContent.rootsSeen).toBe("number");
    expect(typeof result.structuredContent.notesImported).toBe("number");
    expect(Array.isArray(result.structuredContent.importedTitles)).toBe(true);
  });
});
