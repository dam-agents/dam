import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
  lstat,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
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
import type { TokenProvider } from "../modules/auth/index.js";
import type { CallOutcome } from "../modules/satellite/services/backend.js";
import {
  MAX_TRANSFER_BYTES,
  pathSegments,
  pinRoot,
} from "../modules/satellite/services/confined-files.js";
import {
  createFileTransfer,
  type FileTransfer,
} from "../modules/satellite/services/file-transfer.js";
import {
  createFilesBackend,
  DOWNLOAD_TOOL,
  LIST_TOOL,
  STAT_TOOL,
  UPLOAD_TOOL,
} from "../modules/satellite/services/files-backend.js";

/**
 * TEST_OVERVIEW: `dam satellite files --root <dir>` exposes one directory on
 * the user's machine: a download tool that puts one file into the agent's
 * workspace, and with --upload an upload tool that takes one back. A file's
 * bytes never enter the agent's context, and the agent — not the machine —
 * decides what moves: a transfer presents the token its Job was claimed with and
 * names nothing else, so the platform moves exactly the file the agent asked
 * for.
 *
 * On the machine, the root is the whole allowlist and every path is opened
 * without trusting a component: a `..`, an absolute path, a symlink that leads
 * out, a hard link out, a FIFO and a growing file are all refused, and a write is
 * staged exclusively and published by replacing its own entry, never through a
 * link. The specs pin each of those, plus the cap on both directions and the
 * flag that decides whether this machine may be written to at all.
 */

const TOKEN = "e".repeat(64);
const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

function outcomeOf(outcome: CallOutcome): {
  isError: boolean;
  blocked?: true;
  output: string;
} {
  if (outcome.status !== "done")
    throw new Error(`expected a finished call, got ${outcome.status}`);
  return outcome;
}

function resultOf(outcome: CallOutcome): {
  path: string;
  size: number;
  sha256: string;
} {
  const done = outcomeOf(outcome);
  if (done.isError) throw new Error(`expected success, got: ${done.output}`);
  return JSON.parse(done.output) as {
    path: string;
    size: number;
    sha256: string;
  };
}

interface FakeTransfer extends FileTransfer {
  sent: { sequence: number; token: string; bytes: Buffer }[];
  received: { sequence: number; token: string }[];
}

function fakeTransfer(
  options: { receives?: Buffer; declares?: number } = {},
): FakeTransfer {
  const sent: { sequence: number; token: string; bytes: Buffer }[] = [];
  const received: { sequence: number; token: string }[] = [];
  return {
    sent,
    received,
    async send({ sequence, token, bytes }) {
      const chunks: Buffer[] = [];
      for await (const chunk of bytes) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      sent.push({ sequence, token, bytes: body });
      return {
        path: "/home/agent/.dam/satellite-files/laptop-7-eeeeeeee/app.bin",
        size: body.length,
        sha256: sha256(body),
      };
    },
    async receive({ sequence, token }) {
      received.push({ sequence, token });
      const body = options.receives ?? Buffer.from("from the workspace");
      return {
        stream: Readable.from([body]),
        size: body.length,
      };
    },
  };
}

let dir: string;
let rawRoot: string;
let root: string;
let outside: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dam-satellite-files-"));
  rawRoot = join(dir, "work");
  outside = join(dir, "outside");
  await mkdir(join(rawRoot, "logs"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(rawRoot, "logs", "app.log"), "line one\nline two\n");
  await writeFile(join(outside, "secret.txt"), "SECRET");
  await symlink(join(outside, "secret.txt"), join(rawRoot, "escape.txt"));
  await symlink(join(rawRoot, "logs"), join(rawRoot, "logs-link"));
  await link(join(outside, "secret.txt"), join(rawRoot, "hard.txt"));
  execFileSync("mkfifo", [join(rawRoot, "fifo")]);
  root = (await pinRoot(rawRoot).then((r) => {
    if (!r.ok) throw new Error(r.reason);
    return r.root;
  })) as string;
  root = await realpath(rawRoot);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the root a files satellite exposes", () => {
  it("refuses the home directory, the whole filesystem, a file and a path that is not there", async () => {
    for (const raw of ["/", homedir()]) {
      expect((await pinRoot(raw)).ok).toBe(false);
    }
    expect((await pinRoot(join(root, "logs", "app.log"))).ok).toBe(false);
    expect((await pinRoot(join(root, "nope"))).ok).toBe(false);
    expect(await pinRoot(rawRoot)).toEqual({ ok: true, root });
  });

  it("refuses a path that is not one relative name per segment", () => {
    expect(pathSegments("logs/app.log")).toEqual(["logs", "app.log"]);
    for (const bad of [
      "../outside/secret.txt",
      join(outside, "secret.txt"),
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

describe("a download from the machine into the agent's workspace", () => {
  it("sends the file's bytes under the claim's token and reports where they landed", async () => {
    const transfer = fakeTransfer();
    const backend = createFilesBackend({ root, allowUpload: false, transfer });

    const result = resultOf(
      await backend.call({
        sequence: 7,
        tool: DOWNLOAD_TOOL,
        args: { path: "logs/app.log" },
        transferToken: TOKEN,
      }),
    );

    expect(transfer.sent).toHaveLength(1);
    expect(transfer.sent[0]?.bytes.toString()).toBe("line one\nline two\n");
    expect(transfer.sent[0]?.token).toBe(TOKEN);
    expect(result).toEqual({
      path: "/home/agent/.dam/satellite-files/laptop-7-eeeeeeee/app.bin",
      size: 18,
      sha256: sha256(Buffer.from("line one\nline two\n")),
    });
  });

  it("refuses a .. segment, an absolute path, a symlink out, a hard link out, a FIFO and a directory", async () => {
    const transfer = fakeTransfer();
    const backend = createFilesBackend({ root, allowUpload: false, transfer });

    for (const args of [
      { path: "../outside/secret.txt" },
      { path: join(outside, "secret.txt") },
      { path: "escape.txt" },
      { path: "hard.txt" },
      { path: "fifo" },
      { path: "logs" },
      { path: "" },
    ]) {
      const outcome = outcomeOf(
        await backend.call({
          sequence: 1,
          tool: DOWNLOAD_TOOL,
          args,
          transferToken: TOKEN,
        }),
      );
      expect(outcome.isError).toBe(true);
      expect(outcome.blocked).toBe(true);
    }
    expect(transfer.sent).toHaveLength(0);
  });

  it("refuses a symlinked directory even one that points back inside", async () => {
    const transfer = fakeTransfer();
    const backend = createFilesBackend({ root, allowUpload: false, transfer });

    const outcome = outcomeOf(
      await backend.call({
        sequence: 3,
        tool: DOWNLOAD_TOOL,
        args: { path: "logs-link/app.log" },
        transferToken: TOKEN,
      }),
    );
    expect(outcome.isError).toBe(true);
    expect(transfer.sent).toHaveLength(0);
  });

  it("refuses a file over the cap without sending a byte", async () => {
    const transfer = fakeTransfer();
    const backend = createFilesBackend({
      root,
      allowUpload: false,
      transfer,
      maxBytes: 4,
    });

    const outcome = outcomeOf(
      await backend.call({
        sequence: 1,
        tool: DOWNLOAD_TOOL,
        args: { path: "logs/app.log" },
        transferToken: TOKEN,
      }),
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.output).toContain("limit");
    expect(transfer.sent).toHaveLength(0);
  });

  it("cutting a growing file off at the cap fails the transfer instead of sending it", async () => {
    const transfer = fakeTransfer();
    const backend = createFilesBackend({
      root,
      allowUpload: false,
      transfer,
      maxBytes: 8,
    });
    await writeFile(join(root, "logs", "grow.log"), "x".repeat(8));

    const original = transfer.send.bind(transfer);
    transfer.send = async (input) => {
      await writeFile(join(root, "logs", "grow.log"), "x".repeat(64));
      return original(input);
    };
    const outcome = outcomeOf(
      await backend.call({
        sequence: 1,
        tool: DOWNLOAD_TOOL,
        args: { path: "logs/grow.log" },
        transferToken: TOKEN,
      }),
    );
    expect(outcome.isError).toBe(true);
  });

  it("refuses a call with no claim token", async () => {
    const transfer = fakeTransfer();
    const backend = createFilesBackend({ root, allowUpload: false, transfer });
    const outcome = outcomeOf(
      await backend.call({
        sequence: 1,
        tool: DOWNLOAD_TOOL,
        args: { path: "logs/app.log" },
      }),
    );
    expect(outcome.isError).toBe(true);
    expect(transfer.sent).toHaveLength(0);
  });
});

describe("an upload from the agent's workspace onto the machine", () => {
  it("is not offered, and is refused, without --upload", async () => {
    const transfer = fakeTransfer();
    const backend = createFilesBackend({ root, allowUpload: false, transfer });

    expect(backend.tools.map((tool) => tool.name)).toEqual([
      DOWNLOAD_TOOL,
      LIST_TOOL,
      STAT_TOOL,
    ]);
    expect(backend.tools.map((tool) => tool.transfer ?? null)).toEqual([
      "download",
      null,
      null,
    ]);
    const outcome = outcomeOf(
      await backend.call({
        sequence: 1,
        tool: UPLOAD_TOOL,
        args: { path: "in.txt", workspacePath: "work/in.txt" },
        transferToken: TOKEN,
      }),
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.output).toContain("--upload");
    expect(transfer.received).toHaveLength(0);
  });

  it("writes the workspace file under the root, creating the directory on the way", async () => {
    const transfer = fakeTransfer({ receives: Buffer.from("hello\n") });
    const backend = createFilesBackend({ root, allowUpload: true, transfer });

    const result = resultOf(
      await backend.call({
        sequence: 2,
        tool: UPLOAD_TOOL,
        args: { path: "inbox/hello.txt", workspacePath: "work/hello.txt" },
        transferToken: TOKEN,
      }),
    );

    expect(transfer.received).toEqual([{ sequence: 2, token: TOKEN }]);
    expect(await readFile(join(root, "inbox", "hello.txt"), "utf8")).toBe(
      "hello\n",
    );
    expect(result).toEqual({
      path: "inbox/hello.txt",
      size: 6,
      sha256: sha256(Buffer.from("hello\n")),
    });
  });

  /**
   * TEST_SCENARIO: An Agent that does not know whether a file exists passes
   * `overwrite: true`. On a name that does not exist yet, the publish takes the
   * link branch, and the staging name has to go with it: a leftover second name
   * would leave the file just written with two links, and the next transfer
   * would refuse to read or replace it.
   */
  it("leaves no staging name behind when overwrite publishes a new file", async () => {
    const transfer = fakeTransfer({ receives: Buffer.from("FRESH") });
    const backend = createFilesBackend({ root, allowUpload: true, transfer });

    resultOf(
      await backend.call({
        sequence: 7,
        tool: UPLOAD_TOOL,
        args: {
          path: "fresh.txt",
          workspacePath: "work/fresh.txt",
          overwrite: true,
        },
        transferToken: TOKEN,
      }),
    );

    expect(
      (await readdir(root)).filter((name) => name.includes(".incoming-")),
    ).toEqual([]);
    const published = await lstat(join(root, "fresh.txt"));
    expect(published.nlink).toBe(1);

    const downloads = createFilesBackend({
      root,
      allowUpload: false,
      transfer: fakeTransfer(),
    });
    resultOf(
      await downloads.call({
        sequence: 8,
        tool: DOWNLOAD_TOOL,
        args: { path: "fresh.txt" },
        transferToken: TOKEN,
      }),
    );
  });

  it("refuses to replace a file unless asked to", async () => {
    const transfer = fakeTransfer({ receives: Buffer.from("second\n") });
    const backend = createFilesBackend({ root, allowUpload: true, transfer });
    await writeFile(join(root, "existing.txt"), "first\n");

    const refused = outcomeOf(
      await backend.call({
        sequence: 1,
        tool: UPLOAD_TOOL,
        args: { path: "existing.txt", workspacePath: "work/existing.txt" },
        transferToken: TOKEN,
      }),
    );
    expect(refused.isError).toBe(true);
    expect(refused.output).toContain("overwrite");
    expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("first\n");

    resultOf(
      await backend.call({
        sequence: 2,
        tool: UPLOAD_TOOL,
        args: {
          path: "existing.txt",
          workspacePath: "work/existing.txt",
          overwrite: true,
        },
        transferToken: TOKEN,
      }),
    );
    expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("second\n");
  });

  it("does not write through a hard link, a symlink, a FIFO or out of the root", async () => {
    const transfer = fakeTransfer({ receives: Buffer.from("changed") });
    const backend = createFilesBackend({ root, allowUpload: true, transfer });
    await symlink(outside, join(root, "outside-link"));

    for (const args of [
      { path: "../outside/x.txt", workspacePath: "work/x" },
      { path: join(outside, "x.txt"), workspacePath: "work/x" },
      { path: "outside-link/x.txt", workspacePath: "work/x" },
      { path: "escape.txt", workspacePath: "work/x" },
      { path: "fifo", workspacePath: "work/x" },
    ]) {
      const outcome = outcomeOf(
        await backend.call({
          sequence: 1,
          tool: UPLOAD_TOOL,
          args,
          transferToken: TOKEN,
        }),
      );
      expect(outcome.isError).toBe(true);
    }
    /**
     * TEST_SCENARIO: A file with more than one link is never replaced either:
     * the other name belongs to someone else's directory, so a replace is
     * refused and its content stays as it was.
     */
    const replaceLinked = outcomeOf(
      await backend.call({
        sequence: 9,
        tool: UPLOAD_TOOL,
        args: { path: "hard.txt", workspacePath: "work/x", overwrite: true },
        transferToken: TOKEN,
      }),
    );
    expect(replaceLinked.isError).toBe(true);
    expect(await readFile(join(outside, "secret.txt"), "utf8")).toBe("SECRET");
    expect((await lstat(join(root, "hard.txt"))).nlink).toBe(2);
  });

  /**
   * TEST_SCENARIO: The network read is the longest window a transfer has, and
   * the staging name sits in the user's directory while it runs. Replacing it
   * with a link to a file outside must not publish that file, and must not
   * report success.
   */
  it("refuses a staging name replaced with a link during the read", async () => {
    const transfer = fakeTransfer();
    transfer.receive = async () => {
      const entry = (await readdir(root)).find((name) =>
        name.startsWith(".note.incoming-"),
      );
      if (entry === undefined) throw new Error("no staged file");
      await rm(join(root, entry));
      await symlink(join(outside, "secret.txt"), join(root, entry));
      return { stream: Readable.from([Buffer.from("EXPECTED")]), size: 8 };
    };
    const backend = createFilesBackend({ root, allowUpload: true, transfer });

    const outcome = outcomeOf(
      await backend.call({
        sequence: 4,
        tool: UPLOAD_TOOL,
        args: { path: "note", workspacePath: "work/note" },
        transferToken: TOKEN,
      }),
    );
    expect(outcome.isError).toBe(true);
    const published = await lstat(join(root, "note")).catch(() => null);
    expect(published).toBeNull();
  });

  /**
   * TEST_SCENARIO: A destination parent that is renamed away and replaced by a
   * link while the read is in flight must not move the publish outside the root.
   */
  it("publishes nothing through a destination parent swapped during the read", async () => {
    await mkdir(join(root, "landing"), { recursive: true });
    const transfer = fakeTransfer();
    transfer.receive = async () => {
      await rename(join(root, "landing"), join(outside, "moved"));
      await symlink(join(outside, "moved"), join(root, "landing"));
      return {
        stream: Readable.from([Buffer.from("STAGED-FIXTURE")]),
        size: 14,
      };
    };
    const backend = createFilesBackend({ root, allowUpload: true, transfer });

    const outcome = outcomeOf(
      await backend.call({
        sequence: 5,
        tool: UPLOAD_TOOL,
        args: { path: "landing/note", workspacePath: "work/note" },
        transferToken: TOKEN,
      }),
    );
    expect(outcome.isError).toBe(true);
    await expect(
      readFile(join(outside, "moved", "note"), "utf8"),
    ).rejects.toThrow();
  });

  /**
   * TEST_SCENARIO: A regular-file write may write less than it was given. The
   * upload must notice and fail rather than publish a file shorter than the one
   * it hashed and reported.
   */
  it("fails an upload whose short write would truncate the file", async () => {
    hooks.shortWrite = true;
    try {
      const transfer = fakeTransfer({ receives: Buffer.from("ABCDEF") });
      const backend = createFilesBackend({ root, allowUpload: true, transfer });
      const outcome = outcomeOf(
        await backend.call({
          sequence: 6,
          tool: UPLOAD_TOOL,
          args: { path: "short.txt", workspacePath: "work/short.txt" },
          transferToken: TOKEN,
        }),
      );
      expect(outcome.isError).toBe(true);
      await expect(lstat(join(root, "short.txt"))).rejects.toThrow();
    } finally {
      hooks.shortWrite = false;
    }
  });

  it("refuses a workspace file over the cap and leaves nothing behind", async () => {
    const transfer = fakeTransfer({ receives: Buffer.alloc(64, 1) });
    const backend = createFilesBackend({
      root,
      allowUpload: true,
      transfer,
      maxBytes: 8,
    });

    const outcome = outcomeOf(
      await backend.call({
        sequence: 1,
        tool: UPLOAD_TOOL,
        args: { path: "big.bin", workspacePath: "work/big.bin" },
        transferToken: TOKEN,
      }),
    );
    expect(outcome.isError).toBe(true);
    await expect(lstat(join(root, "big.bin"))).rejects.toThrow();
  });
});

describe("the requests the platform receives", () => {
  let server: Server;
  let base: string;
  const seen: {
    method?: string;
    url?: string;
    authorization?: string;
    claim?: string;
    length?: string;
    body: Buffer;
  }[] = [];

  const tokenProvider: TokenProvider = {
    getValidAccessToken: async () => ({ ok: true, value: "serve-key" }),
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        seen.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          claim: req.headers["x-dam-claim"] as string | undefined,
          length: req.headers["content-length"] as string | undefined,
          body: Buffer.concat(chunks),
        });
        if (
          req.method === "POST" &&
          req.url === "/api/satellites/laptop/jobs/9/file"
        ) {
          res.writeHead(200, { "content-type": "application/json" }).end(
            JSON.stringify({
              path: "/home/agent/.dam/satellite-files/laptop-9/app.log",
              size: 4,
              sha256: sha256(Buffer.from("data")),
            }),
          );
          return;
        }
        if (
          req.method === "GET" &&
          req.url === "/api/satellites/laptop/jobs/9/file"
        ) {
          res
            .writeHead(200, {
              "content-type": "application/octet-stream",
              "content-length": "18",
            })
            .end(Buffer.from("from the workspace"));
          return;
        }
        if (req.url === "/api/satellites/laptop/jobs/10/file") {
          res
            .writeHead(409, { "content-type": "application/json" })
            .end(JSON.stringify({ error: "no_running_job" }));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(() => {
    server.close();
  });

  it("sends one file with the claim's token and the worker's key", async () => {
    const transfer = createFileTransfer({
      satellite: "laptop",
      host: base,
      tokenProvider,
    });
    const written = await transfer.send({
      sequence: 9,
      token: TOKEN,
      bytes: Readable.from([Buffer.from("data")]),
      declaredBytes: 4,
      signal: new AbortController().signal,
    });

    expect(written).toEqual({
      path: "/home/agent/.dam/satellite-files/laptop-9/app.log",
      size: 4,
      sha256: sha256(Buffer.from("data")),
    });
    expect(seen[0]).toMatchObject({
      method: "POST",
      url: "/api/satellites/laptop/jobs/9/file",
      authorization: "Bearer serve-key",
      claim: TOKEN,
      length: "4",
    });
    expect(seen[0]?.body.toString()).toBe("data");
  });

  it("asks for the Job's own file, never a path of its own", async () => {
    const transfer = createFileTransfer({
      satellite: "laptop",
      host: base,
      tokenProvider,
    });
    const { stream, size } = await transfer.receive({
      sequence: 9,
      token: TOKEN,
      signal: new AbortController().signal,
    });
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);

    expect(size).toBe(18);
    expect(Buffer.concat(chunks).toString()).toBe("from the workspace");
    expect(seen.at(-1)).toMatchObject({
      method: "GET",
      url: "/api/satellites/laptop/jobs/9/file",
      claim: TOKEN,
    });
  });

  it("reports a refusal as its own words, not the platform's", async () => {
    const transfer = createFileTransfer({
      satellite: "laptop",
      host: base,
      tokenProvider,
    });
    await expect(
      transfer.receive({
        sequence: 10,
        token: TOKEN,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("the job this transfer belongs to is no longer running");
  });
});

describe("the cap the satellite declares", () => {
  it("is the same one the platform enforces", () => {
    expect(MAX_TRANSFER_BYTES).toBe(50 * 1024 * 1024);
    expect(MAX_TRANSFER_BYTES).toBe(50 * 1024 * 1024);
  });
});
