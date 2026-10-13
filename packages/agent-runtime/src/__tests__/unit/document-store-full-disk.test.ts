import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createFileDocumentStoreBackend } from "../../core/document-store.js";

vi.mock("node:fs", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:fs")>();
  return { ...real, writeFileSync: vi.fn(real.writeFileSync) };
});

/**
 * TEST_OVERVIEW: on a full home volume a state write must not take the
 * runtime down, since the runtime is what serves the file browser a user
 * needs to free space. The write keeps the value in memory, leaves the last
 * saved file and no temp file behind, and any other write error still throws.
 */

function fail(code: string): never {
  throw Object.assign(new Error(`${code}: write`), { code });
}

describe("file document store on a full disk", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(join(tmpdir(), "doc-store-full-"));
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    vi.mocked(fs.writeFileSync).mockClear();
  });

  const open = () =>
    createFileDocumentStoreBackend(home).open("doc", {
      schema: z.object({ count: z.number() }),
      initial: () => ({ count: 0 }),
    });

  it("keeps the value in memory and the last saved file on disk", () => {
    const store = open();
    store.write({ count: 1 });
    vi.mocked(fs.writeFileSync).mockImplementationOnce((path) => {
      fs.appendFileSync(path as string, "{");
      fail("ENOSPC");
    });

    expect(() => store.write({ count: 2 })).not.toThrow();
    expect(store.read()).toEqual({ count: 2 });
    expect(open().read()).toEqual({ count: 1 });
    expect(fs.readdirSync(join(home, ".platform"))).toEqual(["doc.json"]);
  });

  it("still throws any other write error", () => {
    const store = open();
    vi.mocked(fs.writeFileSync).mockImplementationOnce(() => fail("EACCES"));
    expect(() => store.write({ count: 1 })).toThrow("EACCES");
  });
});
