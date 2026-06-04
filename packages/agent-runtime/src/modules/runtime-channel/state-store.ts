import { z } from "zod";
import type {
  DocumentStore,
  DocumentStoreBackend,
} from "../../core/document-store.js";

const runtimeStateSchema = z.object({
  lastAppliedVersion: z.number(),
  lastAppliedHash: z.string().nullable().catch(null),
  // Latest fired timestamp per `kind:scheduleId` — dedups/supersedes events independently of contributions.
  eventRuns: z.record(z.string(), z.number()).catch({}).default({}),
});

export type RuntimeState = z.infer<typeof runtimeStateSchema>;
export type StateStore = DocumentStore<RuntimeState>;

export function createStateStore(backend: DocumentStoreBackend): StateStore {
  return backend.open("runtime-state", {
    schema: runtimeStateSchema,
    initial: () => ({
      lastAppliedVersion: 0,
      lastAppliedHash: null,
      eventRuns: {},
    }),
  });
}
