import { z } from "zod";
import {
  sessionDefaultsEventPayload,
  type SessionDefaultsEventPayload,
} from "agent-runtime-api";
import type { DocumentStoreBackend } from "../../../core/document-store.js";

export interface SessionDefaultsStore {
  get(): SessionDefaultsEventPayload | null;
  revision(): number;
  set(defaults: SessionDefaultsEventPayload): void;
}

const stateSchema = z.object({
  defaults: sessionDefaultsEventPayload.nullable().catch(null).default(null),
  revision: z.number().int().nonnegative().catch(0).default(0),
});

/**
 * UNIT_BOUNDARY_DESCRIPTION: the agent's chat, channel and scheduled
 * defaults as the api-server last sent them, kept on the home volume so a
 * restarted runtime still applies them before the next delivery arrives.
 * Null until the first delivery. The revision counts deliveries, so a
 * session can wait for the next one.
 */
export function createSessionDefaultsStore(
  backend: DocumentStoreBackend,
): SessionDefaultsStore {
  const store = backend.open("session-defaults", {
    schema: stateSchema,
    initial: () => ({ defaults: null, revision: 0 }),
  });
  return {
    get: () => store.read().defaults,
    revision: () => store.read().revision,
    set: (defaults) =>
      store.write({ defaults, revision: store.read().revision + 1 }),
  };
}
