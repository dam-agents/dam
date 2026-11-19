import { rmSync, symlinkSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFileOps,
  type FileOpAnswer,
  type FileOpRequest,
  type FileOps,
} from "../modules/satellite/services/file-ops.js";

const hooks = vi.hoisted(() => ({
  onLstat: null as null | ((path: string) => void),
  onRealpath: null as null | ((path: string) => void),
}));

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    async lstat(...args: Parameters<typeof fs.lstat>) {
      const info = await fs.lstat(...args);
      hooks.onLstat?.(String(args[0]));
      return info;
    },
    async realpath(...args: Parameters<typeof fs.realpath>) {
      const resolved = await fs.realpath(...args);
      hooks.onRealpath?.(String(args[0]));
      return resolved;
    },
  };
});

/**
 * TEST_OVERVIEW: A change to the tree is proved by a walk and then taken in one
 * synchronous step, and the two are not the same instant: another operation, or the
 * user at the machine, can replace an entry in between. These specs put exactly
 * that swap in the window and pin that the step notices — a rename whose source
 * became a link, and a listing whose directory became a link — instead of carrying
 * the new entry out of the root or reading what it points at.
 */

const FUTURE = (): number => Date.now() + 30_000;

function request(
  fields: Omit<FileOpRequest, "deadline"> & { deadline?: number },
): FileOpRequest {
  return { ...fields, deadline: fields.deadline ?? FUTURE() };
}

function failed(answer: FileOpAnswer): string {
  if (answer.ok) throw new Error("expected a refusal, got one");
  return answer.errno;
}

async function run(
  ops: FileOps,
  fields: Omit<FileOpRequest, "deadline"> & { deadline?: number },
): Promise<FileOpAnswer> {
  return ops.run(request(fields));
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Fires a swap the first time the walk reads one named
 * path, which is the instant between the proof and the step a real race occupies.
 */
function swapWhenRead(path: string, swap: () => void): () => void {
  let armed = true;
  hooks.onLstat = (seen) => {
    if (!armed || seen !== path) return;
    armed = false;
    swap();
  };
  return () => {
    hooks.onLstat = null;
  };
}

let root: string;
let ops: FileOps;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "dam-file-ops-race-")));
  ops = createFileOps({ root, writable: true });
});

afterEach(async () => {
  hooks.onLstat = null;
  hooks.onRealpath = null;
  await rm(root, { recursive: true, force: true }).catch(() => null);
});

describe("an entry swapped between the walk and the step", () => {
  /**
   * TEST_SCENARIO: The depth rule that makes `mv` re-create a link is decided from
   * the source's kind, and the kind can change while the parents are walked. Here a
   * file at depth two is replaced by a link whose `../../` is legal at depth two, so
   * a rename that carries it to the top of the root would put its target above the
   * root. The step re-proves the source by device, inode and kind, answers ESTALE,
   * and renames nothing.
   */
  it("refuses a rename whose source became a link and leaves no link outside the root", async () => {
    await mkdir(join(root, "docs"));
    await writeFile(join(root, "docs", "notes"), "a file where a link was");
    const disarm = swapWhenRead(join(root, "docs", "notes"), () => {
      rmSync(join(root, "docs", "notes"));
      symlinkSync("../../escape", join(root, "docs", "notes"));
    });

    try {
      expect(
        failed(
          await run(ops, {
            op: "rename",
            path: "docs/notes",
            args: { to: "x" },
          }),
        ),
      ).toBe("ESTALE");
    } finally {
      disarm();
    }

    await expect(lstat(join(root, "x"))).rejects.toThrow();
    expect((await lstat(join(root, "docs", "notes"))).isSymbolicLink()).toBe(
      true,
    );
  });

  /**
   * TEST_SCENARIO: A listing is taken inside the directory it names, so a directory
   * replaced by a link after the walk is refused rather than followed: the entries
   * behind the link are never read.
   */
  it("refuses to list a directory that became a link", async () => {
    const outside = await realpath(
      await mkdtemp(join(tmpdir(), "dam-file-ops-outside-")),
    );
    try {
      await writeFile(join(outside, "secret.txt"), "secret");
      await mkdir(join(root, "a"));
      await mkdir(join(root, "a", "out"));
      hooks.onRealpath = (seen) => {
        if (seen !== join(root, "a")) return;
        hooks.onRealpath = null;
        rmSync(join(root, "a", "out"), { recursive: true, force: true });
        symlinkSync(outside, join(root, "a", "out"));
      };

      const answer = await run(ops, { op: "readdir", path: "a/out" });
      hooks.onRealpath = null;
      expect(failed(answer)).toBe("EACCES");

      const names = (await readdir(join(root, "a"))).filter(
        (name) => name !== "out",
      );
      expect(names).toEqual([]);
      expect(await readdir(outside)).toEqual(["secret.txt"]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("a path proved through every directory", () => {
  /**
   * TEST_SCENARIO: A swap that lands before the walk does not hide behind the race:
   * the walk itself shows the entry is not a real directory and the answer is the
   * ordinary refusal, not a read of what the link points at.
   */
  it("does not read through a directory that is a link", async () => {
    const outside = await realpath(
      await mkdtemp(join(tmpdir(), "dam-file-ops-outside-")),
    );
    try {
      await writeFile(join(outside, "secret.txt"), "secret");
      await symlink(outside, join(root, "out"));
      await chmod(join(outside), 0o755);

      expect(failed(await run(ops, { op: "readdir", path: "out" }))).toBe(
        "EACCES",
      );
      expect(
        failed(
          await run(ops, {
            op: "read",
            path: "out/secret.txt",
            args: { offset: 0, size: 6, dev: 1, ino: 1 },
          }),
        ),
      ).toBe("EACCES");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("a directory the listing turned away from", () => {
  it("names no entry of a link it refused", async () => {
    const outside = await realpath(
      await mkdtemp(join(tmpdir(), "dam-file-ops-outside-")),
    );
    try {
      await writeFile(join(outside, "secret.txt"), "secret");
      await symlink(dirname(outside), join(root, "up"));
      expect(failed(await run(ops, { op: "readdir", path: "up" }))).toBe(
        "EACCES",
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});
