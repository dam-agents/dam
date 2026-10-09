import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createImportHandlers } from "../../modules/import/index.js";

// TEST_OVERVIEW: A bundled file import moves each top-level bundle entry into work/. An entry that already exists in work/ is replaced only when the client sends the replace header; otherwise the import is refused with the colliding names and work/ is left untouched.
describe("import finalize", () => {
  let root: string;
  let workDir: string;
  let server: http.Server;
  let url: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "import-finalize-"));
    workDir = join(root, "work");
    mkdirSync(join(workDir, "données", "sub dir"), { recursive: true });
    writeFileSync(join(workDir, "données", "sub dir", "old.txt"), "old");
    writeFileSync(join(workDir, "notes.txt"), "old notes");
    const { handleImport } = createImportHandlers(root, workDir, () => {});
    server = http.createServer((req, res) => void handleImport(req, res));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });
  afterEach(async () => {
    await new Promise((r) => server.close(r));
    await rm(root, { recursive: true, force: true });
  });

  async function post(files: Record<string, string>, replace = false) {
    const src = await mkdtemp(join(root, "src-"));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(join(src, path, ".."), { recursive: true });
      writeFileSync(join(src, path), content);
    }
    const tarPath = join(root, "bundle.tar");
    await create({ file: tarPath, cwd: src }, readdirSync(src));
    const form = new FormData();
    form.set("bundle", new Blob([await readFile(tarPath)]), "bundle.tar");
    const res = await fetch(url, {
      method: "POST",
      body: form,
      headers: replace ? { "x-import-replace": "true" } : {},
    });
    return { status: res.status, body: await res.json() };
  }

  // TEST_SCENARIO: The QA case. A folder upload named like an existing folder must not delete the old folder's files without the user's consent.
  it("refuses a folder that already exists and keeps its contents", async () => {
    const res = await post({ "données/new.txt": "new" });
    expect(res.status).toBe(409);
    expect(res.body.conflicts).toEqual(["données"]);
    expect(existsSync(join(workDir, "données", "sub dir", "old.txt"))).toBe(
      true,
    );
    expect(existsSync(join(workDir, "données", "new.txt"))).toBe(false);
  });

  // TEST_SCENARIO: A loose file with the same name as an existing top-level file is refused the same way, and nothing else in the bundle is moved.
  it("refuses an existing top-level file and moves nothing", async () => {
    const res = await post({ "notes.txt": "new", "fresh.txt": "x" });
    expect(res.status).toBe(409);
    expect(res.body.conflicts).toEqual(["notes.txt"]);
    expect(await readFile(join(workDir, "notes.txt"), "utf8")).toBe(
      "old notes",
    );
    expect(existsSync(join(workDir, "fresh.txt"))).toBe(false);
  });

  // TEST_SCENARIO: After the user confirms, the client sends the replace header and the top-level entry is replaced as one unit.
  it("replaces an existing entry when the replace header is sent", async () => {
    const res = await post({ "données/new.txt": "new" }, true);
    expect(res.status).toBe(200);
    expect(readdirSync(join(workDir, "données"))).toEqual(["new.txt"]);
  });

  // TEST_SCENARIO: An entry with a new name needs no confirmation.
  it("imports a new entry without the replace header", async () => {
    const res = await post({ "other/a.txt": "a" });
    expect(res.status).toBe(200);
    expect(await readFile(join(workDir, "other", "a.txt"), "utf8")).toBe("a");
    expect(existsSync(join(workDir, "données", "sub dir", "old.txt"))).toBe(
      true,
    );
  });
});
