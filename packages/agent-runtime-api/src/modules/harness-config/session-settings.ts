import { z } from "zod";
import type { HarnessConfigCatalog } from "../runtime/types.js";

export const sessionSettingsSchema = z
  .record(z.string().min(1).max(100), z.string().min(1).max(500))
  .refine((settings) => Object.keys(settings).length <= 32);

export type SessionSettings = z.infer<typeof sessionSettingsSchema>;

export function sessionSettingsError(
  catalog: HarnessConfigCatalog | undefined,
  settings: SessionSettings,
  model?: string | null,
): string | undefined {
  for (const [id, value] of Object.entries(settings)) {
    const option = catalog?.options.find(
      (o) => o.id === id && o.category !== "model",
    );
    if (!option?.choices.some((choice) => choice.value === value))
      return `Unsupported session setting: ${id}=${value}`;
    const allowed = model
      ? catalog?.modelConstraints?.[model]?.[id]
      : undefined;
    if (allowed && !allowed.includes(value))
      return `The ${id} setting is not available for ${model}`;
  }
}
