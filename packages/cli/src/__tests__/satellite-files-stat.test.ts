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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

/**
 * TEST_OVERVIEW: The `stat` tool reports one path's facts without moving it: its
 * kind, its size, its mtime in UTC and, when the caller asks, the sha256 of the
 * whole file. A link is reported as a link and never followed; asking for the
 * hash reads the file on the machine, so it takes the transfer's own open — a
 * regular file with one link, no cap on its size, because no bytes move.
 */

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

  await writeFile(join(rawRoot, "data.bin"), "0123456789abcdef");
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
      sha256: sha256(Buffer.from("0123456789abcdef")),
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
    expect(hashed.sha256).toBe(sha256(Buffer.from("0123456789abcdef")));
    expect(hashed.size).toBe(16);
  });

  it("reports a file's facts without the cap as well", async () => {
    const facts = jsonOf(await stat({ path: "data.bin" }, 4));
    expect(facts.size).toBe(16);
  });
});
