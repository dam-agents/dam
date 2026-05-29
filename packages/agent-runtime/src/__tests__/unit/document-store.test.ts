import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";

const docSchema = z.object({ count: z.number() });
type Doc = z.infer<typeof docSchema>;

describe("file document store backend", () => {
  let home: string;
  let path: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "doc-store-"));
    path = join(home, ".platform", "doc.json");
    mkdirSync(dirname(path), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const open = () =>
    createFileDocumentStoreBackend(home).open("doc", {
      schema: docSchema,
      initial: () => ({ count: 0 }),
    });

  it("returns initial when the file is missing", () => {
    expect(open().read()).toEqual({ count: 0 });
  });

  it("maps the name to <home>/.platform/<name>.json", () => {
    open().write({ count: 7 });
    expect(existsSync(path)).toBe(true);
    expect(open().read()).toEqual({ count: 7 });
  });

  it("serves reads from cache without re-reading disk", () => {
    const s = open();
    s.read();
    writeFileSync(path, JSON.stringify({ count: 99 }));
    expect(s.read()).toEqual({ count: 0 });
  });

  it("falls back to initial on a schema-rejected document", () => {
    writeFileSync(path, JSON.stringify({ unexpected: true }));
    expect(open().read()).toEqual({ count: 0 });
  });

  it("falls back to initial on malformed JSON", () => {
    writeFileSync(path, "{ not json");
    expect(open().read()).toEqual({ count: 0 });
  });

  it("writes atomically — no torn file and no leftover temp", () => {
    const s = open();
    s.write({ count: 1 });
    s.write({ count: 2 });
    expect(readdirSync(dirname(path))).toEqual(["doc.json"]);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    expect(open().read()).toEqual({ count: 2 });
  });
});
