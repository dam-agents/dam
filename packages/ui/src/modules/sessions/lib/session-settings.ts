import type {
  HarnessCapability,
  HarnessConfigCurrent,
} from "agent-runtime-api";
import {
  modelConstraintsFor,
  startModeFor,
  SUBAGENT_MODEL_SETTING,
} from "agent-runtime-api";
import { parseQualifiedModel } from "api-server-api";

import {
  findModel,
  type ModelGroup,
  sameSideGroups,
} from "./catalog-groups.js";
import { prettyModelLabel } from "./model-families.js";

export function sessionSettingOptions(
  capability: HarnessCapability | undefined,
) {
  return (
    capability?.harnessConfigCatalog?.options.filter(
      (o) => o.id !== "model" && capability.sessionSettings?.includes(o.id),
    ) ?? []
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the value each setting shows before the owner
 * picks one. The runtime applies the option's own default, except for the
 * permission mode and a setting whose default a person must approve, which
 * stay what the agent's configured value for the harness holds. A mode with
 * neither is the runtime's to choose, and it chooses by the model the session
 * runs on — its own, or the one the agent's config file names where the
 * session names none — and only where the harness opts in, since a harness
 * with start modes of its own keeps them. The picker asks the same rule, so a
 * session on a model that cannot use the option's default shows the mode it
 * really starts in.
 */
export function settingDefaults(
  capability: HarnessCapability | undefined,
  configured: HarnessConfigCurrent | null | undefined,
  model: string | null,
): Record<string, string> {
  return Object.fromEntries(
    sessionSettingOptions(capability)
      .filter((o) => !o.subagents)
      .flatMap((o) => {
        const derived =
          o.id === "mode" && capability?.derivedStartMode?.includes(o.id)
            ? startModeFor(
                capability.harnessConfigCatalog,
                model ?? configured?.model ?? null,
                o.id,
              )
            : null;
        const harnessOwned =
          o.category === "mode" ||
          o.choices.some((c) => c.value === o.default && c.needsApproval);
        const value = harnessOwned
          ? ((o.id === "mode"
              ? (configured?.mode ?? derived)
              : configured?.configOptions[o.id]) ?? o.default)
          : o.default;
        return value &&
          (o.choices.some((c) => c.value === value) || isModelOption(o))
          ? [[o.id, value]]
          : [];
      }),
  );
}

export function applySettingChanges(
  settings: Readonly<Record<string, string>>,
  changes: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries({ ...settings, ...changes }).filter(([, v]) => v !== ""),
  );
}

export const isModelOption = (o: {
  category: string;
  choices: readonly unknown[];
}) => o.category === "model" && o.choices.length === 0;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the settings a newly picked model keeps. A value
 * the model's constraints exclude (Haiku takes no effort) and a subagent
 * model on the other side of the router/native split are dropped, since the
 * runtime refuses either; a value it cannot judge stays.
 */
export function settingsForModel(
  capability: HarnessCapability | undefined,
  groups: readonly ModelGroup[],
  model: string | null,
  settings: Readonly<Record<string, string>>,
): Record<string, string> {
  const allowed = modelConstraintsFor(capability?.harnessConfigCatalog, model);
  const side = sameSideGroups(groups, model);
  return Object.fromEntries(
    Object.entries(settings).filter(([id, value]) => {
      const option = capability?.harnessConfigCatalog?.options.find(
        (o) => o.id === id,
      );
      if (option && isModelOption(option)) {
        const hit = findModel(groups, value);
        return !hit || side.includes(hit.group);
      }
      const only = option?.subagents
        ? modelConstraintsFor(
            capability?.harnessConfigCatalog,
            settings[SUBAGENT_MODEL_SETTING] ?? null,
          )?.[id]
        : allowed?.[id];
      return !only || only.includes(value);
    }),
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: how a pick reads under the chat input, on the
 * Custom selection row and in Settings › Profiles: the family's name (else the
 * upstream id), the effort the harness offers for that model, and the
 * provider. A part that does not exist is left out.
 */
export function pairSummary(
  model: string | null,
  {
    settings = {},
    defaults = {},
    capability,
    provider,
  }: {
    settings?: Readonly<Record<string, string>> | undefined;
    defaults?: Readonly<Record<string, string>>;
    capability?: HarnessCapability | undefined;
    provider?: string | null | undefined;
  },
): string {
  if (model === null) return "Choose a model";
  const name =
    prettyModelLabel(model) ??
    parseQualifiedModel(model, { claudePrefix: true })?.upstreamId ??
    model;
  const option = sessionSettingOptions(capability).find(
    (o) => o.category === "thought_level" && !o.subagents,
  );
  const value =
    option && (settings[option.id] ?? defaults[option.id] ?? option.default);
  const allowed =
    option &&
    modelConstraintsFor(capability?.harnessConfigCatalog, model)?.[option.id];
  const effort =
    value && (!allowed || allowed.includes(value))
      ? (option?.choices.find((c) => c.value === value)?.name ?? value)
      : null;
  return [
    effort
      ? `${name} · ${effort.charAt(0).toUpperCase()}${effort.slice(1)}`
      : name,
    provider ? `(${provider})` : null,
  ]
    .filter(Boolean)
    .join(" ");
}
