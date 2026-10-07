import { z } from "zod";
import { finishedRowSchema } from "agent-runtime-api";
import type {
  DocumentStore,
  DocumentStoreBackend,
} from "../../../core/document-store.js";
import type { ProcessesDocument, TrackedRow } from "../domain/inventory.js";

const trackedRowSchema: z.ZodType<TrackedRow> = z.object({
  identity: z.string(),
  key: z.string(),
  kind: z.enum(["harness-task", "detached"]),
  procKey: z.string().nullable(),
  command: z.string(),
  startedAt: z.string(),
  outputPath: z.string().nullable(),
  keepsAwake: z.boolean(),
  keepSource: z.enum(["default", "agent", "user"]),
});

const processesDocumentSchema: z.ZodType<ProcessesDocument> = z.object({
  bootId: z.string(),
  lastScanAt: z.string().nullable(),
  lastRunning: z.array(trackedRowSchema),
  finished: z.array(finishedRowSchema),
});

export function openProcessesDocument(
  backend: DocumentStoreBackend,
): DocumentStore<ProcessesDocument> {
  return backend.open("processes", {
    schema: processesDocumentSchema,
    initial: () => ({
      bootId: "",
      lastScanAt: null,
      lastRunning: [],
      finished: [],
    }),
  });
}
