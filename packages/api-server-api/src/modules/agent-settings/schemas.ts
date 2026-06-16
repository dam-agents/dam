import { z } from "zod";

/** configId -> select value (string) or boolean, mirroring ACP config options. */
export const agentConfigOptionsSchema = z.record(
  z.string().min(1),
  z.union([z.string(), z.boolean()]),
);

export const agentSettingsSchema = z.object({
  model: z.string().min(1).nullable(),
  mode: z.string().min(1).nullable(),
  configOptions: agentConfigOptionsSchema,
});

export const agentSettingsViewSchema = agentSettingsSchema.extend({
  supported: z.boolean(),
});

export const agentSettingsGetInputSchema = z.object({
  agentId: z.string().min(1),
});

// The UI sends the full intended state on every save; a `null` model/mode or
// an absent configOption key clears that default.
export const agentSettingsSetInputSchema = z.object({
  agentId: z.string().min(1),
  model: z.string().min(1).nullable().default(null),
  mode: z.string().min(1).nullable().default(null),
  configOptions: agentConfigOptionsSchema.default({}),
});
