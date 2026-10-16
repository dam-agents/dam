import { z } from "zod";

export const chatFormModeSchema = z.enum(["off", "input", "all"]);
export const chatFormPacingSchema = z.enum([
  "agent",
  "together",
  "one-at-a-time",
]);
export const chatFormRecommendSchema = z.enum(["preselect", "mark", "off"]);

export const chatFormPreferencesSchema = z.object({
  forms: chatFormModeSchema,
  pacing: chatFormPacingSchema,
  recommend: chatFormRecommendSchema,
  lockComposer: z.boolean(),
});

export type ChatFormPreferences = z.infer<typeof chatFormPreferencesSchema>;

export const DEFAULT_CHAT_FORM_PREFERENCES: ChatFormPreferences = {
  forms: "all",
  pacing: "agent",
  recommend: "preselect",
  lockComposer: true,
};

const storedPreferencesSchema = z.object({
  forms: chatFormModeSchema.catch(DEFAULT_CHAT_FORM_PREFERENCES.forms),
  pacing: chatFormPacingSchema.catch(DEFAULT_CHAT_FORM_PREFERENCES.pacing),
  recommend: chatFormRecommendSchema.catch(
    DEFAULT_CHAT_FORM_PREFERENCES.recommend,
  ),
  lockComposer: z.boolean().catch(DEFAULT_CHAT_FORM_PREFERENCES.lockComposer),
});

export function readChatFormPreferences(stored: unknown): ChatFormPreferences {
  const parsed = storedPreferencesSchema.safeParse(stored ?? {});
  return parsed.success ? parsed.data : DEFAULT_CHAT_FORM_PREFERENCES;
}

export const chatFormPreferencesGetInputSchema = z.object({
  agentId: z.string().min(1).max(253),
});

export const chatFormPreferencesSetInputSchema = z.object({
  agentId: z.string().min(1).max(253),
  preferences: chatFormPreferencesSchema,
});

export interface ChatFormPreferencesService {
  get(agentId: string): Promise<ChatFormPreferences>;
  set(
    agentId: string,
    preferences: ChatFormPreferences,
  ): Promise<ChatFormPreferences>;
}
