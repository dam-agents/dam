import { execFileSync } from "node:child_process";
import {
  link,
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
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  pathSegments,
  pinRoot,
} from "../modules/satellite/services/confined-files.js";
import {
  createFileOps,
  FREE_HEADROOM_BYTES,
  lockRoot,
  rootLockPath,
  targetStaysInside,
  type FileAttrs,
  type FileOpAnswer,
  type FileOpRequest,
  type FileOps,
} from "../modules/satellite/services/file-ops.js";

/**
 * TEST_OVERVIEW: The machine's half of a Satellite Mount, one operation at a
 * time. A path is relative to the root or `.` for the root itself, the root is
 * resolved again on every operation, every directory on the way must be real, and
 * no operation follows a link. The specs pin what each operation answers —
 * attributes, a page of a listing, bytes, an errno — and the rules an Agent
 * cannot talk its way past: a link out of the root, a hard-linked file, a FIFO, a
 * path carrying `..`, a stale identity, a write with less than a gibibyte of
 * headroom, a mutation on a worker started without `--write`, and two workers on
 * one root.
 */

const FUTURE = (): number => Date.now() + 30_000;

function base64(text: string): string {
  return Buffer.from(text).toString("base64");
}

function request(
  fields: Omit<FileOpRequest, "deadline"> & { deadline?: number },
): FileOpRequest {
  return { ...fields, deadline: fields.deadline ?? FUTURE() };
}

function succeeded(answer: FileOpAnswer): Extract<FileOpAnswer, { ok: true }> {
  if (!answer.ok) throw new Error(`expected success, got ${answer.errno}`);
  return answer;
}

function failed(answer: FileOpAnswer): string {
  if (answer.ok) throw new Error("expected a refusal, got one");
  return answer.errno;
}

function attrsOf(answer: FileOpAnswer): FileAttrs {
  return succeeded(answer).result as FileAttrs;
}

async function run(
  ops: FileOps,
  fields: Omit<FileOpRequest, "deadline"> & { deadline?: number },
): Promise<FileOpAnswer> {
  return ops.run(request(fields));
}

async function attrs(ops: FileOps, path: string): Promise<FileAttrs> {
  return attrsOf(await run(ops, { op: "getattr", path }));
}

let root: string;
let ops: FileOps;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "dam-file-ops-")));
  ops = createFileOps({ root, writable: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true }).catch(() => null);
  await rm(`${root}.moved`, { recursive: true, force: true }).catch(() => null);
});

describe("attributes and listings", () => {
  /**
   * TEST_SCENARIO: The mount shows what a path is, not what a link points at: a
   * file, a directory, a link and something that is neither are four kinds, and a
   * link's target is never followed to answer `getattr`.
   */
  it("reports a file, a directory, a link and other as what they are", async () => {
    await writeFile(join(root, "a.txt"), "hello");
    await mkdir(join(root, "d"));
    await symlink("a.txt", join(root, "l"));
    execFileSync("mkfifo", [join(root, "pipe")]);

    const file = await attrs(ops, "a.txt");
    expect(file.kind).toBe("file");
    expect(file.size).toBe(5);
    expect(file.mode).toBeGreaterThan(0);
    expect(file.ino).toBeGreaterThan(0);
    expect(file.mtimeMs).toBeGreaterThan(0);
    expect(file.ctimeMs).toBeGreaterThan(0);
    expect(file.atimeMs).toBeGreaterThan(0);

    expect((await attrs(ops, "d")).kind).toBe("dir");
    expect((await attrs(ops, "l")).kind).toBe("link");
    expect((await attrs(ops, "pipe")).kind).toBe("other");
    expect((await attrs(ops, ".")).kind).toBe("dir");
  });

  /**
   * TEST_SCENARIO: A directory is listed a page at a time from a position, so a
   * walk of a directory larger than the window resumes where it stopped and ends
   * with an empty page whose `next` does not move backwards.
   */
  it("pages a directory by position and ends with an empty page", async () => {
    await mkdir(join(root, "d"));
    for (let index = 0; index < 5; index++)
      await writeFile(join(root, "d", `f${index}`), String(index));
    const all = (await readdir(join(root, "d"))).sort();

    const shown: string[] = [];
    const pages = [
      { offset: 0, limit: 2 },
      { offset: 2, limit: 2 },
      { offset: 4, limit: 2 },
      { offset: 5, limit: 2 },
    ];
    let next = -1;
    for (const page of pages) {
      const answer = succeeded(
        await run(ops, { op: "readdir", path: "d", args: page }),
      );
      const listing = answer.result as {
        entries: (FileAttrs & { name: string })[];
        next: number;
      };
      shown.push(...listing.entries.map((entry) => entry.name));
      expect(listing.next).toBe(page.offset + listing.entries.length);
      next = listing.next;
    }
    expect(shown.sort()).toEqual(all);
    expect(next).toBe(5);
  });

  it("lists the Satellite's own root as .", async () => {
    await writeFile(join(root, "a.txt"), "hello");
    const listing = succeeded(await run(ops, { op: "readdir", path: "." }))
      .result as { entries: { name: string }[] };
    expect(listing.entries.map((entry) => entry.name)).toContain("a.txt");
  });
});

describe("reading and writing", () => {
  it("reads at an offset, up to a size, and answers no bytes at the end", async () => {
    await writeFile(join(root, "a.txt"), "0123456789");
    const file = await attrs(ops, "a.txt");

    const part = succeeded(
      await run(ops, {
        op: "read",
        path: "a.txt",
        args: { offset: 3, size: 4, dev: file.dev, ino: file.ino },
      }),
    );
    expect(Buffer.from(part.data ?? "", "base64").toString()).toBe("3456");

    const end = succeeded(
      await run(ops, {
        op: "read",
        path: "a.txt",
        args: { offset: 10, size: 4, dev: file.dev, ino: file.ino },
      }),
    );
    expect(end.data).toBe("");
  });

  it("writes at an offset, appends, and truncates", async () => {
    await writeFile(join(root, "a.txt"), "hello");
    let file = await attrs(ops, "a.txt");

    succeeded(
      await run(ops, {
        op: "write",
        path: "a.txt",
        args: { offset: 5, dev: file.dev, ino: file.ino },
        data: base64(" world"),
      }),
    );
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("hello world");

    file = await attrs(ops, "a.txt");
    succeeded(
      await run(ops, {
        op: "write",
        path: "a.txt",
        args: { offset: 0, dev: file.dev, ino: file.ino },
        data: base64("HELLO"),
      }),
    );
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("HELLO world");

    const truncated = succeeded(
      await run(ops, {
        op: "truncate",
        path: "a.txt",
        args: { size: 5, dev: file.dev, ino: file.ino },
      }),
    );
    expect((truncated.result as FileAttrs).size).toBe(5);
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("HELLO");
  });

  /**
   * TEST_SCENARIO: AC-5 says a change reaches the machine as it is made, and a
   * write that would leave the machine short of space must not be half done. The
   * free-space reading is injected so the ceiling is pinned without filling a
   * disk, and the file is untouched when the write is refused.
   */
  it("refuses a write that would leave less than a gibibyte free", async () => {
    const tight = createFileOps({
      root,
      writable: true,
      freeBytes: async () => FREE_HEADROOM_BYTES + 10,
    });
    await writeFile(join(root, "a.txt"), "hello");
    const file = await attrs(tight, "a.txt");

    expect(
      failed(
        await run(tight, {
          op: "write",
          path: "a.txt",
          args: { offset: 0, dev: file.dev, ino: file.ino },
          data: base64("x".repeat(64)),
        }),
      ),
    ).toBe("ENOSPC");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("hello");

    succeeded(
      await run(tight, {
        op: "write",
        path: "a.txt",
        args: { offset: 0, dev: file.dev, ino: file.ino },
        data: base64("x"),
      }),
    );
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("xello");
  });

  /**
   * TEST_SCENARIO: An operation past its deadline is answered without touching
   * the machine, so a change never lands after the Agent was told it failed.
   */
  it("answers EIO past the deadline and touches nothing", async () => {
    expect(
      failed(
        await run(ops, {
          op: "create",
          path: "late.txt",
          args: { mode: 0o644, exclusive: true },
          deadline: Date.now() - 1,
        }),
      ),
    ).toBe("EIO");
    await expect(lstat(join(root, "late.txt"))).rejects.toThrow();
  });

  /**
   * TEST_SCENARIO: A file swapped between the read that named it and the write
   * that follows must not be written through: the identity the Agent saw is
   * compared with the one on disk, and a different one is a stale handle.
   */
  it("answers ESTALE when the path is no longer the inode the Agent saw", async () => {
    await writeFile(join(root, "a.txt"), "first");
    await writeFile(join(root, "b.txt"), "second");
    const seen = await attrs(ops, "a.txt");

    await rm(join(root, "a.txt"));
    await rename(join(root, "b.txt"), join(root, "a.txt"));

    expect(
      failed(
        await run(ops, {
          op: "write",
          path: "a.txt",
          args: { offset: 0, dev: seen.dev, ino: seen.ino },
          data: base64("x"),
        }),
      ),
    ).toBe("ESTALE");
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("second");
  });
});

describe("creating and removing", () => {
  it("creates exclusively, opens an existing file without truncating it, and makes a directory", async () => {
    const made = attrsOf(
      await run(ops, {
        op: "create",
        path: "a.txt",
        args: { mode: 0o640, exclusive: true },
      }),
    );
    expect(made.kind).toBe("file");
    expect(made.mode).toBe(0o640);

    expect(
      failed(
        await run(ops, {
          op: "create",
          path: "a.txt",
          args: { mode: 0o640, exclusive: true },
        }),
      ),
    ).toBe("EEXIST");

    await writeFile(join(root, "a.txt"), "kept");
    succeeded(
      await run(ops, {
        op: "create",
        path: "a.txt",
        args: { mode: 0o640, exclusive: false },
      }),
    );
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("kept");

    const dir = attrsOf(
      await run(ops, { op: "mkdir", path: "d", args: { mode: 0o750 } }),
    );
    expect(dir.kind).toBe("dir");
    expect(dir.mode).toBe(0o750);
  });

  /**
   * TEST_SCENARIO: The guest may believe a name is free while the machine already
   * holds a FIFO there, so `create` without `exclusive` meets it. Opening a FIFO for
   * writing blocks until a reader appears, which would freeze the worker on one
   * operation, so the entry is refused before it is opened and the answer is
   * immediate.
   */
  it("refuses create over a FIFO instead of blocking on it", async () => {
    execFileSync("mkfifo", [join(root, "pipe")]);
    const refused = await run(ops, {
      op: "create",
      path: "pipe",
      args: { mode: 0o644, exclusive: false },
    });
    expect(failed(refused)).toBe("EPERM");
    expect((await attrs(ops, "pipe")).kind).toBe("other");
  });

  it("removes a file, refuses a directory that is not empty, and refuses the root", async () => {
    await writeFile(join(root, "a.txt"), "hello");
    await mkdir(join(root, "d"));
    await writeFile(join(root, "d", "inner"), "hello");

    expect(failed(await run(ops, { op: "rmdir", path: "d" }))).toBe(
      "ENOTEMPTY",
    );
    expect(failed(await run(ops, { op: "rmdir", path: "." }))).toBe("EBUSY");
    expect(failed(await run(ops, { op: "unlink", path: "." }))).toBe("EBUSY");

    succeeded(await run(ops, { op: "unlink", path: "d/inner" }));
    succeeded(await run(ops, { op: "rmdir", path: "d" }));
    await expect(lstat(join(root, "d"))).rejects.toThrow();
    succeeded(await run(ops, { op: "unlink", path: "a.txt" }));
    await expect(lstat(join(root, "a.txt"))).rejects.toThrow();
  });

  /**
   * TEST_SCENARIO: A hard link is renamed and removed by name like any other
   * entry: neither writes through the inode, so the one-link rule has nothing to
   * protect there.
   */
  it("unlinks a hard-linked name without refusing it", async () => {
    await writeFile(join(root, "a.txt"), "hello");
    await link(join(root, "a.txt"), join(root, "b.txt"));
    succeeded(await run(ops, { op: "unlink", path: "b.txt" }));
    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("hello");
  });
});

describe("renaming", () => {
  it("renames a file and a directory inside the root", async () => {
    await writeFile(join(root, "a.txt"), "hello");
    succeeded(
      await run(ops, { op: "rename", path: "a.txt", args: { to: "b.txt" } }),
    );
    expect(await readFile(join(root, "b.txt"), "utf8")).toBe("hello");

    await mkdir(join(root, "d"));
    await writeFile(join(root, "d", "inner"), "hello");
    succeeded(await run(ops, { op: "rename", path: "d", args: { to: "d2" } }));
    expect(await readFile(join(root, "d2", "inner"), "utf8")).toBe("hello");
  });

  /**
   * TEST_SCENARIO: AC-8. A directory or a link moved closer to the root is a
   * cross-device move, so `mv` copies it and re-creates each link, which checks
   * every target again; the same move further down, or of a file, is a rename.
   */
  it("answers EXDEV for a directory or link moved closer to the root", async () => {
    await mkdir(join(root, "docs"));
    await mkdir(join(root, "docs", "notes"));
    expect(
      failed(
        await run(ops, {
          op: "rename",
          path: "docs/notes",
          args: { to: "notes" },
        }),
      ),
    ).toBe("EXDEV");

    await symlink("../../a.txt", join(root, "docs", "notes", "l"));
    expect(
      failed(
        await run(ops, {
          op: "rename",
          path: "docs/notes/l",
          args: { to: "l" },
        }),
      ),
    ).toBe("EXDEV");

    await writeFile(join(root, "docs", "b.txt"), "hello");
    succeeded(
      await run(ops, {
        op: "rename",
        path: "docs/b.txt",
        args: { to: "b2.txt" },
      }),
    );
    expect(await readFile(join(root, "b2.txt"), "utf8")).toBe("hello");

    succeeded(
      await run(ops, {
        op: "rename",
        path: "docs/notes",
        args: { to: "docs/deeper" },
      }),
    );
  });

  /**
   * TEST_SCENARIO: The rule counts depth, not the length of a path. A directory
   * moved from `docs/notes` to a *longer* name at the top of the root is still
   * closer to the root, and a link created at depth two — whose `../../` stays
   * inside there — would resolve above the root once the directory moved, so `mv`
   * could not re-create it. The rename is refused and nothing moves.
   */
  it("counts depth, not path length, when a directory carrying a link moves closer to the root", async () => {
    await mkdir(join(root, "shared"));
    await writeFile(join(root, "shared", "a.txt"), "shared");
    await mkdir(join(root, "docs"));
    await mkdir(join(root, "docs", "notes"));
    await symlink("../../shared/a.txt", join(root, "docs", "notes", "a.txt"));

    expect(
      failed(
        await run(ops, {
          op: "rename",
          path: "docs/notes",
          args: { to: "averylongname" },
        }),
      ),
    ).toBe("EXDEV");

    expect((await attrs(ops, "docs/notes/a.txt")).kind).toBe("link");
    await expect(lstat(join(root, "averylongname"))).rejects.toThrow();
  });

  /**
   * TEST_SCENARIO: A directory moved at the same depth is a rename however the two
   * paths are spelled, so a new path that happens to be shorter is not mistaken for
   * a move closer to the root.
   */
  it("renames a directory at the same depth even when the new path is shorter", async () => {
    await mkdir(join(root, "aaaa"));
    await mkdir(join(root, "aaaa", "bbbb"));
    await writeFile(join(root, "aaaa", "bbbb", "inner"), "hello");
    await mkdir(join(root, "c"));

    succeeded(
      await run(ops, { op: "rename", path: "aaaa/bbbb", args: { to: "c/d" } }),
    );
    expect(await readFile(join(root, "c", "d", "inner"), "utf8")).toBe("hello");
    await expect(lstat(join(root, "aaaa", "bbbb"))).rejects.toThrow();
  });

  it("refuses to rename the root", async () => {
    await mkdir(join(root, "d"));
    expect(
      failed(await run(ops, { op: "rename", path: ".", args: { to: "e" } })),
    ).toBe("EBUSY");
    expect(
      failed(await run(ops, { op: "rename", path: "d", args: { to: "." } })),
    ).toBe("EBUSY");
  });
});

describe("links", () => {
  it("creates a link inside the root and shows its target", async () => {
    await writeFile(join(root, "a.txt"), "hello");
    succeeded(
      await run(ops, { op: "symlink", path: "l", args: { target: "a.txt" } }),
    );
    const target = succeeded(await run(ops, { op: "readlink", path: "l" }))
      .result as { target: string };
    expect(target.target).toBe("a.txt");
  });

  /**
   * TEST_SCENARIO: AC-7. A link that leaves the root — absolute, or climbing more
   * `..` than its own directory lies below the root — is refused on creation, and
   * one the user made is listed with its target hidden, so the mount never makes
   * or shows a way out.
   */
  it("refuses a link out of the root and hides the target of one already there", async () => {
    expect(
      failed(
        await run(ops, {
          op: "symlink",
          path: "abs",
          args: { target: "/etc/passwd" },
        }),
      ),
    ).toBe("EPERM");
    expect(
      failed(
        await run(ops, {
          op: "symlink",
          path: "up",
          args: { target: "../outside.txt" },
        }),
      ),
    ).toBe("EPERM");
    expect(
      failed(
        await run(ops, {
          op: "symlink",
          path: "dot",
          args: { target: "a/./b" },
        }),
      ),
    ).toBe("EPERM");

    await symlink("/etc/passwd", join(root, "made-by-the-user"));
    expect(
      failed(await run(ops, { op: "readlink", path: "made-by-the-user" })),
    ).toBe("EACCES");
    expect((await attrs(ops, "made-by-the-user")).kind).toBe("link");
  });

  /**
   * TEST_SCENARIO: AC-8. `docs/notes/a.txt -> ../../shared/a.txt` stays inside the
   * root, so the Agent reads it and lists the target, while moving `docs/notes` to
   * the top of the root is answered EXDEV so `mv` copies it and re-creates the
   * link.
   */
  it("creates a link that stays inside the root and reads its target through the tree", async () => {
    await mkdir(join(root, "shared"));
    await writeFile(join(root, "shared", "a.txt"), "shared");
    await mkdir(join(root, "docs"));
    await mkdir(join(root, "docs", "notes"));

    succeeded(
      await run(ops, {
        op: "symlink",
        path: "docs/notes/a.txt",
        args: { target: "../../shared/a.txt" },
      }),
    );
    const target = succeeded(
      await run(ops, { op: "readlink", path: "docs/notes/a.txt" }),
    ).result as { target: string };
    expect(target.target).toBe("../../shared/a.txt");

    const shared = await attrs(ops, "shared/a.txt");
    const read = succeeded(
      await run(ops, {
        op: "read",
        path: "shared/a.txt",
        args: { offset: 0, size: 6, dev: shared.dev, ino: shared.ino },
      }),
    );
    expect(Buffer.from(read.data ?? "", "base64").toString()).toBe("shared");

    expect(
      failed(
        await run(ops, {
          op: "rename",
          path: "docs/notes",
          args: { to: "notes" },
        }),
      ),
    ).toBe("EXDEV");
  });

  it("keeps the link rule the same on both ends of the wire", () => {
    expect(targetStaysInside("../../shared/a.txt", 2)).toBe(true);
    expect(targetStaysInside("../../shared/a.txt", 1)).toBe(false);
    expect(targetStaysInside("/etc/passwd", 9)).toBe(false);
    expect(targetStaysInside("../a", 1)).toBe(true);
    expect(targetStaysInside("a/../b", 9)).toBe(false);
    expect(targetStaysInside("a//b", 9)).toBe(false);
    expect(targetStaysInside("", 1)).toBe(false);
  });
});

describe("changing a file's own attributes", () => {
  it("sets the rwx bits and drops setuid, setgid and sticky", async () => {
    await writeFile(join(root, "a.txt"), "hello");
    const file = await attrs(ops, "a.txt");
    const changed = attrsOf(
      await run(ops, {
        op: "setattr",
        path: "a.txt",
        args: { mode: 0o4755, dev: file.dev, ino: file.ino },
      }),
    );
    expect(changed.mode).toBe(0o755);
    expect((await lstat(join(root, "a.txt"))).mode & 0o7000).toBe(0);
  });

  it("sets the times on a verified handle", async () => {
    await writeFile(join(root, "a.txt"), "hello");
    const file = await attrs(ops, "a.txt");
    const at = 1_000_000_000_000;
    const changed = attrsOf(
      await run(ops, {
        op: "setattr",
        path: "a.txt",
        args: { atimeMs: at, mtimeMs: at, dev: file.dev, ino: file.ino },
      }),
    );
    expect(changed.mtimeMs).toBe(at);
    expect(changed.atimeMs).toBe(at);
  });

  /**
   * TEST_SCENARIO: `chmod` and `touch` on a directory are part of walking a tree —
   * `mkdir -m`, an unpack, a `git clone` that stamps a directory — so the attribute
   * change proves a directory handle too instead of answering EISDIR.
   */
  it("changes the mode and the times of a directory", async () => {
    await mkdir(join(root, "d"));
    const dir = await attrs(ops, "d");

    const changed = attrsOf(
      await run(ops, {
        op: "setattr",
        path: "d",
        args: { mode: 0o700, dev: dir.dev, ino: dir.ino },
      }),
    );
    expect(changed.kind).toBe("dir");
    expect(changed.mode).toBe(0o700);

    const stamped = attrsOf(
      await run(ops, {
        op: "setattr",
        path: "d",
        args: { mtimeMs: 1_000_000_000_000, dev: dir.dev, ino: dir.ino },
      }),
    );
    expect(stamped.mtimeMs).toBe(1_000_000_000_000);
  });

  it("refuses a chown the channel does not carry", async () => {
    await writeFile(join(root, "a.txt"), "hello");
    const file = await attrs(ops, "a.txt");
    expect(
      failed(
        await run(ops, {
          op: "setattr",
          path: "a.txt",
          args: { uid: 0, dev: file.dev, ino: file.ino },
        }),
      ),
    ).toBe("EINVAL");
  });

  /**
   * TEST_SCENARIO: AC-7. A file with a second hard link outside the root is listed,
   * but neither read nor written through: the one-link rule is what keeps content
   * from moving through a name someone else holds.
   */
  it("refuses to read or write a hard-linked file, and lists it", async () => {
    const outside = await mkdtemp(join(tmpdir(), "dam-file-ops-outside-"));
    try {
      const outsideFile = join(outside, "shared.txt");
      await writeFile(outsideFile, "secret");
      await link(outsideFile, join(root, "hard.txt"));

      const listed = succeeded(await run(ops, { op: "readdir", path: "." }))
        .result as { entries: { name: string; kind: string }[] };
      expect(
        listed.entries.find((entry) => entry.name === "hard.txt")?.kind,
      ).toBe("file");

      const file = await attrs(ops, "hard.txt");
      expect(
        failed(
          await run(ops, {
            op: "read",
            path: "hard.txt",
            args: { offset: 0, size: 6, dev: file.dev, ino: file.ino },
          }),
        ),
      ).toBe("EPERM");
      expect(
        failed(
          await run(ops, {
            op: "write",
            path: "hard.txt",
            args: { offset: 0, dev: file.dev, ino: file.ino },
            data: base64("x"),
          }),
        ),
      ).toBe("EPERM");
      expect(await readFile(outsideFile, "utf8")).toBe("secret");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses to open a FIFO, and still lists it", async () => {
    execFileSync("mkfifo", [join(root, "pipe")]);
    const listed = succeeded(await run(ops, { op: "readdir", path: "." }))
      .result as { entries: { name: string; kind: string }[] };
    expect(listed.entries.find((entry) => entry.name === "pipe")?.kind).toBe(
      "other",
    );
    expect(
      failed(
        await run(ops, { op: "open", path: "pipe", args: { write: false } }),
      ),
    ).toBe("EPERM");
  });

  it("reports the free space of the root's filesystem", async () => {
    const stat = succeeded(await run(ops, { op: "statfs", path: "." }))
      .result as Record<string, number>;
    expect(stat.bsize).toBeGreaterThan(0);
    expect(stat.blocks).toBeGreaterThan(0);
    expect(stat.bavail).toBeLessThanOrEqual(stat.bfree ?? stat.blocks);
  });
});

describe("the root is the whole allowlist", () => {
  /**
   * TEST_SCENARIO: AC-7. A path from the channel is relative segments or `.` for
   * the root and nothing else, and a link at the last name is never followed, so
   * nothing outside the root is read or written whatever the Agent sends.
   */
  it("refuses a path that is absolute, carries .. or a backslash", async () => {
    for (const path of ["/etc/passwd", "../outside", "a/../../b", "a\\b"])
      expect(failed(await run(ops, { op: "getattr", path }))).toBe("EACCES");
  });

  it("never follows a link out of the root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "dam-file-ops-outside-"));
    try {
      const outsideFile = join(outside, "secret.txt");
      await writeFile(outsideFile, "secret");
      await symlink(outsideFile, join(root, "out"));

      expect(
        failed(
          await run(ops, {
            op: "read",
            path: "out",
            args: { offset: 0, size: 6, dev: 1, ino: 1 },
          }),
        ),
      ).toBe("EPERM");
      expect(
        failed(
          await run(ops, {
            op: "write",
            path: "out",
            args: { offset: 0, dev: 1, ino: 1 },
            data: base64("x"),
          }),
        ),
      ).toBe("EPERM");
      expect(await readFile(outsideFile, "utf8")).toBe("secret");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  /**
   * TEST_SCENARIO: AC-7, through a link *inside* the root rather than at the last
   * name. `out` points at a directory outside the root, so every operation that
   * names something under it must fail at the directory that is not real — reading
   * a file below it, listing it, creating in it, and renaming into it — and nothing
   * outside may be read or changed.
   */
  it("refuses every operation under a linked directory that points outside the root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "dam-file-ops-outside-"));
    try {
      await writeFile(join(outside, "secret.txt"), "secret");
      await symlink(outside, join(root, "out"));
      await writeFile(join(root, "a.txt"), "hello");

      expect(
        failed(
          await run(ops, {
            op: "read",
            path: "out/secret.txt",
            args: { offset: 0, size: 6, dev: 1, ino: 1 },
          }),
        ),
      ).toBe("EACCES");
      expect(failed(await run(ops, { op: "readdir", path: "out" }))).toBe(
        "EACCES",
      );
      for (const request of [
        { op: "create", path: "out/x", args: { mode: 0o644, exclusive: true } },
        { op: "mkdir", path: "out/x", args: { mode: 0o755 } },
        { op: "symlink", path: "out/x", args: { target: "a.txt" } },
        { op: "rename", path: "a.txt", args: { to: "out/a.txt" } },
        { op: "unlink", path: "out/secret.txt" },
      ])
        expect(failed(await run(ops, request)), request.op).toBe("EACCES");

      expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe(
        "secret",
      );
      expect((await readdir(outside)).sort()).toEqual(["secret.txt"]);

      succeeded(await run(ops, { op: "unlink", path: "out" }));
      await expect(lstat(join(root, "out"))).rejects.toThrow();
      expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe(
        "secret",
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("re-resolves the root on every operation", async () => {
    const elsewhere = `${root}.moved`;
    await mkdir(elsewhere);
    await symlink(elsewhere, `${root}.link`);
    const swapped = createFileOps({ root: `${root}.link`, writable: true });
    expect(failed(await run(swapped, { op: "getattr", path: "." }))).toBe(
      "EACCES",
    );
    await rm(`${root}.link`, { force: true });
  });
});

describe("what a worker started without --write answers", () => {
  /**
   * TEST_SCENARIO: AC-4. The user's opt-in holds on their own machine as well as
   * on the platform: every mutating operation is refused here, `open` for a write
   * included, and nothing changes on disk.
   */
  it("answers EROFS to every mutation and changes nothing", async () => {
    const readOnly = createFileOps({ root, writable: false });
    await writeFile(join(root, "a.txt"), "hello");
    await mkdir(join(root, "d"));
    const file = await attrs(readOnly, "a.txt");

    const mutations = [
      { op: "create", path: "new.txt", args: { mode: 0o644, exclusive: true } },
      {
        op: "write",
        path: "a.txt",
        args: { offset: 0, dev: file.dev, ino: file.ino },
        data: base64("x"),
      },
      {
        op: "truncate",
        path: "a.txt",
        args: { size: 0, dev: file.dev, ino: file.ino },
      },
      {
        op: "setattr",
        path: "a.txt",
        args: { mode: 0o600, dev: file.dev, ino: file.ino },
      },
      { op: "mkdir", path: "d2", args: { mode: 0o755 } },
      { op: "rmdir", path: "d" },
      { op: "unlink", path: "a.txt" },
      { op: "rename", path: "a.txt", args: { to: "b.txt" } },
      { op: "symlink", path: "l", args: { target: "a.txt" } },
      {
        op: "open",
        path: "a.txt",
        args: { write: true, dev: file.dev, ino: file.ino },
      },
    ];
    for (const mutation of mutations)
      expect(failed(await run(readOnly, mutation)), mutation.op).toBe("EROFS");

    expect(await readFile(join(root, "a.txt"), "utf8")).toBe("hello");
    await expect(lstat(join(root, "new.txt"))).rejects.toThrow();
    expect((await attrs(readOnly, "a.txt")).mode).not.toBe(0o600);
  });

  it("serves reads and listings as usual", async () => {
    const readOnly = createFileOps({ root, writable: false });
    await writeFile(join(root, "a.txt"), "hello");
    const file = await attrs(readOnly, "a.txt");
    const read = succeeded(
      await run(readOnly, {
        op: "read",
        path: "a.txt",
        args: { offset: 0, size: 5, dev: file.dev, ino: file.ino },
      }),
    );
    expect(Buffer.from(read.data ?? "", "base64").toString()).toBe("hello");
  });
});

describe("what the channel cannot ask for", () => {
  /**
   * TEST_SCENARIO: The operation set is closed. A hard link, a special file, an
   * extended attribute and a fallocate are not operations the channel carries, so
   * the strict schema refuses each before anything reaches the machine, and the
   * answer an Agent sees is the same "invalid argument" a kernel gives for a
   * request it does not know.
   */
  it("answers EINVAL for an operation the channel does not carry", async () => {
    for (const request of [
      { op: "link", path: "a.txt", args: { to: "b.txt" } },
      { op: "mknod", path: "pipe" },
      { op: "setxattr", path: "a.txt" },
      { op: "fallocate", path: "a.txt" },
      { op: "wat", path: "a.txt" },
    ])
      expect(failed(await run(ops, request)), request.op).toBe("EINVAL");
  });
});

describe("the per-root lock", () => {
  /**
   * TEST_SCENARIO: One worker per root. A second worker on a directory already
   * served is refused with the pid that holds it, and a pid no process holds any
   * more is replaced, so a crash needs no cleanup by hand.
   */
  it("refuses a second worker on one root and replaces a dead pid", async () => {
    const home = await mkdtemp(join(tmpdir(), "dam-file-ops-home-"));
    try {
      const held = await lockRoot(root, home);
      expect(held.ok).toBe(true);
      const second = await lockRoot(root, home);
      expect(second.ok).toBe(false);
      if (!second.ok) {
        expect(second.reason).toContain("already served");
        expect(second.reason).toContain(String(process.pid));
      }

      if (held.ok) held.release();
      const again = await lockRoot(root, home);
      expect(again.ok).toBe(true);
      if (again.ok) again.release();

      await writeFile(rootLockPath(root, home), "999999");
      const replaced = await lockRoot(root, home);
      expect(replaced.ok).toBe(true);
      if (replaced.ok) replaced.release();
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });
});

describe("the root a files satellite exposes", () => {
  it("refuses the home directory, the whole filesystem, a file and a path that is not there", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dam-root-"));
    try {
      const root = await realpath(dir);
      const file = join(root, "app.log");
      await writeFile(file, "x");
      for (const raw of ["/", homedir()])
        expect((await pinRoot(raw)).ok).toBe(false);
      expect((await pinRoot(file)).ok).toBe(false);
      expect((await pinRoot(join(root, "nope"))).ok).toBe(false);
      expect(await pinRoot(root)).toEqual({ ok: true, root });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a path that is not one relative name per segment", () => {
    expect(pathSegments("logs/app.log")).toEqual(["logs", "app.log"]);
    for (const bad of [
      "../outside/secret.txt",
      "/etc/passwd",
      "logs/../outside/secret.txt",
      "logs/./app.log",
      "logs//app.log",
      "logs\\app.log",
      "",
      "a\0b",
      `logs/${"x".repeat(1100)}`,
    ])
      expect(pathSegments(bad)).toBeNull();
  });
});
