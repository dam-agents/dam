/* UNIT_BOUNDARY_DESCRIPTION: the sweep that settles the key ledger. A key is written to it before anything uses it and taken out once a Connection names it, so between those two moments the entry describes a key a live create or rotation is about to adopt — revoking it there would leave that Connection with a dead credential. The sweep therefore reads only entries older than a grace window, longer than any create or rotation takes; an entry that outlives it describes a key nothing adopted, and is revoked. An entry a Connection does name is dropped rather than revoked, so a crash between the Connection's write and the ledger's settle costs the entry, not the key. */

export const KEY_REVOCATION_GRACE_SECONDS = 300;

export interface KeyRevocationSweep {
  run(): Promise<number>;
}

export interface PendingKeyRevocation {
  keyId: string;
  ownerSub: string;
}

export function createKeyRevocationSweep(deps: {
  pending: (olderThanSeconds: number) => Promise<PendingKeyRevocation[]>;
  revoke: (keyId: string, ownerSub: string) => Promise<unknown>;
  namedByAConnection: (keyId: string) => Promise<boolean>;
  drop: (keyId: string) => Promise<void>;
  graceSeconds?: number;
}): KeyRevocationSweep {
  const graceSeconds = deps.graceSeconds ?? KEY_REVOCATION_GRACE_SECONDS;
  return {
    async run() {
      const pending = await deps.pending(graceSeconds);
      let revoked = 0;
      for (const rec of pending) {
        if (!(await deps.namedByAConnection(rec.keyId))) {
          await deps.revoke(rec.keyId, rec.ownerSub);
          revoked += 1;
        }
        await deps.drop(rec.keyId);
      }
      return revoked;
    },
  };
}
