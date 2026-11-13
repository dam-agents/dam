import { mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SATELLITE_FILE_MAX_BYTES } from "api-server-api";
import type { TokenProvider } from "../modules/auth/index.js";
import type { CallOutcome } from "../modules/satellite/services/backend.js";
import {
  createFileTransfer,
  type FileTransfer,
} from "../modules/satellite/services/file-transfer.js";
import {
  createFilesBackend,
  UPLOAD_TOOL,
} from "../modules/satellite/services/files-backend.js";

/**
 * TEST_OVERVIEW: A satellite transfer is bounded by two numbers — the ceiling
 * one file may carry, declared once in api-server-api, and the free space an end
 * needs before it writes a byte. The specs pin that the machine refuses an
 * upload it cannot hold (the file's size plus 1 GiB of headroom), that a refused
 * upload leaves nothing staged, and the words the agent is given for a refusal
 * the platform sends, including the code an older platform answers with.
 */

const TOKEN = "f".repeat(64);
const GIB = 1024 ** 3;

function outcomeOf(outcome: CallOutcome): {
  isError: boolean;
  output: string;
} {
  if (outcome.status !== "done")
    throw new Error(`expected a finished call, got ${outcome.status}`);
  return outcome;
}

function fakeTransfer(receives: Buffer): FileTransfer {
  return {
    async send() {
      return { path: "/home/agent/x", size: 0, sha256: "" };
    },
    async receive() {
      return { stream: Readable.from([receives]), size: receives.length };
    },
  };
}

const serveKey: TokenProvider = {
  getValidAccessToken: async () => ({ ok: true, value: "serve-key" }),
};

function refusingTransfer(status: number, error: string) {
  return createFileTransfer({
    satellite: "laptop",
    host: "http://platform.example",
    tokenProvider: serveKey,
    fetch: (async () =>
      new Response(JSON.stringify({ error }), {
        status,
      })) as unknown as typeof fetch,
  });
}

let dir: string;
let root: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dam-satellite-space-"));
  root = await realpath(dir);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("the free space an upload needs on the machine", () => {
  /**
   * TEST_SCENARIO: The workspace states the file's size before any byte of it
   * arrives, and the machine cannot hold it plus the headroom. The call must be
   * refused with that reason, and nothing may stay behind: no staged name and no
   * published file.
   */
  it("refuses a file it cannot hold, leaving nothing staged", async () => {
    const backend = createFilesBackend({
      root,
      allowUpload: true,
      transfer: fakeTransfer(Buffer.from("payload")),
      freeBytes: async () => GIB,
    });

    const outcome = outcomeOf(
      await backend.call({
        sequence: 1,
        tool: UPLOAD_TOOL,
        args: { path: "landing.bin", workspacePath: "work/landing.bin" },
        transferToken: TOKEN,
      }),
    );

    expect(outcome.isError).toBe(true);
    expect(outcome.output).toContain("does not have room for this file");
    expect(outcome.output).toContain("plus 1 GiB free");
    expect(await readdir(root)).toEqual([]);
  });

  it("takes the same upload when the headroom fits", async () => {
    const backend = createFilesBackend({
      root,
      allowUpload: true,
      transfer: fakeTransfer(Buffer.from("payload")),
      freeBytes: async () => 4 * GIB,
    });

    const outcome = outcomeOf(
      await backend.call({
        sequence: 2,
        tool: UPLOAD_TOOL,
        args: { path: "landing.bin", workspacePath: "work/landing.bin" },
        transferToken: TOKEN,
      }),
    );

    expect(outcome.isError).toBe(false);
    expect(await readdir(root)).toEqual(["landing.bin"]);
  });
});

describe("the words the agent is given for a refusal", () => {
  const receive = (transfer: FileTransfer) =>
    transfer.receive({
      sequence: 3,
      token: TOKEN,
      signal: new AbortController().signal,
    });

  /**
   * TEST_SCENARIO: The platform's own workspace end refuses a file it cannot
   * hold. The code must reach the agent as that reason rather than as a generic
   * workspace refusal, and it must say what the file needs.
   */
  it("maps no_space to the room the file needs", async () => {
    await expect(receive(refusingTransfer(507, "no_space"))).rejects.toThrow(
      "the agent's workspace does not have room for this file — it needs the file's size plus 1 GiB free",
    );
  });

  /**
   * TEST_SCENARIO: A CLI that allows 5 GiB may face an api-server or a runtime
   * that still cuts a transfer at 50 MB, so the over-limit message must not read
   * as the CLI's own ceiling.
   */
  it("says the platform or the agent may be older than this CLI", async () => {
    await expect(
      receive(refusingTransfer(413, "transfer_too_large")),
    ).rejects.toThrow(
      "the file is over the transfer limit (the platform or the agent may be older than this CLI and still limit a transfer to 50 MB)",
    );
  });
});

describe("the ceiling a satellite declares", () => {
  it("is the one constant, and the tools print it in GiB", async () => {
    expect(SATELLITE_FILE_MAX_BYTES).toBe(5 * GIB);

    const backend = createFilesBackend({
      root,
      allowUpload: true,
      transfer: fakeTransfer(Buffer.from("payload")),
    });
    const descriptions = backend.tools.map((tool) => tool.description ?? "");

    expect(descriptions).toHaveLength(2);
    expect(
      descriptions.every((text) => text.includes("Files up to 5 GiB.")),
    ).toBe(true);
  });
});
