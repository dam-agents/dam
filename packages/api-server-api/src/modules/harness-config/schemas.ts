import { harnessConfigCatalog } from "agent-runtime-api";
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
