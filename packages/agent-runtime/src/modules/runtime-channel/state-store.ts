import { z } from "zod";
import type {
  DocumentStore,
  DocumentStoreBackend,
} from "../../core/document-store.js";

const runtimeStateSchema = z.object({
  lastAppliedVersion: z.number(),
  lastAppliedHash: z.string().nullable().catch(null),
  eventRuns: z.record(z.string(), z.number()).catch({}).default({}),
});

export type RuntimeState = z.infer<typeof runtimeStateSchema>;
export type StateStore = DocumentStore<RuntimeState>;

// UNIT_BOUNDARY_DESCRIPTION: the runtime's record of the last desired state it applied, which hello reports so the api-server pushes only what is newer. The record only holds while the env file that push wrote is still on the disk: a home restored without it, as a runtime migration restores one, drops the applied version and hash so hello asks for the whole state again, or the harness starts with no provider. Event runs are kept, so an event that already ran does not run twice.
export function createStateStore(
  backend: DocumentStoreBackend,
  envReady: () => boolean = () => true,
): StateStore {
  const store = backend.open("runtime-state", {
    schema: runtimeStateSchema,
    initial: () => ({
      lastAppliedVersion: 0,
      lastAppliedHash: null,
      eventRuns: {},
    }),
  });
  const state = store.read();
  if (state.lastAppliedVersion && !envReady())
    store.write({ ...state, lastAppliedVersion: 0, lastAppliedHash: null });
  return store;
}
