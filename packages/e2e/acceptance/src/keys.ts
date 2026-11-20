import { TRPCClientError } from "@trpc/client";
import type { Scope } from "api-server-api";

import { type Api, apiFor } from "./api.js";
import type { Person } from "./people.js";
import type { World } from "./world.js";

/** UNIT_BOUNDARY_DESCRIPTION: the API keys an example's persons hold, by the name the feature file gives each, and the client that acts with one. */
export interface HeldKey {
  id: string;
  api: Api;
}

/** UNIT_BOUNDARY_DESCRIPTION: what the last call made with a key came to: its result, or the tRPC code it was refused with. */
export interface Outcome {
  value?: unknown;
  refused?: string;
}

/** UNIT_BOUNDARY_DESCRIPTION: makes a key of the person's, through the browser-only procedure a signed-in person uses, and revokes it when the example ends. */
export async function makeKey(
  world: World,
  keys: Map<string, HeldKey>,
  person: Person,
  name: string,
  scopes: Scope[],
  agentIds: string[] | "*",
): Promise<void> {
  const { key, plaintext } = await person.api.apiKeys.create.mutate({
    name: world.unique(name),
    scopes,
    agentIds,
  });
  keys.set(name, { id: key.id, api: apiFor(async () => plaintext) });
  world.undo.push(() => person.api.apiKeys.revoke.mutate({ id: key.id }));
  world.note({ step: "key made", name, scopes, agentIds });
}

/** UNIT_BOUNDARY_DESCRIPTION: runs one call and keeps what it came to, a refusal included, for the Then that reads it. */
export async function attempt(call: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { value: await call() };
  } catch (error) {
    if (error instanceof TRPCClientError) {
      const status = (error.meta?.response as { status?: number } | undefined)
        ?.status;
      return {
        refused: String(
          error.data?.code ?? (status === 401 ? "UNAUTHORIZED" : error.message),
        ),
      };
    }
    throw error;
  }
}
