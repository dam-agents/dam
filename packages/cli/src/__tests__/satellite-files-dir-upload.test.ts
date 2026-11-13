import { gzipSync } from "node:zlib";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Readable } from "node:stream";
import {
  afterEach,
  beforeAll,
  afterAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const hooks = vi.hoisted(() => ({
  failChmod: false,
  cancelOnSync: false,
  cancel: null as null | (() => void),
  handles: [] as { fd: number }[],
}));

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    async open(...args: Parameters<typeof fs.open>) {
      const handle = await fs.open(...args);
      hooks.handles.push(handle as unknown as { fd: number });
      if (hooks.failChmod)
        handle.chmod = (async () => {
          throw new Error("the mode could not be set");
        }) as typeof handle.chmod;
      if (hooks.cancelOnSync) {
        const sync = handle.sync.bind(handle);
        handle.sync = (async () => {
          await sync();
          if (hooks.cancelOnSync) {
            hooks.cancelOnSync = false;
            hooks.cancel?.();
          }
        }) as typeof handle.sync;
      }
      return handle;
    },
  };
});
import type { CallOutcome } from "../modules/satellite/services/backend.js";
import {
  discardDirInRoot,
  publishDirInRoot,
  stageDirInRoot,
} from "../modules/satellite/services/confined-files.js";
import {
  createFilesBackend,
  UPLOAD_TOOL,
} from "../modules/satellite/services/files-backend.js";
import {
  CLAIM_TOKEN,
  fakeFilesTransfer,
  finished,
  jsonOf,
  sha256,
  tarOf,
} from "./satellite-files-fixtures.js";

/**
 * TEST_OVERVIEW: A directory upload takes the tar an agent made in its workspace
 * and unpacks it onto the machine under one new name. Every entry is checked
 * before any of it is written: only regular files and directories are created,
 * each name must be a relative path with no `..`, `.`, empty segment, backslash
 * or NUL, and the entry count, the depth and the transfer limit all bound it. The
 * whole tree is unpacked into a staging directory beside the destination and
 * published with one rename, so any refusal, a body that is not a tar, a stream
 * cut short, a full disk or a cancelled Job leaves no destination and no staging
 * directory behind, and an existing destination is refused before a byte is
 * received.
 */

let dir: string;
let root: string;
let sequence = 0;

function backendOf(options: {
  transfer: ReturnType<typeof fakeFilesTransfer>;
  allowUpload?: boolean;
  maxBytes?: number;
  freeBytes?: (dir: string) => number | null;
}) {
  return createFilesBackend({
    root,
    allowUpload: options.allowUpload ?? true,
    transfer: options.transfer,
    ...(options.maxBytes === undefined ? {} : { maxBytes: options.maxBytes }),
    ...(options.freeBytes === undefined
      ? {}
      : { freeBytes: options.freeBytes }),
  });
}

async function upload(
  tar: Buffer,
  args: Record<string, unknown> = {},
  options: {
    allowUpload?: boolean;
    maxBytes?: number;
    freeBytes?: (dir: string) => number | null;
    transfer?: ReturnType<typeof fakeFilesTransfer>;
  } = {},
): Promise<{
  outcome: CallOutcome;
  transfer: ReturnType<typeof fakeFilesTransfer>;
}> {
  const transfer = options.transfer ?? fakeFilesTransfer({ receives: tar });
  sequence += 1;
  const outcome = await backendOf({ ...options, transfer }).call({
    sequence,
    tool: UPLOAD_TOOL,
    args: {
      path: "tree",
      workspacePath: "out/tree.tar",
      unpack: true,
      ...args,
    },
    transferToken: CLAIM_TOKEN,
  });
  return { outcome, transfer };
}

function expectAllClosed(): void {
  expect(hooks.handles.map((handle) => handle.fd)).toEqual(
    hooks.handles.map(() => -1),
  );
  hooks.handles.length = 0;
}

function tarOfDirectoryWithSize(size: number): Buffer {
  const header = Buffer.alloc(512);
  header.write("d/", 0, "ascii");
  header.write("0000755\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(`${size.toString(8).padStart(11, "0")}\0`, 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = 0x35;
  header.write("ustar\0" + "00", 257, "ascii");
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148, "ascii");
  return Buffer.concat([header, Buffer.alloc(512), Buffer.alloc(1024)]);
}

async function staging(dirToCheck: string): Promise<string[]> {
  const names = await readdir(dirToCheck).catch(() => [] as string[]);
  return names.filter((name) => name.includes(".incoming-"));
}

async function exists(path: string): Promise<boolean> {
  return (await lstat(path).catch(() => null)) !== null;
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dam-satellite-dir-up-"));
  root = await realpath(dir);
});

afterEach(async () => {
  for (const name of await readdir(root))
    await rm(join(root, name), { recursive: true, force: true });
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a directory upload", () => {
  it("creates the tree under its name, with the modes the tar carried", async () => {
    const tar = await tarOf([
      { name: "notes.txt", body: "notes\n" },
      { name: "run.sh", body: "#!/bin/sh\n", mode: 0o755 },
      { name: "sub/", type: "directory", mode: 0o755 },
      { name: "sub/deep.txt", body: "deep\n" },
    ]);
    const { outcome, transfer } = await upload(tar, { path: "copied/tree" });

    expect(transfer.received).toEqual([{ sequence, token: CLAIM_TOKEN }]);
    expect(jsonOf(outcome)).toEqual({
      path: "copied/tree",
      files: 3,
      dirs: 1,
      bytes: 21,
      sha256: sha256(tar),
    });
    expect(
      await readFile(join(root, "copied", "tree", "notes.txt"), "utf8"),
    ).toBe("notes\n");
    expect(await readFile(join(root, "copied", "tree", "run.sh"), "utf8")).toBe(
      "#!/bin/sh\n",
    );
    expect(
      await readFile(join(root, "copied", "tree", "sub", "deep.txt"), "utf8"),
    ).toBe("deep\n");
    expect(
      (await lstat(join(root, "copied", "tree", "notes.txt"))).mode & 0o777,
    ).toBe(0o600);
    expect(
      (await lstat(join(root, "copied", "tree", "run.sh"))).mode & 0o777,
    ).toBe(0o700);
    expect(await readdir(join(root, "copied"))).toEqual(["tree"]);
    expect(await staging(join(root, "copied"))).toEqual([]);
  });

  it("says in the worker log that the upload unpacks", async () => {
    const backend = backendOf({ transfer: fakeFilesTransfer() });

    expect(
      backend.describeCall(UPLOAD_TOOL, {
        path: "tree",
        workspacePath: "out/tree.tar",
        unpack: true,
      }),
    ).toBe("upload out/tree.tar → tree/ (unpack)");
    expect(
      backend.describeCall(UPLOAD_TOOL, {
        path: "tree/x",
        workspacePath: "out/x.tar",
      }),
    ).toBe("upload out/x.tar → tree/x");
  });

  it("refuses every entry type a directory upload will not create and leaves nothing", async () => {
    for (const type of [
      "symlink",
      "link",
      "character-device",
      "block-device",
      "fifo",
    ] as const) {
      const tar = await tarOf([
        { name: "keep/", type: "directory" },
        {
          name: "keep/x",
          type,
          ...(type === "symlink" ? { linkname: "/etc/passwd" } : {}),
        },
      ]);
      const { outcome, transfer } = await upload(tar);

      const done = finished(outcome);
      expect(done.isError).toBe(true);
      expect(done.blocked).toBe(true);
      expect(done.output).toContain('"keep/x"');
      expect(await exists(join(root, "tree"))).toBe(false);
      expect(await staging(root)).toEqual([]);
      expect(transfer.received).toHaveLength(1);
    }
  });

  it("refuses a name that is not one relative segment per level and leaves nothing", async () => {
    for (const name of ["../x", "/abs", "a//b", "a\\b"]) {
      const tar = await tarOf([{ name, body: "x" }]);
      const { outcome } = await upload(tar);

      const done = finished(outcome);
      expect(done.isError).toBe(true);
      expect(done.blocked).toBe(true);
      expect(done.output).toContain(JSON.stringify(name));
      expect(await exists(join(root, "tree"))).toBe(false);
      expect(await staging(root)).toEqual([]);
    }
  });

  /**
   * TEST_SCENARIO: A tar header holds a name as a NUL-terminated string, so a NUL
   * the Agent typed in a name is gone before the machine sees the entry: the
   * upload lands the part before it, and no walk ever receives a name the
   * segments check would have to refuse for it.
   */
  it("cannot carry a NUL in a name: the tar format stops at it", async () => {
    const tar = await tarOf([{ name: "a\0b", body: "x" }]);
    const { outcome } = await upload(tar);

    expect(jsonOf(outcome).files).toBe(1);
    expect(await readdir(join(root, "tree"))).toEqual(["a"]);
  });

  it("refuses a duplicate file name, a file where a directory was, and a directory where a file was", async () => {
    const tars = [
      await tarOf([
        { name: "x", body: "one" },
        { name: "x", body: "two" },
      ]),
      await tarOf([
        { name: "x", body: "one" },
        { name: "x/", type: "directory" },
      ]),
      await tarOf([
        { name: "x/", type: "directory" },
        { name: "x", body: "one" },
      ]),
    ];
    for (const tar of tars) {
      const { outcome } = await upload(tar);

      const done = finished(outcome);
      expect(done.isError).toBe(true);
      expect(done.output).toContain('"x"');
      expect(await exists(join(root, "tree"))).toBe(false);
      expect(await staging(root)).toEqual([]);
    }
  });

  it("refuses an entry deeper than the limit and leaves nothing", async () => {
    const deep = `${Array.from({ length: 33 }, (_, level) => `l${level}`).join("/")}/x`;
    const { outcome } = await upload(await tarOf([{ name: deep, body: "x" }]));

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.output).toContain("levels deep");
    expect(await exists(join(root, "tree"))).toBe(false);
    expect(await staging(root)).toEqual([]);
  });

  it("refuses a tar with more entries than the limit and leaves nothing", async () => {
    const tar = await tarOf(
      Array.from({ length: 10_001 }, (_, index) => ({
        name: `d${index}/`,
        type: "directory" as const,
      })),
    );
    const { outcome } = await upload(tar);

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.output).toContain("more than 10000 entries");
    expect(await exists(join(root, "tree"))).toBe(false);
    expect(await staging(root)).toEqual([]);
  }, 60_000);

  it("refuses a cap exceeded mid-stream and leaves nothing", async () => {
    const tar = await tarOf([
      { name: "small.txt", body: "1234" },
      { name: "big.txt", body: "x".repeat(64) },
    ]);
    const { outcome } = await upload(tar, {}, { maxBytes: 8 });

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.output).toContain("limit");
    expect(await exists(join(root, "tree"))).toBe(false);
    expect(await staging(root)).toEqual([]);
  });

  it("counts the tar's own bytes against the limit, not only what it unpacks to", async () => {
    const tar = await tarOf([
      { name: "a", body: "" },
      { name: "b", body: "" },
    ]);
    const { outcome } = await upload(tar, {}, { maxBytes: 600 });

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.output).toContain(
      "the tar is over the 600 byte transfer limit",
    );
    expect(await exists(join(root, "tree"))).toBe(false);
    expect(await staging(root)).toEqual([]);
  });

  it("refuses a body that is not a tar and leaves nothing", async () => {
    const tar = await tarOf([{ name: "x", body: "x" }]);
    const { outcome } = await upload(gzipSync(tar));

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.output).toContain("not a tar archive");
    expect(await exists(join(root, "tree"))).toBe(false);
    expect(await staging(root)).toEqual([]);
  });

  it("refuses a stream cut short and leaves nothing", async () => {
    const tar = await tarOf([{ name: "x", body: "x".repeat(2048) }]);
    const { outcome } = await upload(tar.subarray(0, 1024));

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.output).toContain("not a tar archive");
    expect(await exists(join(root, "tree"))).toBe(false);
    expect(await staging(root)).toEqual([]);
  });

  it("publishes nothing when the job is cancelled mid-stream", async () => {
    const tar = await tarOf([{ name: "x", body: "x".repeat(4096) }]);
    let backend: ReturnType<typeof backendOf> | null = null;
    const transfer = fakeFilesTransfer();
    transfer.receive = () => {
      const stream = Readable.from(
        (async function* () {
          yield tar.subarray(0, 1024);
          backend?.cancel(sequence);
          yield tar.subarray(1024);
        })(),
      );
      return Promise.resolve({ stream, size: tar.length });
    };
    sequence += 1;
    backend = backendOf({ transfer });

    const outcome = await backend.call({
      sequence,
      tool: UPLOAD_TOOL,
      args: { path: "tree", workspacePath: "out/tree.tar", unpack: true },
      transferToken: CLAIM_TOKEN,
    });

    expect(outcome.status).toBe("cancelled");
    expect(await exists(join(root, "tree"))).toBe(false);
    expect(await staging(root)).toEqual([]);
  });

  it("refuses a directory entry that appears twice", async () => {
    const tar = await tarOf([
      { name: "d/", type: "directory" },
      { name: "d/", type: "directory" },
    ]);
    const { outcome } = await upload(tar);

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.blocked).toBe(true);
    expect(done.output).toContain('"d"');
    expect(done.output).toContain("appears twice");
    expect(await exists(join(root, "tree"))).toBe(false);
    expect(await staging(root)).toEqual([]);
  });

  it("refuses a directory entry that declares a size", async () => {
    const { outcome } = await upload(tarOfDirectoryWithSize(10));

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.blocked).toBe(true);
    expect(done.output).toContain("declares 10 bytes");
    expect(await exists(join(root, "tree"))).toBe(false);
    expect(await staging(root)).toEqual([]);
  });

  it("refuses a body that holds no archive at all", async () => {
    const { outcome } = await upload(Buffer.alloc(0));

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.output).toContain("empty");
    expect(await exists(join(root, "tree"))).toBe(false);
    expect(await staging(root)).toEqual([]);
  });

  it("makes an empty directory from an empty but well-formed tar", async () => {
    const tar = Buffer.alloc(1024);
    const { outcome } = await upload(tar);

    expect(jsonOf(outcome)).toEqual({
      path: "tree",
      files: 0,
      dirs: 0,
      bytes: 0,
      sha256: sha256(tar),
    });
    expect(await readdir(join(root, "tree"))).toEqual([]);
  });

  it("shortens the entry name it names in a refusal", async () => {
    const long = "n".repeat(200_000);
    const { outcome } = await upload(await tarOf([{ name: long, body: "x" }]));

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.blocked).toBe(true);
    expect(done.output.length).toBeLessThan(2000);
    expect(done.output).toContain("…");
    expect(await exists(join(root, "tree"))).toBe(false);
  });

  it("closes a staged file when its mode cannot be set", async () => {
    hooks.failChmod = true;
    const { outcome } = await upload(await tarOf([{ name: "x", body: "x" }]));
    hooks.failChmod = false;

    expect(finished(outcome).output).toContain("could not set the mode");
    expect(await exists(join(root, "tree"))).toBe(false);
    expect(await staging(root)).toEqual([]);
    expectAllClosed();
  });

  it("publishes nothing when the job is cancelled while a file is verified", async () => {
    let backend: ReturnType<typeof backendOf> | null = null;
    const transfer = fakeFilesTransfer({
      receives: await tarOf([{ name: "x", body: "x".repeat(1024) }]),
    });
    sequence += 1;
    hooks.cancelOnSync = true;
    hooks.cancel = () => backend?.cancel(sequence);
    backend = backendOf({ transfer });

    const outcome = await backend.call({
      sequence,
      tool: UPLOAD_TOOL,
      args: { path: "tree", workspacePath: "out/tree.tar", unpack: true },
      transferToken: CLAIM_TOKEN,
    });
    hooks.cancelOnSync = false;
    hooks.cancel = null;

    expect(outcome.status).toBe("cancelled");
    expect(await exists(join(root, "tree"))).toBe(false);
    expect(await staging(root)).toEqual([]);
    expectAllClosed();
  });

  it("refuses an existing destination before receiving anything", async () => {
    await mkdir(join(root, "tree"));
    const { outcome, transfer } = await upload(
      await tarOf([{ name: "x", body: "x" }]),
    );

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.output).toContain("never replaces or merges");
    expect(transfer.received).toEqual([]);
  });

  it("refuses overwrite together with unpack before receiving anything", async () => {
    const { outcome, transfer } = await upload(
      await tarOf([{ name: "x", body: "x" }]),
      { overwrite: true },
    );

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.output).toContain("never replaces or merges");
    expect(transfer.received).toEqual([]);
  });

  it("is refused without --upload", async () => {
    const { outcome, transfer } = await upload(
      await tarOf([{ name: "x", body: "x" }]),
      {},
      { allowUpload: false },
    );

    expect(finished(outcome).output).toContain("--upload");
    expect(transfer.received).toEqual([]);
  });

  it("refuses when the destination's filesystem has too little room, measured on the parent", async () => {
    const seen: string[] = [];
    const { outcome } = await upload(
      await tarOf([{ name: "x", body: "x" }]),
      { path: "reports/2026" },
      {
        freeBytes: (where) => {
          seen.push(where);
          return 1024 * 1024;
        },
      },
    );

    const done = finished(outcome);
    expect(done.isError).toBe(true);
    expect(done.blocked).toBe(true);
    expect(done.output).toContain("MB free");
    expect(seen).toEqual([join(root, "reports")]);
    expect(await exists(join(root, "reports", "2026"))).toBe(false);
    expect(await staging(join(root, "reports"))).toEqual([]);
  });

  it("refuses a link planted where the destination's parent would be", async () => {
    await mkdir(join(dir, "elsewhere"));
    await symlink(join(dir, "elsewhere"), join(root, "link"));
    const { outcome, transfer } = await upload(
      await tarOf([{ name: "x", body: "x" }]),
      { path: "link/tree" },
    );

    expect(finished(outcome).isError).toBe(true);
    expect(transfer.received).toEqual([]);
    expect(await readdir(join(dir, "elsewhere"))).toEqual([]);
  });

  it("creates the destination's parent on the way", async () => {
    const { outcome } = await upload(await tarOf([{ name: "x", body: "x" }]), {
      path: "a/b/c",
    });

    expect(jsonOf(outcome).files).toBe(1);
    expect(await readFile(join(root, "a", "b", "c", "x"), "utf8")).toBe("x");
    expect(await readdir(join(root, "a", "b"))).toEqual(["c"]);
  });
});

describe("a single-file upload next to the directory tools", () => {
  it("still lands one file when unpack is not set", async () => {
    const { outcome } = await upload(Buffer.from("plain\n"), {
      path: "plain.txt",
      unpack: undefined,
    });

    expect(finished(outcome).isError).toBe(false);
    expect(await readFile(join(root, "plain.txt"), "utf8")).toBe("plain\n");
  });
});

describe("publishing and discarding an unpacked directory", () => {
  it("removes nothing when the parent was swapped after the staging directory was created", async () => {
    const created = await stageDirInRoot(root, ["tree"]);
    if (!created.ok) throw new Error("staging failed");
    const staged = created.staged;
    const stagingName = basename(staged.path);

    const moved = `${root}-moved`;
    await rename(root, moved);
    await mkdir(root);
    await mkdir(join(root, stagingName));
    await writeFile(join(root, stagingName, "foreign.txt"), "keep me");

    expect(await publishDirInRoot(root, staged)).toBe("outside");
    await discardDirInRoot(staged);

    expect(await readFile(join(root, stagingName, "foreign.txt"), "utf8")).toBe(
      "keep me",
    );
    expect(await exists(join(root, "tree"))).toBe(false);
    await rm(moved, { recursive: true, force: true });
  });

  it("publishes nothing and removes nothing when the staging directory was swapped", async () => {
    const created = await stageDirInRoot(root, ["tree"]);
    if (!created.ok) throw new Error("staging failed");
    const staged = created.staged;
    await rename(staged.path, join(root, "moved-away"));
    await mkdir(staged.path);
    await writeFile(join(staged.path, "not-ours.txt"), "keep me");

    expect(await publishDirInRoot(root, staged)).toBe("changed");
    expect(await exists(join(root, "tree"))).toBe(false);

    await discardDirInRoot(staged);
    expect(await readFile(join(staged.path, "not-ours.txt"), "utf8")).toBe(
      "keep me",
    );
  });
});
