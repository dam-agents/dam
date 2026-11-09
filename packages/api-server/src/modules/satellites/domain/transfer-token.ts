import { createHash, randomBytes } from "node:crypto";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The capability a file transfer presents. It is
 * minted when a worker claims a Job, given to that worker alone in the work
 * item, and stored on the Job row as a hash. Presenting it back is the only way
 * to move a file for that Job: the platform cannot tell two workers of the same
 * owner apart by their keys, so the token is what identifies the claimant, and
 * consuming it — one conditional update — is what makes a transfer happen once,
 * for one direction, while the Job is still running.
 */
export function mintTransferToken(): string {
  return randomBytes(32).toString("hex");
}

export function transferTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
