import { useEffect, useState } from "react";
import { z } from "zod";

import { getUser } from "../../../auth.js";
import { frecencySchema, recordUse, usesAt } from "../lib/frecency.js";
import {
  readStored,
  SNAPSHOT_CAP,
  writeStored,
} from "../lib/palette-storage.js";

const ownerId = () => getUser()?.profile.sub ?? "";

/**
 * UNIT_BOUNDARY_DESCRIPTION: a list the palette searches, served from the
 * last answer this browser stored for the signed-in person until the server's
 * fresh answer arrives, which then replaces the stored one whole. `fresh` must
 * keep its identity between renders, or every render writes it again.
 */
export function useCachedList<T>(
  name: string,
  schema: z.ZodType<T>,
  fresh: readonly T[] | undefined,
): readonly T[] {
  const owner = ownerId();
  const [cached] = useState(
    () => readStored(name, owner, z.array(schema).max(SNAPSHOT_CAP)) ?? [],
  );
  useEffect(() => {
    if (fresh) writeStored(name, owner, fresh);
  }, [name, owner, fresh]);
  return fresh ?? cached;
}

export function useFrecency() {
  const owner = ownerId();
  const [table] = useState(
    () => readStored("frecency", owner, frecencySchema) ?? {},
  );
  return {
    usesOf: (id: string, now: number) => usesAt(table, id, now),
    record: (id: string) =>
      writeStored(
        "frecency",
        owner,
        recordUse(
          readStored("frecency", owner, frecencySchema) ?? {},
          id,
          Date.now(),
        ),
      ),
  };
}
