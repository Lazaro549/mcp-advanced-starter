import { randomUUID } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Priority = "low" | "medium" | "high";

export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  priority: Priority;
  createdAt: string;
  updatedAt: string;
  /** file:// root this note was imported from, if any (see importFromRoot). */
  sourceRoot?: string;
}

// Conservative safety caps for the roots-import feature. The server is being
// handed a real filesystem path by the client (see tools/indexRoots.ts) — it
// should behave like a good guest: read a little, not everything.
const NOTE_FILE_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const MAX_FILES_PER_ROOT = 200;
const MAX_FILE_BYTES = 200_000;

/**
 * A tiny in-memory notes store. Not persistent, not concurrent-safe beyond a
 * single Node process — intentionally simple so the MCP-specific code in
 * tools/ and createServer.ts stays the focus of this repo.
 */
export class NotesStore {
  private notes = new Map<string, Note>();

  create(input: Omit<Note, "id" | "createdAt" | "updatedAt">): Note {
    const now = new Date().toISOString();
    const note: Note = { ...input, id: randomUUID(), createdAt: now, updatedAt: now };
    this.notes.set(note.id, note);
    return note;
  }

  get(id: string): Note | undefined {
    return this.notes.get(id);
  }

  update(id: string, patch: Partial<Pick<Note, "title" | "body" | "tags" | "priority">>): Note | undefined {
    const existing = this.notes.get(id);
    if (!existing) return undefined;
    const updated: Note = { ...existing, ...patch, updatedAt: new Date().toISOString() };
    this.notes.set(id, updated);
    return updated;
  }

  all(): Note[] {
    return [...this.notes.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /**
   * Cursor-based search. The cursor is an opaque, stringified offset — the
   * same shape MCP itself uses for `nextCursor` on resources/list, tools/list,
   * etc. A caller should never parse it, only pass it back verbatim.
   */
  search(query: string, opts: { cursor?: string; pageSize?: number } = {}): { page: Note[]; nextCursor?: string } {
    const pageSize = opts.pageSize ?? 5;
    const offset = opts.cursor ? Number.parseInt(opts.cursor, 10) || 0 : 0;
    const q = query.trim().toLowerCase();

    const matches = this.all().filter(
      (n) =>
        q.length === 0 ||
        n.title.toLowerCase().includes(q) ||
        n.body.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
    );

    const page = matches.slice(offset, offset + pageSize);
    const nextOffset = offset + pageSize;
    return { page, nextCursor: nextOffset < matches.length ? String(nextOffset) : undefined };
  }

  /**
   * Roots demo: the *client* decides which local folders the server may read
   * (a "root"), and hands over a file:// URI for each one — the server never
   * sees or requests a path on its own. This walks one root, one directory
   * level deep, importing matching files as notes.
   *
   * `onFile` is called after each file is read so callers can turn this into
   * progress notifications (see tools/indexRoots.ts).
   */
  async importFromRoot(
    rootUri: string,
    onFile?: (fileName: string, index: number, total: number) => Promise<void> | void
  ): Promise<Note[]> {
    if (!rootUri.startsWith("file://")) {
      throw new Error(`Only file:// roots are supported, got: ${rootUri}`);
    }

    const rootPath = fileURLToPath(rootUri);
    const entries = await readdir(rootPath, { withFileTypes: true });
    const candidates = entries
      .filter((e) => e.isFile() && NOTE_FILE_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
      .slice(0, MAX_FILES_PER_ROOT);

    const imported: Note[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const entry = candidates[i]!;
      const fullPath = path.join(rootPath, entry.name);
      const stats = await stat(fullPath);
      if (stats.size > MAX_FILE_BYTES) continue;

      const body = await readFile(fullPath, "utf8");
      const note = this.create({
        title: entry.name.replace(path.extname(entry.name), ""),
        body,
        tags: ["imported"],
        priority: "low",
        sourceRoot: rootUri,
      });
      imported.push(note);
      await onFile?.(entry.name, i + 1, candidates.length);
    }
    return imported;
  }
}
