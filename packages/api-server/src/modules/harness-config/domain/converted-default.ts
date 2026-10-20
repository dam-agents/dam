import { claudeTierOf, newestOfTier } from "agent-runtime-api";

import { convertedDefaultModel } from "./default-conversion.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the one substitution the conversion makes. A
 * Haiku setting on a provider that lists no Haiku ran on that provider's
 * Sonnet before the Model Router (the gateway serves Haiku requests on it),
 * so it becomes the provider's newest Sonnet, noted so the owner is told.
 * Every other setting converts as convertedDefaultModel says or not at all.
 */
export function convertedDefault(
  input: Parameters<typeof convertedDefaultModel>[0],
): { model: string; changedFrom?: string } | null {
  const model = convertedDefaultModel(input);
  if (model) return { model };
  if (!input.setting || claudeTierOf(input.setting) !== "haiku") return null;
  const sonnet = newestOfTier(input.listed, "sonnet");
  return sonnet
    ? { model: `${input.alias}/${sonnet}`, changedFrom: "haiku" }
    : null;
}
