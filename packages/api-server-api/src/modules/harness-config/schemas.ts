import {
  harnessCapability,
  harnessConfigCatalog,
  harnessConfigChoice,
} from "agent-runtime-api";
import { z } from "zod";

export const agentConfigOptionsSchema = z.record(z.string().min(1), z.string());

export const harnessConfigApplyInputSchema = z.object({
  agentId: z.string().min(1),
  harness: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
  configOptions: agentConfigOptionsSchema.optional(),
  unset: z.array(z.string().min(1)).optional(),
});

export const harnessConfigStatusInputSchema = z.object({
  agentId: z.string().min(1),
});

export const harnessConfigSnapshotInputSchema = z.object({
  agentId: z.string().min(1),
  harness: z.string().min(1).optional(),
});

export const harnessConfigStatusSchema = z.object({
  supported: z.boolean(),
  catalog: harnessConfigCatalog.nullable(),
  sessionModel: z.boolean(),
  defaultHarness: z.string().nullable(),
  harnesses: z.array(harnessCapability).nullable(),
});

export const sessionPairSchema = z.object({
  harness: z.string().min(1),
  provider: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
});

export const rememberSessionPairInputSchema = sessionPairSchema.extend({
  agentId: z.string().min(1),
});

export const harnessConfigSettledSchema = z.object({
  settled: z.boolean(),
});

const harnessConfigSnapshotFields = z.object({
  model: z.string().nullable(),
  mode: z.string().nullable(),
  configOptions: agentConfigOptionsSchema,
  availableModels: z.array(harnessConfigChoice).nullable(),
  capturedAt: z.string().datetime(),
  modelAtDiscovery: z.string().nullable().optional(),
  defaultModel: z.string().nullable().optional(),
  confirmed: z.boolean(),
});

export const harnessConfigSnapshotSchema = harnessConfigSnapshotFields.extend({
  harnesses: z.record(z.string(), harnessConfigSnapshotFields).optional(),
});

export const harnessConfigSnapshotResultSchema = z.object({
  hasRun: z.boolean(),
  snapshot: harnessConfigSnapshotSchema.nullable(),
});
