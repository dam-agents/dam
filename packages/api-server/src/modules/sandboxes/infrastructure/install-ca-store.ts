import { installSecrets, eq, type Db } from "db";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Where the install's CA lives, so that every node
 * signs with the same one. Claiming is an insert that does nothing on
 * conflict followed by a read: two nodes booting together both generate a
 * candidate, exactly one row survives, and both return the survivor — so the
 * loser's key is simply discarded rather than becoming a second trust anchor
 * half the agents believe in.
 */
const CA_NAME = "egress-ca";

export interface InstallCa {
  cert: string;
  key: string;
}

export interface InstallCaStore {
  load(): Promise<InstallCa | null>;
  claim(candidate: InstallCa): Promise<InstallCa>;
}

export function createInstallCaStore(db: Db): InstallCaStore {
  const read = async (): Promise<InstallCa | null> => {
    const rows = await db
      .select()
      .from(installSecrets)
      .where(eq(installSecrets.name, CA_NAME))
      .limit(1);
    const value = rows[0]?.value;
    return value?.cert && value?.key
      ? { cert: value.cert, key: value.key }
      : null;
  };

  return {
    load: read,

    async claim(candidate) {
      await db
        .insert(installSecrets)
        .values({
          name: CA_NAME,
          value: { cert: candidate.cert, key: candidate.key },
        })
        .onConflictDoNothing();
      const stored = await read();
      if (!stored)
        throw new Error("install CA vanished immediately after claim");
      return stored;
    },
  };
}
