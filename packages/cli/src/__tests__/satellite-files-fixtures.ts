import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { extract as tarExtract, pack as tarPack } from "tar-stream";
import type { CallOutcome } from "../modules/satellite/services/backend.js";
import type { FileTransfer } from "../modules/satellite/services/file-transfer.js";

export const CLAIM_TOKEN = "e".repeat(64);

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface RecordedSend {
  sequence: number;
  token: string;
  declaredBytes: number | undefined;
  bytes: Buffer;
}

export interface RecordedReceive {
  sequence: number;
  token: string;
}

export interface RecordedTransfer extends FileTransfer {
  sent: RecordedSend[];
  received: RecordedReceive[];
}

/**
 * TEST_OVERVIEW: A stand-in for the platform end of a transfer that keeps what a
 * download handed it, so a spec can assert which bytes left the machine, in
 * which length the transfer declared them and under which claim.
 */
export function fakeFilesTransfer(
  options: { receives?: Buffer } = {},
): RecordedTransfer {
  const sent: RecordedSend[] = [];
  const received: RecordedReceive[] = [];
  return {
    sent,
    received,
    async send({ sequence, token, bytes, declaredBytes }) {
      const chunks: Buffer[] = [];
      for await (const chunk of bytes) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      sent.push({ sequence, token, declaredBytes, bytes: body });
      return {
        path: "/home/agent/.dam/satellite-files/laptop-7-eeeeeeee/app.bin",
        size: body.length,
        sha256: sha256(body),
      };
    },
    receive({ sequence, token }) {
      received.push({ sequence, token });
      const body = options.receives ?? Buffer.from("from the workspace");
      return Promise.resolve({
        stream: Readable.from([body]),
        size: body.length,
      });
    },
  };
}

export function finished(outcome: CallOutcome): {
  isError: boolean;
  output: string;
  blocked?: true;
} {
  if (outcome.status !== "done")
    throw new Error(`expected a finished call, got ${outcome.status}`);
  return outcome;
}

export function textOf(outcome: CallOutcome): string {
  const done = finished(outcome);
  if (done.isError) throw new Error(`expected success, got: ${done.output}`);
  return done.output;
}

export function jsonOf(outcome: CallOutcome): Record<string, unknown> {
  return JSON.parse(textOf(outcome)) as Record<string, unknown>;
}

export type TarEntryType =
  | "file"
  | "contiguous-file"
  | "directory"
  | "symlink"
  | "link"
  | "character-device"
  | "block-device"
  | "fifo";

export interface TarFile {
  name: string;
  type?: TarEntryType;
  body?: string | Buffer;
  mode?: number;
  linkname?: string;
}

export async function tarOf(entries: readonly TarFile[]): Promise<Buffer> {
  const pack = tarPack();
  const collected: Buffer[] = [];
  const consumed = (async () => {
    for await (const chunk of Readable.from(pack))
      collected.push(Buffer.from(chunk as Buffer));
  })();
  for (const entry of entries) {
    await new Promise<void>((resolve, reject) => {
      const done = (err: Error | null | undefined) =>
        err ? reject(err) : resolve();
      const header = {
        name: entry.name,
        mode: entry.mode ?? 0o644,
        ...(entry.type === undefined ? {} : { type: entry.type }),
        ...(entry.linkname === undefined ? {} : { linkname: entry.linkname }),
      };
      const sink =
        entry.body === undefined
          ? pack.entry(header, done)
          : pack.entry(header, entry.body, done);
      if (entry.body === undefined) sink.end(() => {});
    });
  }
  pack.finalize();
  await consumed;
  return Buffer.concat(collected);
}

export interface UnpackedTarEntry {
  name: string;
  type: string | null;
  mode: number;
  body: Buffer;
}

export async function tarEntriesOf(tar: Buffer): Promise<UnpackedTarEntry[]> {
  const extract = tarExtract();
  Readable.from([tar]).pipe(extract);
  const entries: UnpackedTarEntry[] = [];
  for await (const entry of extract) {
    const parts: Buffer[] = [];
    for await (const chunk of entry) parts.push(Buffer.from(chunk as Buffer));
    entries.push({
      name: entry.header.name,
      type: entry.header.type ?? null,
      mode: entry.header.mode,
      body: Buffer.concat(parts),
    });
  }
  return entries;
}
