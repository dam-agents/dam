import {
  type HarnessCapability,
  type HarnessConfigCatalog,
  isPlatformSubagentSetting,
  modelConstraintsFor,
  PLATFORM_SUBAGENT_PREFIX,
  platformSubagentChoice,
} from "agent-runtime-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the choices the Subagents section offers for
 * platform sub-agents: the chosen harness's own session settings, except
 * model-valued ones and ones for its own subagents, each without the choices
 * a person must approve, since nobody is there to approve them. Picking
 * another harness clears every value the old one held, and a newly picked
 * model drops each value its constraints exclude (Haiku takes no effort),
 * which the spawn would otherwise refuse; an empty value is unset.
 */
export const platformKey = (id: string): string =>
  `${PLATFORM_SUBAGENT_PREFIX}${id}`;

export function platformSubagentOptions(
  capability: HarnessCapability | undefined,
  model: string | undefined,
) {
  const catalog = capability?.harnessConfigCatalog;
  const allowed = modelConstraintsFor(catalog, model);
  return (catalog?.options ?? [])
    .filter(
      (o) =>
        o.category !== "model" &&
        !o.subagents &&
        capability?.sessionSettings?.includes(o.id),
    )
    .map((o) => ({
      ...o,
      choices: o.choices.filter(
        (c) =>
          !c.needsApproval &&
          (!allowed?.[o.id] || allowed[o.id]!.includes(c.value)),
      ),
    }))
    .filter((o) => o.choices.length > 0);
}

export function platformHarnessChange(
  settings: Readonly<Record<string, string>>,
  harness: string,
): Record<string, string> {
  return {
    ...Object.fromEntries(
      Object.keys(settings)
        .filter(isPlatformSubagentSetting)
        .map((id) => [id, ""]),
    ),
    [platformKey("harness")]: harness,
  };
}

export function platformModelChange(
  catalog: HarnessConfigCatalog | undefined,
  settings: Readonly<Record<string, string>>,
  model: string,
): Record<string, string> {
  const choice = platformSubagentChoice(settings);
  const allowed = modelConstraintsFor(catalog, model || null);
  const values = {
    ...(choice?.mode !== undefined && { mode: choice.mode }),
    ...choice?.configOptions,
  };
  return {
    ...Object.fromEntries(
      Object.entries(values)
        .filter(([id, value]) => allowed?.[id] && !allowed[id]!.includes(value))
        .map(([id]) => [platformKey(id), ""]),
    ),
    [platformKey("model")]: model,
  };
}
