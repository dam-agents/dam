import { harnessConfigCatalog, harnessConfigChoice } from "agent-runtime-api";
import { z } from "zod";

// String-only: the catalog offers string choices and the UI is string selects,
// so a boolean option couldn't be shown or set.
export const agentConfigOptionsSchema = z.record(z.string().min(1), z.string());

export const harnessConfigApplyInputSchema = z.object({
  agentId: z.string().min(1),
  model: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
  configOptions: agentConfigOptionsSchema.optional(),
  unset: z.array(z.string().min(1)).optional(),
});

export const harnessConfigStatusInputSchema = z.object({
  agentId: z.string().min(1),
});

export const harnessConfigStatusSchema = z.object({
  supported: z.boolean(),
  catalog: harnessConfigCatalog.nullable(),
});

export const harnessConfigSettledSchema = z.object({
  settled: z.boolean(),
});

/** The platform's durable copy of what the harness resolved for itself. Never
 *  authoritative — `harness-config` writes the harness's file once and never
 *  re-asserts, so a hand-edit moves the file out from under this. */
export const harnessConfigSnapshotSchema = z.object({
  model: z.string().nullable(),
  mode: z.string().nullable(),
  configOptions: agentConfigOptionsSchema,
  /** Models the provider offered when it was last successfully asked; null when
   *  the harness declares no discovery source. A failed attempt leaves this
   *  alone, so it can be older than the rest of the snapshot. */
  availableModels: z.array(harnessConfigChoice).nullable(),
  capturedAt: z.string().datetime(),
  /** The model that was in effect when `availableModels` was observed. Comparing
   *  the two is only meaningful while this still equals `model`: a model changed
   *  since the list was read proves nothing about whether the provider offers it.
   *  Absent on rows written before this field existed — treat as unpaired. */
  modelAtDiscovery: z.string().nullable().optional(),
  /** False while the only source is an apply the pod has not reported back. */
  confirmed: z.boolean(),
});

export const harnessConfigSnapshotResultSchema = z.object({
  /** The agent has sent `hello` at least once, so a snapshot is possible.
   *  False means "never run" — genuinely nothing to show, not a miss. */
  hasRun: z.boolean(),
  snapshot: harnessConfigSnapshotSchema.nullable(),
});
