import type {
  HarnessCapability,
  HarnessConfigCurrent,
} from "agent-runtime-api";
import { modelConstraintsFor, SUBAGENT_MODEL_SETTING } from "agent-runtime-api";

import {
  findModel,
  type ModelGroup,
  sameSideGroups,
} from "./catalog-groups.js";

export function sessionSettingOptions(
  capability: HarnessCapability | undefined,
) {
  return (
    capability?.harnessConfigCatalog?.options.filter(
      (o) => o.id !== "model" && capability.sessionSettings?.includes(o.id),
    ) ?? []
  );
}

export function settingDefaults(
  capability: HarnessCapability | undefined,
  configured: HarnessConfigCurrent | null | undefined,
): Record<string, string> {
  return Object.fromEntries(
    sessionSettingOptions(capability)
      .filter((o) => !o.subagents)
      .flatMap((o) => {
        const value =
          (o.id === "mode"
            ? configured?.mode
            : configured?.configOptions[o.id]) ?? o.default;
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
