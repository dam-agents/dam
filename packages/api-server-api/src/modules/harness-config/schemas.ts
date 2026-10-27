import {
  harnessCapability,
  harnessConfigCatalog,
  harnessConfigChoice,
  sessionSettingsSchema,
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

export const defaultKindSchema = z.enum(["chat", "channel", "scheduled"]);

export const harnessConfigDefaultForInputSchema = z.object({
  agentId: z.string().min(1),
  harness: z.string().min(1).optional(),
  kind: defaultKindSchema.default("chat"),
});

export const sessionPairInputSchema = z.object({
  agentId: z.string().min(1),
  kind: defaultKindSchema.default("chat"),
});

export const harnessConfigSnapshotInputSchema = z.object({
  agentId: z.string().min(1),
  harness: z.string().min(1).optional(),
});

export const harnessConfigStatusSchema = z.object({
  supported: z.boolean(),
  catalog: harnessConfigCatalog.nullable(),
  sessionModel: z.boolean(),
  modelRouter: z.boolean(),
  followsDefaults: z.boolean(),
  defaultHarness: z.string().nullable(),
  harnesses: z.array(harnessCapability).nullable(),
});

export const sessionPairSchema = z.object({
  harness: z.string().min(1),
  provider: z.string().min(1).nullable(),
  model: z.string().min(1).nullable(),
  settings: sessionSettingsSchema.optional(),
});

/* UNIT_BOUNDARY_DESCRIPTION: a chat default is a profile reference or an inline
 * pair. A reference names the profile instead of the values, and the runtime is
 * sent the pair it resolves to, so the two never travel as one record. */
export const rememberSessionPairInputSchema = sessionPairSchema.extend({
  agentId: z.string().min(1),
  kind: defaultKindSchema.default("chat"),
  profileId: z.string().min(1).nullable().optional(),
  platformSubagentProfileId: z.string().min(1).nullable().optional(),
});

export const clearSessionDefaultInputSchema = z.object({
  agentId: z.string().min(1),
  kind: z.enum(["channel", "scheduled"]),
});

export const sessionDefaultsSchema = z.object({
  chat: sessionPairSchema.nullable(),
  channel: sessionPairSchema.nullable(),
  scheduled: sessionPairSchema.nullable(),
});

/* UNIT_BOUNDARY_DESCRIPTION: the saved defaults, plus the profile the chat
 * default names, so a form that prefills from "the chat profile" reads the
 * reference instead of guessing it from the values. */
export const sessionDefaultsViewSchema = sessionDefaultsSchema.extend({
  chatProfileId: z.string().nullable(),
  /* UNIT_BOUNDARY_DESCRIPTION: the chat default's subagent slot as stored, a
   * profile or values, which `chat` drops while it or the primary cannot run,
   * so a picker still shows what the slot holds. */
  platformSubagentProfileId: z.string().nullable().optional(),
  platformSubagentSettings: z
    .record(z.string(), z.string())
    .nullable()
    .optional(),
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
