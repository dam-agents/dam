import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createConfined,
  openConfined,
  publishConfined,
  TRANSFER_STAGING_DIR,
  workspaceSegments,
} from "../../modules/transfer/confined.js";
import { createTransferHandlers } from "../../modules/transfer/http.js";

/**
 * TEST_OVERVIEW: The workspace end of a satellite file transfer. The Agent owns
 * everything inside its own workspace, links included, so a transfer must not
 * follow one: every path is walked component by component, opened with
 * O_NOFOLLOW, and the descriptor is compared with the path it was opened by
 * (same device and inode, a regular file, one link). The specs pin each way out
 * — a symlink to a file outside, a symlinked directory, a hard link to an
 * outside inode, a FIFO that would hang the reader, a staged file swapped after
 * it was written — and pin the byte cap on both the read and the stage.
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
  it("stages under a name nobody has taken and publishes it once", async () => {
    const staged = await createConfined(root, TRANSFER_STAGING_DIR, "abc123");
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;
    await staged.handle.writeFile("one");
    await staged.handle.close();

    const published = await publishConfined(
      root,
      [...TRANSFER_STAGING_DIR, "abc123"],
      [".dam", "satellite-files", "laptop-1", "note.txt"],
      CAP,
    );
    expect(published.ok).toBe(true);
    expect(
      await readFile(
        join(root, ".dam/satellite-files/laptop-1/note.txt"),
        "utf8",
      ),
    ).toBe("one");
  });

  it("refuses to publish over a file that is already there", async () => {
    const target = join(
      root,
      ".dam",
      "satellite-files",
      "laptop-2",
      "taken.txt",
    );
    await mkdir(join(root, ".dam", "satellite-files", "laptop-2"), {
      recursive: true,
    });
    await writeFile(target, "original");

    const staged = await createConfined(root, TRANSFER_STAGING_DIR, "def456");
    if (!staged.ok) throw new Error(staged.reason);
    await staged.handle.writeFile("replacement");
    await staged.handle.close();

    const published = await publishConfined(
      root,
      [...TRANSFER_STAGING_DIR, "def456"],
      [".dam", "satellite-files", "laptop-2", "taken.txt"],
      CAP,
    );
    expect(published).toMatchObject({ ok: false, reason: "exists" });
    expect(await readFile(target, "utf8")).toBe("original");
  });

  it("refuses to publish a staged file that was swapped for a link", async () => {
    const staged = await createConfined(root, TRANSFER_STAGING_DIR, "aaa111");
    if (!staged.ok) throw new Error(staged.reason);
    await staged.handle.writeFile("one");
    await staged.handle.close();
    const stagedPath = join(root, ...TRANSFER_STAGING_DIR, "aaa111");
    await rm(stagedPath);
    await symlink(join(outside, "secret.txt"), stagedPath);

    const published = await publishConfined(
      root,
      [...TRANSFER_STAGING_DIR, "aaa111"],
      [".dam", "satellite-files", "laptop-3", "x.txt"],
      CAP,
    );
    expect(published).toMatchObject({ ok: false, reason: "refused" });
    await expect(
      readFile(join(root, ".dam/satellite-files/laptop-3/x.txt"), "utf8"),
    ).rejects.toThrow();
  });

  it("refuses to create a file where one exists", async () => {
    const first = await createConfined(root, TRANSFER_STAGING_DIR, "bbb222");
    if (first.ok) await first.handle.close();
    const second = await createConfined(root, TRANSFER_STAGING_DIR, "bbb222");
    expect(second).toMatchObject({ ok: false, reason: "exists" });
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

  it("stages a body, publishes it where it was asked, and reads it back", async () => {
    const staged = await fetch(`${base}/api/transfer/stage`, {
      method: "POST",
      body: Buffer.from("body bytes"),
    });
    expect(staged.status).toBe(200);
    const { id } = (await staged.json()) as { id: string };

    const published = await fetch(`${base}/api/transfer/publish`, {
      method: "POST",
      body: JSON.stringify({
        id,
        path: ".dam/satellite-files/laptop-4/given.txt",
      }),
    });
    expect(published.status).toBe(200);

    const read = await fetch(
      `${base}/api/transfer/read?path=${encodeURIComponent(".dam/satellite-files/laptop-4/given.txt")}`,
    );
    expect(read.status).toBe(200);
    expect(await read.text()).toBe("body bytes");
  });

  it("refuses a body over the cap and publishes nothing", async () => {
    const staged = await fetch(`${base}/api/transfer/stage`, {
      method: "POST",
      body: Buffer.alloc(CAP + 1, 1),
    });
    expect(staged.status).toBe(413);
    expect(await staged.json()).toEqual({ error: "transfer_too_large" });
  });

  it("refuses a path outside the workspace on publish and on read", async () => {
    const staged = await fetch(`${base}/api/transfer/stage`, {
      method: "POST",
      body: Buffer.from("x"),
    });
    const { id } = (await staged.json()) as { id: string };
    for (const path of ["../outside/secret.txt", "work/linked-dir/x.txt"]) {
      const published = await fetch(`${base}/api/transfer/publish`, {
        method: "POST",
        body: JSON.stringify({ id, path }),
      });
      expect(published.status).toBe(400);
    }
    const read = await fetch(
      `${base}/api/transfer/read?path=${encodeURIComponent("work/link.txt")}`,
    );
    expect(read.status).toBe(409);
    expect(await read.text()).not.toContain("SECRET");
  });
});
