import { z } from "zod";
import type { HarnessConfigCatalog } from "../runtime/types.js";

export const sessionSettingsSchema = z
  .record(z.string().min(1).max(100), z.string().min(1).max(500))
  .refine((settings) => Object.keys(settings).length <= 32);

export type SessionSettings = z.infer<typeof sessionSettingsSchema>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: a catalog keys its model constraints by a tier
 * word (haiku), while a session names a provider-qualified model, so the
 * constraints of the key the model's upstream id carries apply to it.
 */
export function modelConstraintsFor(
  catalog: HarnessConfigCatalog | undefined,
  model: string | null | undefined,
): Record<string, string[]> | undefined {
  const constraints = catalog?.modelConstraints;
  if (!constraints || !model) return undefined;
  if (constraints[model]) return constraints[model];
  const unprefixed = model.replace(/^claude\//i, "");
  const slash = unprefixed.indexOf("/");
  const upstream = (
    slash === -1 ? unprefixed : unprefixed.slice(slash + 1)
  ).toLowerCase();
  const key = Object.keys(constraints).find((k) =>
    upstream.includes(k.toLowerCase()),
  );
  return key === undefined ? undefined : constraints[key];
}

export function sessionSettingsError(
  catalog: HarnessConfigCatalog | undefined,
  settings: SessionSettings,
  model?: string | null,
): string | undefined {
  for (const [id, value] of Object.entries(settings)) {
    const option = catalog?.options.find(
      (o) => o.id === id && (o.id !== "model" || o.category !== "model"),
    );
    if (!option) return `Unsupported session setting: ${id}=${value}`;
    if (option.category === "model" && option.choices.length === 0) continue;
    if (!option.choices.some((choice) => choice.value === value))
      return `Unsupported session setting: ${id}=${value}`;
    const allowed = modelConstraintsFor(catalog, model)?.[id];
    if (allowed && !allowed.includes(value))
      return `The ${id} setting is not available for ${model}`;
  }
}
