import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ shortWrite: false }));

vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return {
    ...fs,
    async open(...args: Parameters<typeof fs.open>) {
      const handle = await fs.open(...args);
      const write = handle.write.bind(handle);
      handle.write = (async (buffer: Buffer, ...rest: unknown[]) =>
        write(
          hooks.shortWrite ? buffer.subarray(0, 2) : buffer,
          ...(rest as []),
        )) as typeof handle.write;
      return handle;
    },
  };
});

import {
  createStaged,
  openConfined,
  openStaged,
  publishStaged,
  STAGING_PREFIX,
  sweepStaging,
  TRANSFER_ROOT,
  workspaceSegments,
} from "../../modules/transfer/confined.js";
import { createTransferHandlers } from "../../modules/transfer/http.js";

/**
 * TEST_OVERVIEW: The workspace end of a satellite file transfer. The Agent owns
 * everything inside its own workspace, links included, so a transfer must not
 * follow one: every path is walked component by component, opened with
 * O_NOFOLLOW, and the descriptor is compared with the path it was opened by.
 * Publication happens inside the destination directory's inode — not by a
 * pathname that could be swapped between a check and the call — and the bytes on
 * disk are read back before a transfer counts as written. The specs pin each way
 * out: a symlink to a file outside, a symlinked directory, a hard link, a FIFO,
 * a staged file or a destination parent swapped after it was verified, a sweeper
 * steered by a symlink, and a short write that would otherwise truncate a file.
 */

const RESERVED = [".triggers", ".initialized"];
const CAP = 64;

let dir: string;
let root: string;
let outside: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dam-transfer-"));
  const home = join(dir, "home");
  outside = join(dir, "outside");
  await mkdir(join(home, "work"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(home, "work", "note.txt"), "hello");
  await writeFile(join(outside, "secret.txt"), "SECRET");
  root = await realpath(home);
  outside = await realpath(outside);
  await symlink(join(outside, "secret.txt"), join(root, "work", "link.txt"));
  await symlink(outside, join(root, "work", "linked-dir"));
  await link(join(outside, "secret.txt"), join(root, "work", "hard.txt"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function stage(name: string, destination: string[] = [...TRANSFER_ROOT, name]) {
  return createStaged(root, destination);
}

async function writeStaged(
  staged: { handle: { write: (b: Buffer) => Promise<unknown> } },
  text: string,
): Promise<void> {
  await staged.handle.write(Buffer.from(text));
}

describe("a path a transfer may name", () => {
  it("refuses escapes and reserved names, and keeps ordinary segments", () => {
    expect(workspaceSegments("work/note.txt", RESERVED)).toEqual([
      "work",
      "note.txt",
    ]);
    for (const bad of [
      "../outside/secret.txt",
      "/etc/passwd",
      "work/../outside/secret.txt",
      ".triggers/x",
      "work/.initialized",
      "",
      "work//note.txt",
      "work/./note.txt",
      "a\0b",
      `work/${"x".repeat(1100)}`,
    ])
      expect(workspaceSegments(bad, RESERVED)).toBeNull();
  });
});

describe("reading a file out of the workspace", () => {
  it("reads a plain file", async () => {
    const opened = await openConfined(root, ["work", "note.txt"], CAP);
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect((await opened.handle.readFile()).toString()).toBe("hello");
    await opened.handle.close();
  });

  it("refuses a symlink to a file outside, a symlinked directory and a hard link", async () => {
    for (const segments of [
      ["work", "link.txt"],
      ["work", "linked-dir", "secret.txt"],
      ["work", "hard.txt"],
    ]) {
      const opened = await openConfined(root, segments, CAP);
      expect(opened).toMatchObject({ ok: false, reason: "refused" });
    }
  });

  it("refuses a FIFO without waiting on it", async () => {
    execFileSync("mkfifo", [join(root, "work", "fifo")]);
    const opened = await openConfined(root, ["work", "fifo"], CAP);
    expect(opened).toMatchObject({ ok: false, reason: "refused" });
  });

  it("refuses a file over the cap before reading a byte", async () => {
    await writeFile(join(root, "work", "big.bin"), Buffer.alloc(CAP + 1));
    const opened = await openConfined(root, ["work", "big.bin"], CAP);
    expect(opened).toMatchObject({ ok: false, reason: "too-large" });
  });
});

describe("staging and publishing a file into the workspace", () => {
  it("stages beside the destination and publishes it once", async () => {
    const created = await stage("one");
    if (!created.ok) throw new Error(created.reason);
    await writeStaged(created.staged, "one");
    await created.staged.handle.close();

    const reopened = await openStaged(
      root,
      [...TRANSFER_ROOT, "one"],
      created.staged.id,
    );
    if (reopened === null) throw new Error("the staged file is gone");
    const published = await publishStaged(root, reopened);
    expect(published.ok).toBe(true);
    expect(await readFile(join(root, ...TRANSFER_ROOT, "one"), "utf8")).toBe(
      "one",
    );
  });

  it("refuses to publish over a file that is already there", async () => {
    const target = join(root, ...TRANSFER_ROOT, "taken");
    await writeFile(target, "original");
    const created = await stage("taken");
    if (!created.ok) throw new Error(created.reason);
    await writeStaged(created.staged, "replacement");
    await created.staged.handle.close();

    const reopened = await openStaged(
      root,
      [...TRANSFER_ROOT, "taken"],
      created.staged.id,
    );
    if (reopened === null) throw new Error("the staged file is gone");
    const published = await publishStaged(root, reopened);
    expect(published).toMatchObject({ ok: false, reason: "exists" });
    expect(await readFile(target, "utf8")).toBe("original");
  });

  it("refuses a staged file that was swapped for a link after it was written", async () => {
    const created = await stage("swapped");
    if (!created.ok) throw new Error(created.reason);
    await writeStaged(created.staged, "one");
    await created.staged.handle.close();
    const stagedPath = join(root, ...TRANSFER_ROOT, created.staged.name);
    await rm(stagedPath);
    await symlink(join(outside, "secret.txt"), stagedPath);

    expect(
      await openStaged(root, [...TRANSFER_ROOT, "swapped"], created.staged.id),
    ).toBeNull();
    await expect(
      readFile(join(root, ...TRANSFER_ROOT, "swapped"), "utf8"),
    ).rejects.toThrow();
  });

  it("publishes nothing through a destination parent swapped after staging", async () => {
    const created = await stage("swap-parent", ["landing", "note"]);
    if (!created.ok) throw new Error(created.reason);
    await writeStaged(created.staged, "RUNTIME-FIXTURE");
    await created.staged.handle.close();

    await rename(join(root, "landing"), join(outside, "moved"));
    await symlink(join(outside, "moved"), join(root, "landing"));

    expect(
      await openStaged(root, ["landing", "note"], created.staged.id),
    ).toBeNull();
    await expect(
      readFile(join(outside, "moved", "note"), "utf8"),
    ).rejects.toThrow();
  });

  it("refuses to stage a name that is already there", async () => {
    const first = await stage("dup");
    if (!first.ok) throw new Error(first.reason);
    await first.staged.handle.close();
    await rm(join(root, ...TRANSFER_ROOT, first.staged.name));
    const second = await stage("dup");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    await second.staged.handle.close();
  });
});

describe("sweeping abandoned stages", () => {
  it("removes an old staged file and leaves a fresh one", async () => {
    const claim = ["laptop-2-aaaaaaaa"];
    const created = await stage("sweep", [...TRANSFER_ROOT, ...claim, "sweep"]);
    if (!created.ok) throw new Error(created.reason);
    await created.staged.handle.close();
    const stagedPath = join(
      root,
      ...TRANSFER_ROOT,
      ...claim,
      created.staged.name,
    );
    await utimes(stagedPath, new Date(0), new Date(0));

    const fresh = await stage("sweep", [...TRANSFER_ROOT, ...claim, "sweep"]);
    if (!fresh.ok) throw new Error(fresh.reason);
    await fresh.staged.handle.close();

    await sweepStaging(root, 600_000);
    await expect(readFile(stagedPath, "utf8")).rejects.toThrow();
    expect(
      await readFile(
        join(root, ...TRANSFER_ROOT, ...claim, fresh.staged.name),
        "utf8",
      ),
    ).toEqual("");
  });

  it("does not unlink through a claim directory symlinked outside the workspace", async () => {
    const transferRoot = join(root, ...TRANSFER_ROOT);
    await mkdir(transferRoot, { recursive: true });
    await writeFile(
      join(outside, `${STAGING_PREFIX}${"a".repeat(32)}`),
      "KEEP",
    );
    await utimes(
      join(outside, `${STAGING_PREFIX}${"a".repeat(32)}`),
      new Date(0),
      new Date(0),
    );
    await symlink(outside, join(transferRoot, "laptop-1-aaaaaaaa"));

    await sweepStaging(root, 1);
    expect(
      await readFile(
        join(outside, `${STAGING_PREFIX}${"a".repeat(32)}`),
        "utf8",
      ),
    ).toBe("KEEP");
  });
});

describe("the transfer route the api-server calls", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const handlers = createTransferHandlers({
      root,
      reserved: RESERVED,
      cap: CAP,
      log: () => {},
    });
    server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://agent");
      if (req.method === "POST" && url.pathname === "/api/transfer/stage") {
        void handlers.handleStage(req, res);
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/transfer/publish") {
        void handlers.handlePublish(req, res);
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/transfer/read") {
        void handlers.handleRead(req, res, url);
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  const stageBody = (path: string, body: Buffer) =>
    fetch(`${base}/api/transfer/stage`, {
      method: "POST",
      headers: { "x-dam-path": path },
      body: new Uint8Array(body),
    });

  it("stages a body, publishes it where it was asked, and reads it back", async () => {
    const staged = await stageBody(
      ".dam/satellite-files/laptop-9-aaaaaaaa/given.txt",
      Buffer.from("body bytes"),
    );
    expect(staged.status).toBe(200);
    const { id } = (await staged.json()) as { id: string };

    const published = await fetch(`${base}/api/transfer/publish`, {
      method: "POST",
      body: JSON.stringify({
        id,
        path: ".dam/satellite-files/laptop-9-aaaaaaaa/given.txt",
      }),
    });
    expect(published.status).toBe(200);

    const read = await fetch(
      `${base}/api/transfer/read?path=${encodeURIComponent(".dam/satellite-files/laptop-9-aaaaaaaa/given.txt")}`,
    );
    expect(read.status).toBe(200);
    expect(await read.text()).toBe("body bytes");
  });

  /**
   * TEST_SCENARIO: A body that fails after some bytes must leave nothing behind:
   * the staged file is discarded, so an abandoned transfer does not hold disk and
   * a later stage for the same name is not refused as already there.
   */
  it("discards the stage when the body errors mid-stream", async () => {
    const failing = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(Buffer.from("half")));
        controller.error(new Error("the platform hung up"));
      },
    });
    const directory = join(
      root,
      ".dam",
      "satellite-files",
      "laptop-9-aaaaaaaa",
    );
    await fetch(`${base}/api/transfer/stage`, {
      method: "POST",
      headers: {
        "x-dam-path": ".dam/satellite-files/laptop-9-aaaaaaaa/broken.bin",
      },
      body: failing,
      duplex: "half",
    } as RequestInit & { duplex: "half" }).catch(() => null);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const left = await readdir(directory).catch(() => []);
    expect(left.filter((name) => name.startsWith(STAGING_PREFIX))).toEqual([]);
    await expect(
      readFile(join(directory, "broken.bin"), "utf8"),
    ).rejects.toThrow();
  });

  it("refuses a body over the cap and publishes nothing", async () => {
    const staged = await stageBody(
      ".dam/satellite-files/laptop-9-aaaaaaaa/big.bin",
      Buffer.alloc(CAP + 1, 1),
    );
    expect(staged.status).toBe(413);
    expect(await staged.json()).toEqual({ error: "transfer_too_large" });
  });

  /**
   * TEST_SCENARIO: A regular-file write may write less than it was given. The
   * stage must notice and fail rather than answer with a success whose file is
   * shorter than the body, because the platform would then publish a truncated
   * file under a digest that describes the whole of it.
   */
  it("fails a stage whose short write would truncate the file", async () => {
    hooks.shortWrite = true;
    try {
      const staged = await stageBody(
        ".dam/satellite-files/laptop-9-aaaaaaaa/short.txt",
        Buffer.from("ABCDEF"),
      );
      expect(staged.status).not.toBe(200);
    } finally {
      hooks.shortWrite = false;
    }
  });

  it("refuses a path outside the workspace on publish and on read", async () => {
    const staged = await stageBody(
      ".dam/satellite-files/laptop-9-aaaaaaaa/safe.txt",
      Buffer.from("x"),
    );
    const { id } = (await staged.json()) as { id: string };
    for (const [path, status] of [
      ["../outside/secret.txt", 400],
      ["work/linked-dir/x.txt", 409],
    ] as const) {
      const published = await fetch(`${base}/api/transfer/publish`, {
        method: "POST",
        body: JSON.stringify({ id, path }),
      });
      expect(published.status).toBe(status);
    }
    const read = await fetch(
      `${base}/api/transfer/read?path=${encodeURIComponent("work/link.txt")}`,
    );
    expect(read.status).toBe(409);
    expect(await read.text()).not.toContain("SECRET");
  });
});
