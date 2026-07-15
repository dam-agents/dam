import { basename } from "node:path";
import { randomUUID } from "node:crypto";

/** Storage key for a Candidate: `<experimentId>/<agentId>/<uuid>/<basename>`.
 *  The arm ids in the prefix are what scope a key to its producer. */
export function armCandidateKey(
  experimentId: string,
  agentId: string,
  filename: string | undefined,
): string {
  const name = basename(filename ?? "") || "candidate";
  return `${experimentId}/${agentId}/${randomUUID()}/${name}`;
}

/** Whether `ref` was minted for this arm — anything else reads as unknown. */
export function isArmCandidateKey(
  ref: string,
  experimentId: string,
  agentId: string,
): boolean {
  return ref.startsWith(`${experimentId}/${agentId}/`);
}
