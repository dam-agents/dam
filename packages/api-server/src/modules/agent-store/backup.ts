import { createHash } from "node:crypto";

export interface SnapshotObjectStore {
  put(key: string, body: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

const digest = (body: Buffer): string =>
  createHash("sha256").update(body).digest("hex");

/**
 * UNIT_BOUNDARY_DESCRIPTION: writes the archive's independent copy before any row
 * exists, and proves the copy by reading it back.
 *
 * The copy exists so a database that is lost after the switch still has the
 * custom resources it absorbed, so a write that cannot be read back is treated
 * as no backup at all: the caller aborts the absorb, and an install with an
 * object store configured serves nothing rather than absorb with one copy. The
 * key is derived from the archive's digest, so a rerun overwrites the same
 * object instead of leaving a second one behind.
 */
export async function writeVerifiedBackup(input: {
  store: SnapshotObjectStore;
  keyPrefix: string;
  content: Buffer;
  expectedSha256: string;
}): Promise<{ key: string; sha256: string }> {
  const key = `${input.keyPrefix.replace(/\/+$/u, "")}/${input.expectedSha256}.yaml`;
  await input.store.put(key, input.content);
  const readBack = await input.store.get(key);
  if (readBack === null)
    throw new Error(
      `the archive written to ${key} cannot be read back: treating the backup as absent and refusing the absorb`,
    );
  const got = digest(readBack);
  if (got !== input.expectedSha256)
    throw new Error(
      `the archive read back from ${key} has sha256 ${got}, not ${input.expectedSha256}: treating the backup as absent and refusing the absorb`,
    );
  return { key, sha256: got };
}
