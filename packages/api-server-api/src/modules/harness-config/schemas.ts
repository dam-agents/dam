import { harnessConfigCatalog, harnessConfigChoice } from "agent-runtime-api";
import { z } from "zod";

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

export const harnessConfigSnapshotSchema = z.object({
  model: z.string().nullable(),
  mode: z.string().nullable(),
  configOptions: agentConfigOptionsSchema,
  availableModels: z.array(harnessConfigChoice).nullable(),
  capturedAt: z.string().datetime(),
  modelAtDiscovery: z.string().nullable().optional(),
  confirmed: z.boolean(),
});

export const harnessConfigSnapshotResultSchema = z.object({
  hasRun: z.boolean(),
  snapshot: harnessConfigSnapshotSchema.nullable(),
});
