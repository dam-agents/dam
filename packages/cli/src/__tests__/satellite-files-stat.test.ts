import { execFileSync } from "node:child_process";
import {
  link,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FileHandle } from "node:fs/promises";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { CallOutcome } from "../modules/satellite/services/backend.js";
import { pinRoot } from "../modules/satellite/services/confined-files.js";
import {
  createFilesBackend,
  STAT_TOOL,
} from "../modules/satellite/services/files-backend.js";
import {
  CLAIM_TOKEN,
  fakeFilesTransfer,
  finished,
  jsonOf,
  sha256,
} from "./satellite-files-fixtures.js";

const hooks = vi.hoisted(() => ({
  beforeRead: null as null | (() => Promise<void> | void),
  handles: [] as FileHandle[],
}));

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    async open(...args: Parameters<typeof fs.open>) {
      const handle = await fs.open(...args);
      hooks.handles.push(handle);
      const read = handle.read.bind(handle);
      handle.read = (async (...rest: unknown[]) => {
        const hook = hooks.beforeRead;
        hooks.beforeRead = null;
        if (hook !== null) await hook();
        return read(...(rest as Parameters<typeof read>));
      }) as typeof handle.read;
      return handle;
    },
  };
});

/**
 * TEST_OVERVIEW: The `stat` tool reports one path's facts without moving it: its
 * kind, its size, its mtime in UTC and, when the caller asks, the sha256 of the
 * whole file. A link is reported as a link and never followed; asking for the
 * hash reads the file on the machine, so it takes the transfer's own open — a
 * regular file with one link, no cap on its size, because no bytes move — and
 * reads exactly the size one `fstat` reported, refusing if a second `fstat`
 * shows the file changed under it. The descriptor is closed either way.
 */

const BODY = Buffer.from("0123456789abcdef");

let dir: string;
let root: string;
let outside: string;

function backendOf(maxBytes?: number) {
  return createFilesBackend({
    root,
    allowUpload: false,
    transfer: fakeFilesTransfer(),
    ...(maxBytes === undefined ? {} : { maxBytes }),
  });
}

function stat(
  args: Record<string, unknown>,
  maxBytes?: number,
): Promise<CallOutcome> {
  return backendOf(maxBytes).call({
    sequence: 1,
    tool: STAT_TOOL,
    args,
    transferToken: CLAIM_TOKEN,
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dam-satellite-stat-"));
  const rawRoot = join(dir, "work");
  outside = join(dir, "outside");
  await mkdir(join(rawRoot, "empty"), { recursive: true });
  await mkdir(outside, { recursive: true });

  await writeFile(join(rawRoot, "data.bin"), BODY);
  await utimes(
    join(rawRoot, "data.bin"),
    new Date("2026-11-12T09:14:03.500Z"),
    new Date("2026-11-12T09:14:03.500Z"),
  );
  await writeFile(join(outside, "secret.txt"), "SECRET");
  await symlink(join(outside, "secret.txt"), join(rawRoot, "escape.txt"));
  await link(join(outside, "secret.txt"), join(rawRoot, "hard.txt"));
  execFileSync("mkfifo", [join(rawRoot, "fifo")]);

  const pinned = await pinRoot(rawRoot);
  if (!pinned.ok) throw new Error(pinned.reason);
  root = await realpath(rawRoot);
});

afterEach(async () => {
  hooks.beforeRead = null;
  await writeFile(join(root, "data.bin"), BODY);
  await utimes(
    join(root, "data.bin"),
    new Date("2026-11-12T09:14:03.500Z"),
    new Date("2026-11-12T09:14:03.500Z"),
  );
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("what one path is", () => {
  it("reports a file's kind, size and mtime", async () => {
    expect(jsonOf(await stat({ path: "data.bin" }))).toEqual({
      path: "data.bin",
      kind: "file",
      size: 16,
      mtime: "2026-11-12T09:14:03Z",
    });
  });

  it("reports a directory, a link and a FIFO without a size and without following anything", async () => {
    expect(jsonOf(await stat({ path: "empty" }))).toMatchObject({
      path: "empty",
      kind: "dir",
      size: null,
      mtime: expect.stringMatching(/Z$/),
    });
    expect(jsonOf(await stat({ path: "escape.txt" }))).toMatchObject({
      kind: "link",
      size: null,
    });
    expect(jsonOf(await stat({ path: "fifo" }))).toMatchObject({
      kind: "other",
      size: null,
    });
  });

  it("refuses a .. segment, an absolute path, a link on the way and a path that is not there", async () => {
    for (const path of [
      "../outside/secret.txt",
      join(outside, "secret.txt"),
      "escape.txt/child",
      "nope.bin",
      "",
    ]) {
      const outcome = finished(await stat({ path }));
      expect(outcome.isError).toBe(true);
      expect(outcome.blocked).toBe(true);
    }
  });
});

describe("the sha256 of a whole file", () => {
  it("matches what the bytes hash to", async () => {
    expect(jsonOf(await stat({ path: "data.bin", sha256: true }))).toEqual({
      path: "data.bin",
      kind: "file",
      size: 16,
      mtime: "2026-11-12T09:14:03Z",
      sha256: sha256(BODY),
    });
  });

  /**
   * TEST_SCENARIO: The hash reads the file the way a download opens it, so a
   * link — even one that points back inside — and a file with a second name are
   * refused rather than hashed through a path the root does not cover.
   */
  it("refuses a link and a hard-linked file", async () => {
    for (const path of ["escape.txt", "hard.txt"]) {
      const outcome = finished(await stat({ path, sha256: true }));
      expect(outcome.isError).toBe(true);
      expect(outcome.blocked).toBe(true);
      expect(outcome.output).toContain("not a regular file");
    }
  });

  it("hashes a file larger than the transfer cap, because no byte moves", async () => {
    const hashed = jsonOf(await stat({ path: "data.bin", sha256: true }, 4));
    expect(hashed.sha256).toBe(sha256(BODY));
    expect(hashed.size).toBe(16);
  });

  it("reports a file's facts without the cap as well", async () => {
    const facts = jsonOf(await stat({ path: "data.bin" }, 4));
    expect(facts.size).toBe(16);
  });

  /**
   * TEST_SCENARIO: A file that grows while it is hashed would otherwise be
   * reported with one size and a digest of more bytes, and a file that keeps
   * growing would keep the call reading. The hash is bounded by the size one
   * `fstat` reported, and a second `fstat` that disagrees refuses the call.
   */
  it("refuses when the file grows while it is being hashed", async () => {
    hooks.beforeRead = () =>
      writeFile(
        join(root, "data.bin"),
        Buffer.concat([BODY, Buffer.from("XYZ")]),
      );

    const outcome = finished(await stat({ path: "data.bin", sha256: true }));

    expect(outcome.isError).toBe(true);
    expect(outcome.output).toBe("data.bin changed while it was being hashed");
  });

  it("refuses when the file shrinks while it is being hashed", async () => {
    hooks.beforeRead = () =>
      writeFile(join(root, "data.bin"), Buffer.from("0123"));

    const outcome = finished(await stat({ path: "data.bin", sha256: true }));

    expect(outcome.isError).toBe(true);
    expect(outcome.output).toBe("data.bin changed while it was being hashed");
  });

  it("refuses when the file is rewritten with the same size", async () => {
    hooks.beforeRead = () =>
      writeFile(join(root, "data.bin"), Buffer.from("fedcba9876543210"));

    const outcome = finished(await stat({ path: "data.bin", sha256: true }));

    expect(outcome.isError).toBe(true);
    expect(outcome.output).toBe("data.bin changed while it was being hashed");
  });

  it("closes the descriptor it hashed, whether it succeeded or refused", async () => {
    hooks.handles.length = 0;
    jsonOf(await stat({ path: "data.bin", sha256: true }));
    const hashed = hooks.handles.at(-1);
    if (hashed === undefined) throw new Error("no descriptor was opened");
    await expect(hashed.stat()).rejects.toThrow();

    hooks.handles.length = 0;
    hooks.beforeRead = () =>
      writeFile(join(root, "data.bin"), Buffer.from("0123"));
    finished(await stat({ path: "data.bin", sha256: true }));
    const refused = hooks.handles.at(-1);
    if (refused === undefined) throw new Error("no descriptor was opened");
    await expect(refused.stat()).rejects.toThrow();
  });
});
