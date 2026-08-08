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
  /** Models the provider offered at capture time; null when the manifest
   *  declares no `modelDiscovery` source, or discovery failed. */
  availableModels: z.array(harnessConfigChoice).nullable(),
  capturedAt: z.string().datetime(),
  /** False while the only source is an apply the pod has not reported back. */
  confirmed: z.boolean(),
});

export const harnessConfigSnapshotResultSchema = z.object({
  /** The agent has sent `hello` at least once, so a snapshot is possible.
   *  False means "never run" — genuinely nothing to show, not a miss. */
  hasRun: z.boolean(),
  snapshot: harnessConfigSnapshotSchema.nullable(),
});
