import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TokenProvider } from "../modules/auth/index.js";
import type { CallOutcome } from "../modules/satellite/services/backend.js";
import {
  createFileTransfer,
  type FileTransfer,
} from "../modules/satellite/services/file-transfer.js";
import {
  createFilesBackend,
  DOWNLOAD_TOOL,
  resolveFileRoot,
  UPLOAD_TOOL,
} from "../modules/satellite/services/files-backend.js";

/**
 * TEST_OVERVIEW: `dam satellite files --root <dir>` exposes one directory on
 * the user's machine to an agent as a download tool, and with --upload also as
 * an upload tool. The bytes never enter the agent's context: they cross in the
 * body of one request to the platform, which writes them into the agent's
 * workspace, so a call's result is a path, a size and a sha256.
 *
 * The specs pin the two boundaries that make this safe to run on a real
 * machine: the root, which every path is resolved inside so `..`, an absolute
 * path and a symlink that leads out are all refused, and the size cap. They
 * also pin the flag that decides the direction — without --upload the tool is
 * not offered and a call that asks for it anyway is refused — and that an
 * existing file is never replaced unless the caller asks.
 */

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

function fakeTransfer(options: { receives?: Buffer } = {}): FileTransfer & {
  sent: { sequence: number; name: string; bytes: Buffer }[];
  received: { sequence: number; path: string }[];
} {
  const sent: { sequence: number; name: string; bytes: Buffer }[] = [];
  const received: { sequence: number; path: string }[] = [];
  return {
    sent,
    received,
    async send({ sequence, name, bytes }) {
      sent.push({ sequence, name, bytes });
      return {
        path: `/home/agent/.dam/satellite-files/laptop-${sequence}/${name}`,
        size: bytes.length,
        sha256: sha256(bytes),
      };
    },
    async receive({ sequence, path }) {
      received.push({ sequence, path });
      return options.receives ?? Buffer.from("from the workspace");
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
  await writeFile(join(outside, "secret.txt"), "not yours\n");
  await symlink(join(outside, "secret.txt"), join(rawRoot, "escape.txt"));
  await symlink(join(rawRoot, "logs"), join(rawRoot, "logs-link"));
  root = ((await resolveFileRoot(rawRoot)) as { root: string }).root;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the root a files satellite exposes", () => {
  it("refuses the home directory and the whole filesystem", async () => {
    for (const raw of ["/", homedir()]) {
      const resolved = await resolveFileRoot(raw);
      expect(resolved.ok).toBe(false);
    }
  });

  it("accepts a directory and refuses a file or a path that is not there", async () => {
    expect(await resolveFileRoot(rawRoot)).toEqual({ ok: true, root });
    expect((await resolveFileRoot(join(root, "logs", "app.log"))).ok).toBe(
      false,
    );
    expect((await resolveFileRoot(join(root, "nope"))).ok).toBe(false);
  });
});

describe("a download from the machine into the agent's workspace", () => {
  it("hands the bytes to the platform and reports where they landed", async () => {
    const transfer = fakeTransfer();
    const backend = createFilesBackend({
      root,
      allowUpload: false,
      transfer,
    });

    const result = resultOf(
      await backend.call({
        sequence: 7,
        tool: DOWNLOAD_TOOL,
        args: { path: "logs/app.log" },
      }),
    );

    expect(transfer.sent).toHaveLength(1);
    expect(transfer.sent[0]?.bytes.toString("utf8")).toBe(
      "line one\nline two\n",
    );
    expect(transfer.sent[0]?.name).toBe("app.log");
    expect(result).toEqual({
      path: "/home/agent/.dam/satellite-files/laptop-7/app.log",
      size: 18,
      sha256: sha256(Buffer.from("line one\nline two\n")),
    });
  });

  it("refuses a .. segment, an absolute path, a symlink that leads out and a directory", async () => {
    const transfer = fakeTransfer();
    const backend = createFilesBackend({
      root,
      allowUpload: false,
      transfer,
    });

    const refusals = [
      { path: "../outside/secret.txt" },
      { path: join(outside, "secret.txt") },
      { path: "escape.txt" },
      { path: "logs" },
      { path: "" },
    ];
    for (const args of refusals) {
      const outcome = outcomeOf(
        await backend.call({ sequence: 1, tool: DOWNLOAD_TOOL, args }),
      );
      expect(outcome.isError).toBe(true);
      expect(outcome.blocked).toBe(true);
    }
    expect(transfer.sent).toHaveLength(0);
  });

  it("follows a symlink that stays inside the root", async () => {
    const transfer = fakeTransfer();
    const backend = createFilesBackend({
      root,
      allowUpload: false,
      transfer,
    });

    const result = resultOf(
      await backend.call({
        sequence: 3,
        tool: DOWNLOAD_TOOL,
        args: { path: "logs-link/app.log" },
      }),
    );
    expect(result.size).toBe(18);
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
      }),
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.output).toContain("at most 4");
    expect(transfer.sent).toHaveLength(0);
  });
});

describe("an upload from the agent's workspace onto the machine", () => {
  it("is not offered, and is refused, without --upload", async () => {
    const transfer = fakeTransfer();
    const backend = createFilesBackend({
      root,
      allowUpload: false,
      transfer,
    });

    expect(backend.tools.map((tool) => tool.name)).toEqual([DOWNLOAD_TOOL]);
    const outcome = outcomeOf(
      await backend.call({
        sequence: 1,
        tool: UPLOAD_TOOL,
        args: { path: "in.txt", workspacePath: "work/in.txt" },
      }),
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.output).toContain("--upload");
    expect(transfer.received).toHaveLength(0);
  });

  it("writes the workspace file under the root", async () => {
    const transfer = fakeTransfer({ receives: Buffer.from("hello\n") });
    const backend = createFilesBackend({
      root,
      allowUpload: true,
      transfer,
    });

    expect(backend.tools.map((tool) => tool.name).sort()).toEqual([
      DOWNLOAD_TOOL,
      UPLOAD_TOOL,
    ]);
    const result = resultOf(
      await backend.call({
        sequence: 2,
        tool: UPLOAD_TOOL,
        args: { path: "inbox/hello.txt", workspacePath: "work/hello.txt" },
      }),
    );

    expect(transfer.received).toEqual([
      { sequence: 2, path: "work/hello.txt" },
    ]);
    expect(await readFile(join(root, "inbox", "hello.txt"), "utf8")).toBe(
      "hello\n",
    );
    expect(result).toEqual({
      path: "inbox/hello.txt",
      size: 6,
      sha256: sha256(Buffer.from("hello\n")),
    });
  });

  it("refuses to replace a file unless asked to", async () => {
    const transfer = fakeTransfer({ receives: Buffer.from("second\n") });
    const backend = createFilesBackend({
      root,
      allowUpload: true,
      transfer,
    });
    await writeFile(join(root, "existing.txt"), "first\n");

    const refused = outcomeOf(
      await backend.call({
        sequence: 1,
        tool: UPLOAD_TOOL,
        args: { path: "existing.txt", workspacePath: "work/existing.txt" },
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
      }),
    );
    expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("second\n");
  });

  it("refuses a destination outside the root, including through a symlinked directory", async () => {
    const transfer = fakeTransfer();
    const backend = createFilesBackend({
      root,
      allowUpload: true,
      transfer,
    });
    await symlink(outside, join(root, "outside-link"));

    for (const args of [
      { path: "../outside/x.txt", workspacePath: "work/x" },
      { path: join(outside, "x.txt"), workspacePath: "work/x" },
      { path: "outside-link/x.txt", workspacePath: "work/x" },
      { path: "escape.txt", workspacePath: "work/x" },
    ]) {
      const outcome = outcomeOf(
        await backend.call({ sequence: 1, tool: UPLOAD_TOOL, args }),
      );
      expect(outcome.isError).toBe(true);
    }
    expect(transfer.received).toHaveLength(0);
  });
});

describe("the transfer request the platform receives", () => {
  let server: Server;
  let base: string;
  const seen: {
    method?: string;
    url?: string;
    authorization?: string;
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
          length: req.headers["content-length"] as string | undefined,
          body: Buffer.concat(chunks),
        });
        if (
          req.method === "POST" &&
          req.url === "/api/satellites/laptop/jobs/9/file?name=app.log"
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
          req.url === "/api/satellites/laptop/jobs/9/file?path=work%2Fapp.log"
        ) {
          res
            .writeHead(200, {
              "content-type": "application/octet-stream",
            })
            .end(Buffer.from("from the workspace"));
          return;
        }
        res.writeHead(409, { "content-type": "application/json" }).end(
          JSON.stringify({
            error: "laptop#9 is done, not running",
          }),
        );
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

  it("sends one file, named, with the worker's serve key", async () => {
    const transfer = createFileTransfer({
      satellite: "laptop",
      host: base,
      tokenProvider,
    });
    const written = await transfer.send({
      sequence: 9,
      name: "app.log",
      bytes: Buffer.from("data"),
      signal: new AbortController().signal,
    });

    expect(written).toEqual({
      path: "/home/agent/.dam/satellite-files/laptop-9/app.log",
      size: 4,
      sha256: sha256(Buffer.from("data")),
    });
    expect(seen[0]).toMatchObject({
      method: "POST",
      url: "/api/satellites/laptop/jobs/9/file?name=app.log",
      authorization: "Bearer serve-key",
      length: "4",
    });
    expect(seen[0]?.body.toString("utf8")).toBe("data");
  });

  it("reports why the platform refused the transfer", async () => {
    const transfer = createFileTransfer({
      satellite: "laptop",
      host: base,
      tokenProvider,
    });
    await expect(
      transfer.receive({
        sequence: 10,
        path: "work/app.log",
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("laptop#9 is done, not running");
  });

  it("asks for the workspace file by its path", async () => {
    const transfer = createFileTransfer({
      satellite: "laptop",
      host: base,
      tokenProvider,
    });
    const bytes = await transfer.receive({
      sequence: 9,
      path: "work/app.log",
      signal: new AbortController().signal,
    });

    expect(bytes.toString("utf8")).toBe("from the workspace");
    expect(seen.at(-1)).toMatchObject({
      method: "GET",
      url: "/api/satellites/laptop/jobs/9/file?path=work%2Fapp.log",
      authorization: "Bearer serve-key",
    });
  });
});
