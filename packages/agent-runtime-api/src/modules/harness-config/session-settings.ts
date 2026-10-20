import { z } from "zod";
import type { HarnessConfigCatalog } from "../runtime/types.js";

export const sessionSettingsSchema = z
  .record(z.string().min(1).max(100), z.string().min(1).max(500))
  .refine((settings) => Object.keys(settings).length <= 32);

export type SessionSettings = z.infer<typeof sessionSettingsSchema>;

export const SUBAGENT_MODEL_SETTING = "subagentModel";

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

/**
 * UNIT_BOUNDARY_DESCRIPTION: the mode a session starts on when neither the
 * session nor the agent's config file names one: the catalog's default for
 * that option, and where the session's model cannot use it, the first choice
 * of the option the model's constraints allow. A mode the model cannot use
 * would make the harness refuse the session.
 */
export function startModeFor(
  catalog: HarnessConfigCatalog | undefined,
  model: string | null | undefined,
  id: string,
): string | null {
  const option = catalog?.options.find((o) => o.id === id);
  if (!option) return null;
  const allowed = modelConstraintsFor(catalog, model)?.[id];
  const usable = (value: string) =>
    allowed === undefined || allowed.includes(value);
  const start =
    option.default !== undefined && usable(option.default)
      ? option.default
      : option.choices.find((choice) => usable(choice.value))?.value;
  return start ?? null;
}

export function sessionSettingsError(
  catalog: HarnessConfigCatalog | undefined,
  settings: SessionSettings,
  model?: string | null,
): string | undefined {
  for (const [id, value] of Object.entries(settings)) {
    if (isPlatformSubagentSetting(id)) continue;
    const option = catalog?.options.find(
      (o) => o.id === id && (o.id !== "model" || o.category !== "model"),
    );
    if (!option) return `Unsupported session setting: ${id}=${value}`;
    if (option.category === "model" && option.choices.length === 0) continue;
    if (!option.choices.some((choice) => choice.value === value))
      return `Unsupported session setting: ${id}=${value}`;
    const constrainedBy = option.subagents
      ? (settings[SUBAGENT_MODEL_SETTING] ?? null)
      : model;
    const allowed = modelConstraintsFor(catalog, constrainedBy)?.[id];
    if (allowed && !allowed.includes(value))
      return `The ${id} setting is not available for ${constrainedBy}`;
  }
}

export const PLATFORM_SUBAGENT_PREFIX = "platformSubagent.";

export const isPlatformSubagentSetting = (id: string): boolean =>
  id.startsWith(PLATFORM_SUBAGENT_PREFIX);

export interface SubAgentHarnessConfig {
  model?: string;
  mode?: string;
  configOptions?: Record<string, string>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a session's platform sub-agent choice is kept in
 * its settings record under `platformSubagent.<id>`: the harness, its model,
 * its mode, and any other id as one of that harness's config options. The
 * record is the one the saved pair and schedules already carry, so the choice
 * travels with them.
 */
export function platformSubagentChoice(
  settings: Readonly<Record<string, string>>,
): ({ harness: string | null } & SubAgentHarnessConfig) | null {
  const own = Object.entries(settings).flatMap(([id, value]) =>
    isPlatformSubagentSetting(id)
      ? [[id.slice(PLATFORM_SUBAGENT_PREFIX.length), value] as const]
      : [],
  );
  if (own.length === 0) return null;
  const configOptions = Object.fromEntries(
    own.filter(([id]) => !["harness", "model", "mode"].includes(id)),
  );
  const field = (id: string) => own.find(([key]) => key === id)?.[1];
  const model = field("model");
  const mode = field("mode");
  return {
    harness: field("harness") ?? null,
    ...(model !== undefined && { model }),
    ...(mode !== undefined && { mode }),
    ...(Object.keys(configOptions).length > 0 && { configOptions }),
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the platform sub-agent choice is checked against
 * the chosen harness's catalog: a value it does not offer, one a person must
 * approve (an unattended sub-agent would wait on it until its deadline), or
 * one the chosen model's constraints exclude is refused. The model itself is
 * checked at spawn, against the catalog the sub-agent's harness lists. A
 * harness the agent no longer carries is not refused here, or it would block
 * every later change to the session's other settings; the spawn refuses it.
 */
export function platformSubagentSettingsError(
  settings: Readonly<Record<string, string>>,
  catalogOf: (harness: string) => HarnessConfigCatalog | undefined,
): string | undefined {
  const choice = platformSubagentChoice(settings);
  if (!choice) return undefined;
  if (choice.harness === null)
    return "Platform sub-agent settings need a harness";
  const catalog = catalogOf(choice.harness);
  if (!catalog) return undefined;
  const values = [
    ...(choice.mode !== undefined ? [["mode", choice.mode] as const] : []),
    ...Object.entries(choice.configOptions ?? {}),
  ];
  for (const [id, value] of values) {
    const option = catalog.options.find(
      (o) => o.id === id && o.category !== "model" && !o.subagents,
    );
    const offered = option?.choices.find((c) => c.value === value);
    if (!offered)
      return `Unsupported platform sub-agent setting: ${id}=${value}`;
    if (offered.needsApproval)
      return `A platform sub-agent runs unattended, so ${id}=${value} asks for approvals nobody is there to give`;
    const allowed = modelConstraintsFor(catalog, choice.model)?.[id];
    if (allowed && !allowed.includes(value))
      return `The ${id} setting is not available for ${choice.model}`;
  }
}
