import { describe, it, expect, beforeEach } from "vitest";
import { NotesStore } from "../../src/server/store.js";

describe("NotesStore", () => {
  let store: NotesStore;

  beforeEach(() => {
    store = new NotesStore();
  });

  describe("create", () => {
    it("creates a note with generated id and timestamps", () => {
      const note = store.create({ title: "T", body: "B", tags: [], priority: "low" });
      expect(note.id).toBeTruthy();
      expect(note.title).toBe("T");
      expect(note.body).toBe("B");
      expect(note.priority).toBe("low");
      expect(note.createdAt).toBeTruthy();
      expect(note.updatedAt).toBeTruthy();
    });

    it("assigns unique ids to each note", () => {
      const a = store.create({ title: "A", body: "a", tags: [], priority: "low" });
      const b = store.create({ title: "B", body: "b", tags: [], priority: "low" });
      expect(a.id).not.toBe(b.id);
    });
  });

  describe("get", () => {
    it("returns the note by id", () => {
      const note = store.create({ title: "T", body: "B", tags: [], priority: "medium" });
      expect(store.get(note.id)).toEqual(note);
    });

    it("returns undefined for unknown id", () => {
      expect(store.get("nonexistent")).toBeUndefined();
    });
  });

  describe("update", () => {
    it("patches fields and updates updatedAt", async () => {
      const note = store.create({ title: "Old", body: "B", tags: [], priority: "low" });
      await new Promise((r) => setTimeout(r, 2)); // ensure time advances
      const updated = store.update(note.id, { title: "New" });
      expect(updated?.title).toBe("New");
      expect(updated?.body).toBe("B");
      expect(updated?.updatedAt).not.toBe(note.updatedAt);
    });

    it("returns undefined for unknown id", () => {
      expect(store.update("nonexistent", { title: "X" })).toBeUndefined();
    });
  });

  describe("search", () => {
    beforeEach(() => {
      store.create({ title: "Alpha note", body: "content about alpha", tags: ["a"], priority: "low" });
      store.create({ title: "Beta note", body: "content about beta", tags: ["b"], priority: "medium" });
      store.create({ title: "Gamma note", body: "content about gamma", tags: ["c"], priority: "high" });
    });

    it("returns all notes for empty query", () => {
      const { page } = store.search("");
      expect(page.length).toBe(3);
    });

    it("filters by title match", () => {
      const { page } = store.search("alpha");
      expect(page.length).toBe(1);
      expect(page[0]!.title).toBe("Alpha note");
    });

    it("filters by body match", () => {
      const { page } = store.search("beta");
      expect(page.length).toBe(1);
    });

    it("filters by tag match", () => {
      const { page } = store.search("c");
      expect(page.length).toBeGreaterThanOrEqual(1);
      expect(page.some((n) => n.tags.includes("c"))).toBe(true);
    });

    it("returns empty page for no match", () => {
      const { page } = store.search("zzznomatch");
      expect(page).toEqual([]);
    });

    it("paginates with cursor", () => {
      // 3 notes, pageSize=2 → first page has 2, nextCursor set
      const first = store.search("", { pageSize: 2 });
      expect(first.page.length).toBe(2);
      expect(first.nextCursor).toBeDefined();

      // second page has 1, no nextCursor
      const second = store.search("", { pageSize: 2, cursor: first.nextCursor });
      expect(second.page.length).toBe(1);
      expect(second.nextCursor).toBeUndefined();
    });

    it("returns no nextCursor when all results fit in one page", () => {
      const { nextCursor } = store.search("", { pageSize: 10 });
      expect(nextCursor).toBeUndefined();
    });
  });
});
