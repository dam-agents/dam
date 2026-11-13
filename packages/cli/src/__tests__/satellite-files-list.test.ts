import { execFileSync } from "node:child_process";
import {
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
  LIST_TOOL,
} from "../modules/satellite/services/files-backend.js";
import {
  CLAIM_TOKEN,
  fakeFilesTransfer,
  finished,
  textOf,
} from "./satellite-files-fixtures.js";

/**
 * TEST_OVERVIEW: The `list` tool shows an agent what a files satellite exposes
 * without moving anything: one tab-separated line per entry, with the kind, the
 * size, the mtime and the path relative to the directory it was asked about. The
 * walk is the transfer walk — a link is listed and never followed, and a
 * directory is entered only after it was proved — and three bounds decide when a
 * listing stops: the depth, the number of entries, and a wall-clock budget, each
 * reported on a truncated line instead of ending silently.
 */

const HEADER = "kind\tsize\tmtime\tpath";
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;

interface Entry {
  kind: string;
  size: string;
  mtime: string;
  path: string;
}

function entries(output: string): Entry[] {
  const lines = output.split("\n");
  expect(lines[0]).toBe(HEADER);
  return lines.slice(1).flatMap((line) => {
    if (line.startsWith("…")) return [];
    const [kind, size, mtime, path] = line.split("\t");
    return [{ kind: kind!, size: size!, mtime: mtime!, path: path! }];
  });
}

function paths(output: string): string[] {
  return entries(output)
    .map((entry) => entry.path)
    .sort();
}

function kindAt(output: string, path: string): string | undefined {
  return entries(output).find((entry) => entry.path === path)?.kind;
}

function truncation(output: string): string | undefined {
  return output.split("\n").find((line) => line.startsWith("…"));
}

let dir: string;
let root: string;
let outside: string;

function backendOf(options: { listBudgetMs?: number } = {}) {
  return createFilesBackend({
    root,
    allowUpload: false,
    transfer: fakeFilesTransfer(),
    ...options,
  });
}

function list(args: Record<string, unknown>): Promise<CallOutcome> {
  return backendOf().call({
    sequence: 1,
    tool: LIST_TOOL,
    args,
    transferToken: CLAIM_TOKEN,
  });
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dam-satellite-list-"));
  const rawRoot = join(dir, "work");
  outside = join(dir, "outside");
  await mkdir(join(rawRoot, "logs", "deep", "deeper"), { recursive: true });
  await mkdir(join(rawRoot, "dumps"), { recursive: true });
  await mkdir(join(rawRoot, "empty"), { recursive: true });
  await mkdir(outside, { recursive: true });

  await writeFile(join(rawRoot, "notes.txt"), "top level\n");
  await writeFile(join(rawRoot, "logs", "app.log"), "line one\nline two\n");
  await writeFile(join(rawRoot, "logs", "deep", "error.log"), "boom\n");
  await writeFile(join(rawRoot, "logs", "deep", "deeper", "nested.txt"), "x\n");
  await writeFile(join(rawRoot, "dumps", "dev-07.img"), "0123456789");
  await utimes(
    join(rawRoot, "dumps", "dev-07.img"),
    new Date("2026-11-12T09:14:03.500Z"),
    new Date("2026-11-12T09:14:03.500Z"),
  );
  await writeFile(join(outside, "secret.txt"), "SECRET");
  await symlink(join(outside, "secret.txt"), join(rawRoot, "escape.txt"));
  await symlink(join(rawRoot, "logs"), join(rawRoot, "logs-link"));
  execFileSync("mkfifo", [join(rawRoot, "fifo")]);

  const pinned = await pinRoot(rawRoot);
  if (!pinned.ok) throw new Error(pinned.reason);
  root = await realpath(rawRoot);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a listing of the directory a satellite exposes", () => {
  it("lists one level by default with the kind, the size, the mtime and a slash on a directory", async () => {
    const output = textOf(await list({}));

    expect(paths(output)).toEqual([
      "dumps/",
      "empty/",
      "escape.txt",
      "fifo",
      "logs-link",
      "logs/",
      "notes.txt",
    ]);
    expect(entries(output).every((entry) => ISO.test(entry.mtime))).toBe(true);
    expect(kindAt(output, "dumps/")).toBe("dir");
    expect(kindAt(output, "notes.txt")).toBe("file");
    expect(kindAt(output, "escape.txt")).toBe("link");
    expect(kindAt(output, "fifo")).toBe("other");
    expect(
      entries(output).find((entry) => entry.path === "notes.txt")?.size,
    ).toBe("10");
    expect(entries(output).find((entry) => entry.path === "logs/")?.size).toBe(
      "-",
    );
    expect(truncation(output)).toBeUndefined();
  });

  it("refuses a .. segment, an absolute path, a link on the way and a path that is not there", async () => {
    for (const path of [
      "../outside",
      outside,
      "logs-link/deep",
      "logs/nope",
      "",
    ]) {
      const outcome = finished(await list({ path }));
      expect(outcome.isError).toBe(true);
      expect(outcome.blocked).toBe(true);
    }
  });

  /**
   * TEST_SCENARIO: A link is metadata, not a door. One that points inside the
   * root is still only a link entry: following it would let a directory that was
   * proved once be swapped for another afterwards, which is what the transfer
   * walk refuses for the same reason.
   */
  it("lists a symlinked directory as a link and does not descend into it", async () => {
    const output = textOf(await list({ depth: 3 }));

    expect(kindAt(output, "logs-link")).toBe("link");
    expect(paths(output).some((path) => path.startsWith("logs-link/"))).toBe(
      false,
    );
    expect(paths(output)).toContain("logs/app.log");
  });

  /**
   * TEST_SCENARIO: A link's target can name a path the root does not cover, so
   * the listing shows the link and nothing of what it points at.
   */
  it("lists a symlink to outside without its target", async () => {
    const output = textOf(await list({}));

    expect(kindAt(output, "escape.txt")).toBe("link");
    expect(output).not.toContain("outside");
    expect(output).not.toContain("secret");
    expect(output).not.toContain("SECRET");
  });

  it("lists a FIFO as other and gives it no size", async () => {
    const output = textOf(await list({}));
    const fifo = entries(output).find((entry) => entry.path === "fifo");

    expect(fifo?.kind).toBe("other");
    expect(fifo?.size).toBe("-");
  });

  it("descends to the depth it was asked for and no further", async () => {
    const two = paths(textOf(await list({ depth: 2 })));
    expect(two).toContain("logs/app.log");
    expect(two).toContain("logs/deep/");
    expect(two).not.toContain("logs/deep/error.log");

    const three = paths(textOf(await list({ depth: 3 })));
    expect(three).toContain("logs/deep/error.log");
    expect(three).not.toContain("logs/deep/deeper/nested.txt");
  });

  it("lists a path that is a file as the one entry it names", async () => {
    const output = textOf(await list({ path: "dumps/dev-07.img" }));

    expect(paths(output)).toEqual(["dev-07.img"]);
    expect(entries(output)).toEqual([
      {
        kind: "file",
        size: "10",
        mtime: "2026-11-12T09:14:03Z",
        path: "dev-07.img",
      },
    ]);
  });

  it("refuses a depth, a limit or a glob outside what it documents", async () => {
    for (const args of [
      { depth: 0 },
      { depth: 11 },
      { depth: 1.5 },
      { limit: 0 },
      { limit: 5001 },
      { glob: "" },
    ]) {
      expect(finished(await list(args)).isError).toBe(true);
    }
  });
});

describe("the bounds a listing stops at", () => {
  it("stops at the limit and says more exists", async () => {
    const output = textOf(await list({ limit: 2 }));

    expect(entries(output)).toHaveLength(2);
    expect(truncation(output)).toBe(
      "… truncated: 2 entries listed, more exist — narrow path or glob, or raise limit",
    );
  });

  /**
   * TEST_SCENARIO: On an rclone mount every `lstat` is a round trip, so the
   * budget is what keeps a listing from holding the worker for minutes. An agent
   * must see that the answer is partial, not an empty directory.
   */
  it("stops when the time budget is spent and says so", async () => {
    const output = textOf(
      await backendOf({ listBudgetMs: -1 }).call({
        sequence: 1,
        tool: LIST_TOOL,
        args: {},
        transferToken: CLAIM_TOKEN,
      }),
    );

    expect(entries(output)).toHaveLength(0);
    expect(truncation(output)).toContain("budget ran out");
  });

  it("filters what it prints with a glob and still walks every directory", async () => {
    expect(paths(textOf(await list({ glob: "**/*.log" })))).toEqual([
      "logs/app.log",
      "logs/deep/error.log",
    ]);
    expect(paths(textOf(await list({ glob: "*.txt" })))).toEqual([
      "escape.txt",
      "notes.txt",
    ]);

    const none = textOf(await list({ glob: "**/*.nope" }));
    expect(entries(none)).toHaveLength(0);
    expect(truncation(none)).toBeUndefined();
  });

  it("applies a glob to the path relative to the directory it was given", async () => {
    expect(
      paths(textOf(await list({ path: "logs", glob: "**/*.log" }))),
    ).toEqual(["app.log", "deep/error.log"]);
    expect(paths(textOf(await list({ path: "logs", glob: "*.log" })))).toEqual([
      "app.log",
    ]);
  });
});
