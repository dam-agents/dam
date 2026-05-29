import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";
import { createSessionMetadataStore } from "../../modules/acp/infrastructure/session-metadata-store.js";

describe("createSessionMetadataStore", () => {
  let dir: string;
  let path: string;
  let backend: ReturnType<typeof createFileDocumentStoreBackend>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "session-meta-"));
    path = join(dir, ".platform/session-metadata.json");
    mkdirSync(dirname(path), { recursive: true });
    backend = createFileDocumentStoreBackend(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined for an unknown session", () => {
    const store = createSessionMetadataStore(backend);
    expect(store.get("nope")).toBeUndefined();
    expect(store.all()).toEqual({});
  });

  it("records metadata and stamps createdAt", () => {
    const store = createSessionMetadataStore(
      backend,
      () => "2026-01-01T00:00:00Z",
    );
    store.set("s1", { type: "schedule", scheduleId: "sch-1" });

    expect(store.get("s1")).toEqual({
      meta: { type: "schedule", scheduleId: "sch-1" },
      createdAt: "2026-01-01T00:00:00Z",
    });
  });

  it("preserves createdAt across later metadata writes", () => {
    let clock = "2026-01-01T00:00:00Z";
    const store = createSessionMetadataStore(backend, () => clock);
    store.set("s1", { mode: "chat" });
    clock = "2026-02-02T00:00:00Z";
    store.set("s1", { mode: "terminal" });

    expect(store.get("s1")).toEqual({
      meta: { mode: "terminal" },
      createdAt: "2026-01-01T00:00:00Z",
    });
  });

  it("persists across store instances (survives restart)", () => {
    const a = createSessionMetadataStore(backend, () => "2026-01-01T00:00:00Z");
    a.set("s1", { mode: "chat", threadTs: "1700000000.1" });

    const b = createSessionMetadataStore(backend);
    expect(b.get("s1")).toEqual({
      meta: { mode: "chat", threadTs: "1700000000.1" },
      createdAt: "2026-01-01T00:00:00Z",
    });
  });

  it("records an empty-metadata session distinctly from an absent one", () => {
    const store = createSessionMetadataStore(
      backend,
      () => "2026-01-01T00:00:00Z",
    );
    store.set("s1", {});
    expect(store.get("s1")).toEqual({
      meta: {},
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect(store.get("s2")).toBeUndefined();
  });

  it("ignores a malformed state file and starts empty", () => {
    writeFileSync(path, "{ not json", "utf8");
    const store = createSessionMetadataStore(backend);
    expect(store.all()).toEqual({});
    store.set("s1", { mode: "chat" });
    expect(store.get("s1")?.meta).toEqual({ mode: "chat" });
  });

  it("drops entries missing createdAt when loading from disk", () => {
    writeFileSync(
      path,
      JSON.stringify({
        sessions: {
          good: { meta: { mode: "chat" }, createdAt: "2026-01-01T00:00:00Z" },
          bad: { meta: { mode: "chat" } },
        },
      }),
      "utf8",
    );
    const store = createSessionMetadataStore(backend);
    expect(store.get("good")).toBeDefined();
    expect(store.get("bad")).toBeUndefined();
  });

  it("strips unknown metadata keys when loading from disk", () => {
    writeFileSync(
      path,
      JSON.stringify({
        sessions: {
          s1: {
            meta: { mode: "chat", bogus: 42 },
            createdAt: "2026-01-01T00:00:00Z",
          },
        },
      }),
      "utf8",
    );
    const store = createSessionMetadataStore(backend);
    expect(store.get("s1")?.meta).toEqual({ mode: "chat" });
  });

  it("writes pretty-printed JSON under a created .platform dir", () => {
    const store = createSessionMetadataStore(
      backend,
      () => "2026-01-01T00:00:00Z",
    );
    store.set("s1", { mode: "chat" });
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.sessions.s1.createdAt).toBe("2026-01-01T00:00:00Z");
  });
});
