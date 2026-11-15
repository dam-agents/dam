import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CallOutcome } from "../modules/satellite/services/backend.js";
import { pinRoot } from "../modules/satellite/services/confined-files.js";
import {
  createFilesBackend,
  DOWNLOAD_TOOL,
} from "../modules/satellite/services/files-backend.js";
import {
  CLAIM_TOKEN,
  fakeFilesTransfer,
  finished,
  jsonOf,
  sha256,
} from "./satellite-files-fixtures.js";

/**
 * TEST_OVERVIEW: A download copies part of a file as readily as all of it. An
 * offset picks the first byte — a negative one counts back from the end, so the
 * tail of a growing log is one call — and a length says how many bytes follow;
 * the platform is told the slice's length, not the file's, and the cap is
 * measured against the slice, so a file larger than the cap still moves in
 * pieces. The range is resolved against the size the verified open reported and
 * read from that same descriptor.
 */

const BODY = "ABCDEFGHIJKLMNOPQRST";
let dir: string;
let root: string;

function backendOf(maxBytes?: number) {
  return createFilesBackend({
    root,
    allowUpload: false,
    transfer: fakeFilesTransfer(),
    ...(maxBytes === undefined ? {} : { maxBytes }),
  });
}

async function callWith(
  args: Record<string, unknown>,
  maxBytes?: number,
): Promise<{
  outcome: CallOutcome;
  transfer: ReturnType<typeof fakeFilesTransfer>;
}> {
  const transfer = fakeFilesTransfer();
  const outcome = await createFilesBackend({
    root,
    allowUpload: false,
    transfer,
    ...(maxBytes === undefined ? {} : { maxBytes }),
  }).call({
    sequence: 1,
    tool: DOWNLOAD_TOOL,
    args,
    transferToken: CLAIM_TOKEN,
  });
  return { outcome, transfer };
}

async function download(
  args: Record<string, unknown>,
  maxBytes?: number,
): Promise<CallOutcome> {
  return (await callWith(args, maxBytes)).outcome;
}

async function sent(
  args: Record<string, unknown>,
  maxBytes?: number,
): Promise<{
  bytes: string;
  declared: number;
  result: Record<string, unknown>;
}> {
  const { outcome, transfer } = await callWith(args, maxBytes);
  return {
    bytes: transfer.sent[0]?.bytes.toString() ?? "",
    declared: transfer.sent[0]?.declaredBytes ?? -1,
    result: jsonOf(outcome),
  };
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "dam-satellite-range-"));
  const rawRoot = join(dir, "work");
  await mkdir(rawRoot, { recursive: true });
  await writeFile(join(rawRoot, "data.txt"), BODY);

  const pinned = await pinRoot(rawRoot);
  if (!pinned.ok) throw new Error(pinned.reason);
  root = await realpath(rawRoot);
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("copying part of a file", () => {
  it("sends exactly the bytes offset and length name and declares that length", async () => {
    const slice = await sent({ path: "data.txt", offset: 5, length: 4 });

    expect(slice.bytes).toBe("FGHI");
    expect(slice.declared).toBe(4);
    expect(slice.result).toEqual({
      path: "/home/agent/.dam/satellite-files/laptop-7-eeeeeeee/app.bin",
      size: 4,
      sha256: sha256(Buffer.from("FGHI")),
      offset: 5,
      fileSize: 20,
    });
  });

  it("counts a negative offset back from the end of the file", async () => {
    const tail = await sent({ path: "data.txt", offset: -6 });
    expect(tail.bytes).toBe("OPQRST");
    expect(tail.result.offset).toBe(14);
    expect(tail.result.size).toBe(6);
    expect(tail.result.fileSize).toBe(20);
  });

  it("clamps an offset before the start of the file to the start", async () => {
    const whole = await sent({ path: "data.txt", offset: -1048576 });
    expect(whole.bytes).toBe(BODY);
    expect(whole.result.offset).toBe(0);
    expect(whole.result.size).toBe(20);
  });

  it("copies to the end of the file when only an offset is given", async () => {
    const rest = await sent({ path: "data.txt", offset: 15 });
    expect(rest.bytes).toBe("PQRST");
    expect(rest.result.size).toBe(5);
  });

  it("copies from the start when only a length is given", async () => {
    const head = await sent({ path: "data.txt", length: 3 });
    expect(head.bytes).toBe("ABC");
    expect(head.result.offset).toBe(0);
    expect(head.result.size).toBe(3);
    expect(head.result.fileSize).toBe(20);
  });

  it("stops a length at the end of the file instead of failing", async () => {
    const over = await sent({ path: "data.txt", offset: 16, length: 100 });
    expect(over.bytes).toBe("QRST");
    expect(over.result.size).toBe(4);
  });

  it("leaves a plain download's result exactly as it was", async () => {
    const whole = await sent({ path: "data.txt" });
    expect(whole.bytes).toBe(BODY);
    expect(Object.keys(whole.result).sort()).toEqual([
      "path",
      "sha256",
      "size",
    ]);
    expect(jsonOf(await download({ path: "data.txt" }))).toEqual({
      path: "/home/agent/.dam/satellite-files/laptop-7-eeeeeeee/app.bin",
      size: 20,
      sha256: sha256(Buffer.from(BODY)),
    });
  });

  it("refuses an offset past the end of the file", async () => {
    const outcome = finished(
      await download({ path: "data.txt", offset: 21, length: 1 }),
    );
    expect(outcome.isError).toBe(true);
    expect(outcome.blocked).toBe(true);
    expect(outcome.output).toContain("shorter than offset 21");
    expect(outcome.output).toContain("20 bytes");
  });

  it("refuses an offset or a length that is not a whole number of bytes", async () => {
    for (const args of [
      { path: "data.txt", offset: 1.5 },
      { path: "data.txt", offset: "3" },
      { path: "data.txt", length: 0 },
      { path: "data.txt", length: -2 },
      { path: "data.txt", length: 2.5 },
    ]) {
      const outcome = finished(await download(args));
      expect(outcome.isError).toBe(true);
      expect(outcome.blocked).toBe(true);
    }
  });
});

describe("the transfer cap over a file bigger than it", () => {
  it("refuses a whole file over the cap and says how to copy part of it", async () => {
    const outcome = finished(await download({ path: "data.txt" }, 8));

    expect(outcome.isError).toBe(true);
    expect(outcome.output).toBe(
      "data.txt is 20 bytes, over the 8 byte transfer limit — pass offset and length to copy part of it",
    );
  });

  it("copies a slice that fits under the cap", async () => {
    const slice = await sent({ path: "data.txt", offset: 4, length: 8 }, 8);

    expect(slice.bytes).toBe("EFGHIJKL");
    expect(slice.result.size).toBe(8);
    expect(slice.result.offset).toBe(4);
    expect(slice.result.fileSize).toBe(20);
  });

  it("refuses a slice longer than the cap", async () => {
    const outcome = finished(
      await download({ path: "data.txt", offset: 4, length: 9 }, 8),
    );

    expect(outcome.isError).toBe(true);
    expect(outcome.output).toContain("9 bytes");
    expect(outcome.output).toContain("ask for a shorter length");
  });
});

describe("how a call reads in the worker's log", () => {
  it("names the path alone when no range was asked for", () => {
    const backend = backendOf();
    expect(backend.describeCall(DOWNLOAD_TOOL, { path: "data.txt" })).toBe(
      "download data.txt",
    );
  });

  it("names the range it was given", () => {
    const backend = backendOf();
    expect(
      backend.describeCall(DOWNLOAD_TOOL, {
        path: "data.txt",
        offset: 5,
        length: 4,
      }),
    ).toBe("download data.txt [offset 5+4]");
  });
});

describe("the tools the backend offers", () => {
  it("describes the range on the download tool's schema", () => {
    const backend = backendOf();
    const download = backend.tools.find((tool) => tool.name === DOWNLOAD_TOOL);
    const properties = download?.inputSchema.properties as
      Record<string, { type?: string }> | undefined;

    expect(properties?.offset?.type).toBe("integer");
    expect(properties?.length?.type).toBe("integer");
    expect(download?.description).toContain("offset");
  });
});
