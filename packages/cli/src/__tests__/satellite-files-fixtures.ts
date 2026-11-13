import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { CallOutcome } from "../modules/satellite/services/backend.js";
import type { FileTransfer } from "../modules/satellite/services/file-transfer.js";

export const CLAIM_TOKEN = "e".repeat(64);

export function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface RecordedSend {
  sequence: number;
  token: string;
  declaredBytes: number;
  bytes: Buffer;
}

export interface RecordedTransfer extends FileTransfer {
  sent: RecordedSend[];
}

/**
 * TEST_OVERVIEW: A stand-in for the platform end of a transfer that keeps what a
 * download handed it, so a spec can assert which bytes left the machine, in
 * which length the transfer declared them and under which claim.
 */
export function fakeFilesTransfer(): RecordedTransfer {
  const sent: RecordedSend[] = [];
  return {
    sent,
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
    receive: () =>
      Promise.resolve({
        stream: Readable.from([Buffer.from("from the workspace")]),
        size: 18,
      }),
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
