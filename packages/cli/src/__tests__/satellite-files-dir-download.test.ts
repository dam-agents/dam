import { execFileSync } from "node:child_process";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { CallOutcome } from "../modules/satellite/services/backend.js";
import {
  createFilesBackend,
  DOWNLOAD_TOOL,
} from "../modules/satellite/services/files-backend.js";
import {
  CLAIM_TOKEN,
  fakeFilesTransfer,
  finished,
  jsonOf,
  sha256,
  tarEntriesOf,
} from "./satellite-files-fixtures.js";

const hooks = vi.hoisted(() => ({
  shrink: null as null | string,
}));

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    async open(...args: Parameters<typeof fs.open>) {
      const handle = await fs.open(...args);
      if (hooks.shrink === null || hooks.shrink !== args[0]) return handle;
      const target = hooks.shrink;
      hooks.shrink = null;
      const read = handle.read.bind(handle);
      handle.read = (async (...rest: Parameters<typeof read>) => {
        await fs.truncate(target, 2);
        return read(...rest);
      }) as typeof handle.read;
      return handle;
    },
  };
});

/**
 * TEST_OVERVIEW: A directory download moves a whole tree as one uncompressed tar
 * and keeps the file's own name, so the agent unpacks it with `tar -xf <path>`.
 * The walk is `list`'s — every directory proved before it is entered, a link
 * never followed — and each file is opened the way a single-file download opens
 * one, then read to exactly the size its descriptor reported. Links, special
 * files and hard-linked files are left out and named in `skipped`; the transfer
 * declares no length because the tar's size is known only as it is built; and a
 * tree that is too large is refused before the first byte, while a file that
 * shrinks under the read fails the transfer instead of landing a short tar.
 */

const LIMIT = 4;

let dir: string;
let root: string;

function backendOf(
  transfer: ReturnType<typeof fakeFilesTransfer>,
  maxBytes?: number,
) {
  return createFilesBackend({
    root,
    allowUpload: false,
    transfer,
    ...(maxBytes === undefined ? {} : { maxBytes }),
  });
}

async function callWith(
  path: string,
  options: {
    transfer?: ReturnType<typeof fakeFilesTransfer>;
    maxBytes?: number;
    args?: Record<string, unknown>;
    sequence?: number;
  } = {},
): Promise<{
  outcome: CallOutcome;
  transfer: ReturnType<typeof fakeFilesTransfer>;
}> {
  const transfer = options.transfer ?? fakeFilesTransfer();
  const outcome = await backendOf(transfer, options.maxBytes).call({
    sequence: options.sequence ?? 1,
    tool: DOWNLOAD_TOOL,
    args: { path, ...options.args },
    transferToken: CLAIM_TOKEN,
  });
  return { outcome, transfer };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dam-satellite-dir-down-"));
  const docs = join(dir, "docs");
  await mkdir(join(docs, "sub"), { recursive: true });
  await writeFile(join(docs, "a.txt"), "alpha\n");
  await writeFile(join(docs, "run.sh"), "#!/bin/sh\n", { mode: 0o755 });
  await writeFile(join(docs, "sub", "b.txt"), "beta\n");
  await writeFile(join(docs, "dup.txt"), "dup\n");
  await link(join(docs, "dup.txt"), join(docs, "dup2.txt"));
  await symlink(join(docs, "a.txt"), join(docs, "latest"));
  execFileSync("mkfifo", [join(docs, "sock")]);
  await mkdir(join(dir, "empty"));
  root = await realpath(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a directory download", () => {
  it("sends one tar of its regular files that tar -xf unpacks back into the tree", async () => {
    const { outcome, transfer } = await callWith("docs");
    const result = jsonOf(outcome);

    expect(transfer.sent).toHaveLength(1);
    const tar = transfer.sent[0]?.bytes ?? Buffer.alloc(0);
    expect(transfer.sent[0]?.declaredBytes).toBeUndefined();
    expect(result).toEqual({
      path: "/home/agent/.dam/satellite-files/laptop-7-eeeeeeee/app.bin",
      size: tar.length,
      sha256: sha256(tar),
      format: "tar",
      files: 3,
      skipped: expect.any(Array),
    });

    const entries = await tarEntriesOf(tar);
    expect(entries.map((entry) => entry.name).sort()).toEqual([
      "a.txt",
      "run.sh",
      "sub/b.txt",
    ]);
    expect(
      Object.fromEntries(
        entries.map((entry) => [entry.name, entry.body.toString()]),
      ),
    ).toEqual({
      "a.txt": "alpha\n",
      "run.sh": "#!/bin/sh\n",
      "sub/b.txt": "beta\n",
    });
    expect(
      Object.fromEntries(entries.map((entry) => [entry.name, entry.mode])),
    ).toEqual({ "a.txt": 0o644, "run.sh": 0o755, "sub/b.txt": 0o644 });

    const unpacked = join(dir, "unpacked");
    const tarPath = join(dir, "docs.tar");
    await writeFile(tarPath, tar);
    await mkdir(unpacked);
    execFileSync("tar", ["-xf", tarPath, "-C", unpacked]);
    expect(await readFile(join(unpacked, "sub", "b.txt"), "utf8")).toBe(
      "beta\n",
    );
  });

  it("names every link, special file and hard link it left out", async () => {
    const { outcome } = await callWith("docs");
    const skipped = jsonOf(outcome).skipped as string[];

    expect(skipped.sort()).toEqual([
      "dup.txt (hard link)",
      "dup2.txt (hard link)",
      "latest (link)",
      "sock (other)",
    ]);
  });

  it("sends an empty tar for a directory with no regular files", async () => {
    const { outcome, transfer } = await callWith("empty");
    const result = jsonOf(outcome);

    expect(result.files).toBe(0);
    expect(result.skipped).toEqual([]);
    expect(result.format).toBe("tar");
    expect(
      await tarEntriesOf(transfer.sent[0]?.bytes ?? Buffer.alloc(0)),
    ).toEqual([]);
  });

  it("says in the worker log that a directory comes down as a tar", async () => {
    const backend = backendOf(fakeFilesTransfer());

    expect(backend.describeCall(DOWNLOAD_TOOL, { path: "docs" })).toBe(
      "download docs/ (tar)",
    );
    expect(backend.describeCall(DOWNLOAD_TOOL, { path: "docs/a.txt" })).toBe(
      "download docs/a.txt",
    );
  });

  it("refuses a directory whose files total over the cap before a byte moves", async () => {
    const { outcome, transfer } = await callWith("docs", { maxBytes: LIMIT });

    expect(finished(outcome).isError).toBe(true);
    expect(finished(outcome).output).toContain("limit");
    expect(transfer.sent).toHaveLength(0);
  });

  it("refuses offset or length for a directory", async () => {
    for (const args of [{ offset: 0 }, { length: 10 }, { offset: -10 }]) {
      const { outcome, transfer } = await callWith("docs", {
        args,
        maxBytes: 1024 * 1024,
      });
      expect(finished(outcome).isError).toBe(true);
      expect(finished(outcome).output).toContain("directory");
      expect(transfer.sent).toHaveLength(0);
    }
  });

  it("refuses a link as the directory itself", async () => {
    await symlink(join(root, "docs"), join(root, "docs-link"));
    const { outcome, transfer } = await callWith("docs-link");

    expect(finished(outcome).isError).toBe(true);
    expect(transfer.sent).toHaveLength(0);
  });

  /**
   * TEST_SCENARIO: The walk measures the file, the verified open reports its size
   * again, and only then does the read begin. A file that is truncated in that
   * window hands back fewer bytes than the tar header declared, and a tar with a
   * short entry is corrupt: the transfer has to fail rather than land a file whose
   * size no longer matches what the Agent was told.
   */
  it("fails the transfer when a file shrinks while it is read", async () => {
    const growing = join(root, "shrinking");
    await mkdir(growing);
    await writeFile(join(growing, "log.txt"), "0123456789");
    hooks.shrink = join(growing, "log.txt");

    const { outcome } = await callWith("shrinking");
    expect(finished(outcome).isError).toBe(true);
  });

  it("refuses a tree deeper than the walk follows before a byte moves", async () => {
    let path = join(root, "deep");
    for (let level = 0; level < 40; level++) {
      path = join(path, `l${level}`);
    }
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "bottom.txt"), "bottom\n");

    const { outcome, transfer } = await callWith("deep");
    expect(finished(outcome).isError).toBe(true);
    expect(finished(outcome).output).toContain("deeper than 32 levels");
    expect(transfer.sent).toHaveLength(0);
  });

  it("refuses a tree with more entries than the walk counts before a byte moves", async () => {
    const many = join(root, "many");
    await mkdir(many);
    for (let index = 0; index < 10_001; index++)
      await writeFile(join(many, `f${index}`), "");
    const { outcome, transfer } = await callWith("many");

    expect(finished(outcome).isError).toBe(true);
    expect(finished(outcome).output).toContain("more than 10000 entries");
    expect(transfer.sent).toHaveLength(0);
  }, 60_000);
});
