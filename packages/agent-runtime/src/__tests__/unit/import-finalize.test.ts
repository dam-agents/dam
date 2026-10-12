import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createImportHandlers } from "../../modules/import/index.js";

// TEST_OVERVIEW: A bundled file import merges each top-level bundle entry into work/. Folders are merged recursively: files are added or replaced, existing files not in the bundle are kept.
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

  async function post(files: Record<string, string>) {
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
    });
    return { status: res.status, body: await res.json() };
  }

  // TEST_SCENARIO: Uploading a folder with the same name merges the contents — new files are added, existing files are kept.
  it("merges a folder that already exists, keeping existing files", async () => {
    const res = await post({ "données/new.txt": "new" });
    expect(res.status).toBe(200);
    expect(existsSync(join(workDir, "données", "sub dir", "old.txt"))).toBe(
      true,
    );
    expect(await readFile(join(workDir, "données", "new.txt"), "utf8")).toBe(
      "new",
    );
  });

  // TEST_SCENARIO: A file with the same name as an existing file replaces it.
  it("replaces an existing file with the same name", async () => {
    const res = await post({ "notes.txt": "new notes" });
    expect(res.status).toBe(200);
    expect(await readFile(join(workDir, "notes.txt"), "utf8")).toBe(
      "new notes",
    );
  });

  // TEST_SCENARIO: A file in the bundle replaces an existing file in a nested folder.
  it("replaces a file in a nested folder", async () => {
    const res = await post({ "données/sub dir/old.txt": "updated" });
    expect(res.status).toBe(200);
    expect(
      await readFile(join(workDir, "données", "sub dir", "old.txt"), "utf8"),
    ).toBe("updated");
  });

  // TEST_SCENARIO: An entry with a new name is added without affecting existing entries.
  it("imports a new entry without affecting existing entries", async () => {
    const res = await post({ "other/a.txt": "a" });
    expect(res.status).toBe(200);
    expect(await readFile(join(workDir, "other", "a.txt"), "utf8")).toBe("a");
    expect(existsSync(join(workDir, "données", "sub dir", "old.txt"))).toBe(
      true,
    );
    expect(await readFile(join(workDir, "notes.txt"), "utf8")).toBe(
      "old notes",
    );
  });

  // TEST_SCENARIO: Directory collisions must reject the whole import before any workspace entry changes.
  it.each(["données", "données/sub dir"])(
    "refuses a file replacing directory %s without changing the workspace",
    async (path) => {
      mkdirSync(join(workDir, "z-empty"));
      const res = await post({
        "a-new.txt": "new",
        "notes.txt": "new notes",
        [path]: "now a file",
        "z-empty": "another collision",
      });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain(path);
      expect(res.body.error).toContain("z-empty");
      expect(
        await readFile(join(workDir, "données", "sub dir", "old.txt"), "utf8"),
      ).toBe("old");
      expect(await readFile(join(workDir, "notes.txt"), "utf8")).toBe(
        "old notes",
      );
      expect(readdirSync(join(workDir, "z-empty"))).toEqual([]);
      expect(existsSync(join(workDir, "a-new.txt"))).toBe(false);
      expect(
        readdirSync(root).some((name) => name.startsWith(".import-")),
      ).toBe(false);
      expect((await post({ "retry.txt": "retry" })).status).toBe(200);
    },
  );
});
