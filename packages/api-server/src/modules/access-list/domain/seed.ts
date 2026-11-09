import { viewerEmailSchema } from "api-server-api";
import { z } from "zod";

const seedSchema = z.array(viewerEmailSchema);

// UNIT_BOUNDARY_DESCRIPTION: the addresses the chart's `accessList.seed` names, read from ACCESS_LIST_SEED as a JSON array of emails, lowercased and without repeats. The seed carries an existing list into the database on rollout, so nobody loses access; a malformed seed stops the boot rather than starting with a list that is silently short.
export function parseAccessListSeed(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `ACCESS_LIST_SEED is not valid JSON: ${(err as Error).message}`,
    );
  }
  return [...new Set(seedSchema.parse(json))];
}
