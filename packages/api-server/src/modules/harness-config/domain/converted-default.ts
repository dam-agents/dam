import { claudeTierOf, newestOfTier } from "agent-runtime-api";

import {
  convertedDefaultModel,
  declaredModelOf,
  type ConvertedModel,
} from "./default-conversion.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the conversion's order, most certain first. A
 * model the Agent's kit declares is what the Agent was created for, so it
 * answers before any substitution. Then the one substitution: a Haiku setting
 * on a provider that lists no Haiku ran on that provider's Sonnet before the
 * Model Router (the gateway serves Haiku requests on it), so it becomes the
 * provider's newest Sonnet, noted so the owner is told — not the platform's
 * preferred model, which would be a tier nobody asked for. Everything else
 * converts as convertedDefaultModel says.
 */
export function convertedDefault(
  input: Parameters<typeof convertedDefaultModel>[0],
): ConvertedModel | null {
  const declared = declaredModelOf(input);
  if (declared) return { model: declared, step: "kit" };
  const one = input.providers.length === 1 ? input.providers[0] : undefined;
  if (
    one &&
    input.setting &&
    claudeTierOf(input.setting) === "haiku" &&
    !newestOfTier(one.listed, "haiku")
  ) {
    const sonnet = newestOfTier(one.listed, "sonnet");
    if (sonnet)
      return {
        model: `${one.alias}/${sonnet}`,
        step: "setting",
        changedFrom: "haiku",
      };
  }
  return convertedDefaultModel(input);
}
