import { z } from "zod";
import type {
  HarnessCapability,
  HarnessConfigCatalog,
} from "../runtime/types.js";

export const sessionSettingsSchema = z
  .record(z.string().min(1).max(100), z.string().min(1).max(500))
  .refine((settings) => Object.keys(settings).length <= 32);

export type SessionSettings = z.infer<typeof sessionSettingsSchema>;

export const SUBAGENT_MODEL_SETTING = "subagentModel";

/** UNIT_BOUNDARY_DESCRIPTION: the harness's own subagents' reasoning effort, which the router writes over the effort a call marked as a subagent's carries. */
export const SUBAGENT_EFFORT_SETTING = "subagentEffort";

/** UNIT_BOUNDARY_DESCRIPTION: a setting of the harness's own subagents, which one subagent choice drives beside the platform sub-agent it spawns (D193B). */
export const isNativeSubagentSetting = (id: string): boolean =>
  id === SUBAGENT_MODEL_SETTING || id === SUBAGENT_EFFORT_SETTING;

/**
 * UNIT_BOUNDARY_DESCRIPTION: a catalog keys its model constraints either by a
 * session's model name, provider-qualified or not, or by a tier alias
 * (`haiku`) that a session names alone or under a provider (`claude/haiku`,
 * `anthropic/haiku`). Only those names take a key: a concrete model that
 * happens to contain the tier word, such as `claude-haiku-5-5`, is a model of
 * its own and takes only a key it matches exactly.
 */
export function modelConstraintsFor(
  catalog: HarnessConfigCatalog | undefined,
  model: string | null | undefined,
): Record<string, string[]> | undefined {
  const constraints = catalog?.modelConstraints;
  if (!constraints || !model) return undefined;
  const stripped = model.replace(/^claude\//i, "");
  const last = (stripped.split("/").pop() ?? stripped).replace(/-\d{8}$/, "");
  const key = Object.keys(constraints).find((k) => {
    const name = k.toLowerCase();
    return [model, stripped, last].some(
      (candidate) => candidate.toLowerCase() === name,
    );
  });
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

/** UNIT_BOUNDARY_DESCRIPTION: Copilot's Autopilot, its mode that keeps working without stopping, is its Auto mode; it runs every tool unasked in any mode. */
export const COPILOT_AUTOPILOT =
  "https://agentclientprotocol.com/protocol/session-modes#autopilot";

/** UNIT_BOUNDARY_DESCRIPTION: the option that holds tool approval: Bob's approvals, or a mode that can bypass (Claude Code's) or run on Autopilot (Copilot's); a harness with neither runs every tool unasked. A session picks its own and an agent may hold one for all its sessions, so no pair, profile, channel or schedule carries it. */
export function approvalOption(catalog: HarnessConfigCatalog | undefined) {
  const options = catalog?.options ?? [];
  return (
    options.find((o) => o.category === "approvals") ??
    options.find(
      (o) =>
        o.category === "mode" &&
        o.choices.some(
          (c) =>
            c.value === "bypassPermissions" || c.value === COPILOT_AUTOPILOT,
        ),
    )
  );
}

export function withoutApproval(
  catalog: HarnessConfigCatalog | undefined,
  settings: Record<string, string> | undefined,
): Record<string, string> | undefined {
  const id = approvalOption(catalog)?.id;
  if (settings === undefined || id === undefined) return settings;
  return Object.fromEntries(Object.entries(settings).filter(([k]) => k !== id));
}

export const toolApprovalSchema = z.enum(["ask", "auto", "bypass"]);

export type ToolApproval = z.infer<typeof toolApprovalSchema>;

const TOOL_APPROVAL_VALUES: Record<ToolApproval, readonly string[]> = {
  ask: ["acceptEdits", "ask"],
  auto: ["auto", COPILOT_AUTOPILOT],
  bypass: ["bypassPermissions"],
};

export interface ToolApprovalChoice {
  approval: ToolApproval;
  value: string;
  needsApproval: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the tool approvals a harness offers, each with
 * the value its own option takes. Claude Code keeps approval in its
 * permission mode, where asking is Accept edits (edits never prompt); Bob
 * keeps it in its approvals option and has no bypass; Copilot's Autopilot is
 * its auto. A Plan mode is not a tool approval.
 */
export function toolApprovalChoices(
  catalog: HarnessConfigCatalog | undefined,
): ToolApprovalChoice[] {
  const option = approvalOption(catalog);
  return toolApprovalSchema.options.flatMap((approval) => {
    const choice = option?.choices.find((c) =>
      TOOL_APPROVAL_VALUES[approval].includes(c.value),
    );
    return choice
      ? [
          {
            approval,
            value: choice.value,
            needsApproval: choice.needsApproval === true,
          },
        ]
      : [];
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the value the agent's own tool approval gives a
 * session that picked none, as the setting of the harness that holds it. Null
 * leaves the session on the start the harness gets without one: the harness
 * offers no such approval or keeps it outside its mode (Bob's approvals are a
 * flag of its process), the session's model cannot use it, or nobody is there
 * to answer a choice that asks, as on a channel turn or a schedule fire. The
 * runtime, the api-server's check and the chat's picker all ask this one
 * rule, so what is saved and shown is what a session starts on.
 */
export function agentToolApprovalSetting(
  catalog: HarnessConfigCatalog | undefined,
  approval: ToolApproval | null | undefined,
  session: { model: string | null; unattended: boolean },
): { id: string; value: string } | null {
  const option = approvalOption(catalog);
  const choice = toolApprovalChoices(catalog).find(
    (c) => c.approval === approval,
  );
  if (option?.category !== "mode" || choice === undefined) return null;
  const id = option.id;
  if (choice.needsApproval && session.unattended) return null;
  const allowed = modelConstraintsFor(catalog, session.model)?.[id];
  if (allowed && !allowed.includes(choice.value)) return null;
  return { id, value: choice.value };
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

/** UNIT_BOUNDARY_DESCRIPTION: the platform sub-agent's reasoning effort, which the harness's own subagents take as `subagentEffort` so one choice drives both (D193B). */
export const SUBAGENT_EFFORT_SLOT = `${PLATFORM_SUBAGENT_PREFIX}effort`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: one subagent choice drives both kinds of subagent
 * (D193B), the rule every reader applies. With no effective platform sub-agent
 * the primary's settings are the answer as they stand, so an old record or an
 * own native pick survives; with one, the platform keys are the slot, and the
 * harness's own subagents take its model, and its effort, only where the model
 * runs on the primary's own provider (which the caller answers with the
 * harness's own listing) and the harness offers that setting. A slot never
 * holds a native key: storage keeps platform keys only. `primarySettings` is
 * the primary's alone, the platform keys split off first.
 */
export function effectiveSubagentSettings(
  capability: HarnessCapability | undefined,
  primarySettings: Record<string, string>,
  subagent: Record<string, string> | null,
  runsNatively: (model: string) => boolean,
): Record<string, string> {
  if (subagent === null) return primarySettings;
  const offered = (id: string, value: string): boolean => {
    if (capability?.sessionSettings?.includes(id) !== true) return false;
    const option = capability.harnessConfigCatalog?.options.find(
      (o) => o.id === id,
    );
    if (!option) return false;
    return (
      option.choices.length === 0 ||
      option.choices.some((choice) => choice.value === value)
    );
  };
  const settings: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(primarySettings).filter(
        ([id]) => !isNativeSubagentSetting(id),
      ),
    ),
    ...subagent,
  };
  const model = subagent["platformSubagent.model"];
  if (model === undefined || !runsNatively(model)) return settings;
  if (offered(SUBAGENT_MODEL_SETTING, model))
    settings[SUBAGENT_MODEL_SETTING] = model;
  const effort = subagent[SUBAGENT_EFFORT_SLOT];
  if (effort !== undefined && offered(SUBAGENT_EFFORT_SETTING, effort))
    settings[SUBAGENT_EFFORT_SETTING] = effort;
  return settings;
}

export interface ProfileSubagent {
  harness: string;
  settings: Readonly<Record<string, string>>;
  subagent: { model: string } | null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the platform sub-agent a profile lends a slot that
 * holds none of its own, platform keys only (D193B): its own harness, its
 * sub-agent's model, and the effort it keeps as the native `subagentEffort`, so
 * one choice drives both kinds of subagent. Null is a profile that names none.
 */
export function lentSubagentOfProfile(
  profile: ProfileSubagent,
): Record<string, string> | null {
  if (!profile.subagent) return null;
  const effort = profile.settings[SUBAGENT_EFFORT_SETTING];
  return {
    "platformSubagent.harness": profile.harness,
    "platformSubagent.model": profile.subagent.model,
    ...(effort !== undefined && { [SUBAGENT_EFFORT_SLOT]: effort }),
  };
}

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
