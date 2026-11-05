import { claudeTierOf, newestOfTier, tierWordOf } from "agent-runtime-api";

import {
  convertedDefaultModel,
  declaredModelOf,
} from "./default-conversion.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the conversion's order, most certain first. A
 * model the Agent's kit declares is what the Agent was created for, so it
 * answers before any substitution. Then the one substitution: a Haiku setting
 * on a provider that lists no Haiku ran on that provider's Sonnet before the
 * Model Router (the gateway serves Haiku requests on it), so it becomes the
 * provider's newest Sonnet, noted so the owner is told — not the platform's
 * preferred model, which would be a tier nobody asked for. Everything else
 * converts as convertedDefaultModel says or not at all. A default that lands
 * on a model of another tier than the setting named carries that tier word as
 * `changedFrom`, so the owner is told which model the runs it pays for
 * replaced: always for the Haiku substitution, and for a tier word no fitting
 * provider could answer only where the Agent's calls ran that tier, since a
 * tier an image presets and nobody ever ran was never a choice of its owner's.
 */
export function convertedDefault(
  input: Parameters<typeof convertedDefaultModel>[0],
): { model: string; changedFrom?: string } | null {
  const declared = declaredModelOf(input);
  if (declared) return { model: declared };
  const one = input.providers.length === 1 ? input.providers[0] : undefined;
  const haiku =
    one &&
    input.setting &&
    claudeTierOf(input.setting) === "haiku" &&
    !newestOfTier(one.listed, "haiku")
      ? newestOfTier(one.listed, "sonnet")
      : null;
  if (haiku) return { model: `${one!.alias}/${haiku}`, changedFrom: "haiku" };
  const model = convertedDefaultModel(input);
  if (!model) return null;
  const tier = claudeTierOf(input.setting ?? "");
  const ran = tier !== null && input.ran.some((id) => tierWordOf(id) === tier);
  return ran && tierWordOf(model) !== tier
    ? { model, changedFrom: tier }
    : { model };
}
