import { claudeTierOf, newestOfTier } from "agent-runtime-api";

const plain = (name: string, alias: string): string =>
  name
    .trim()
    .replace(/^claude\//i, "")
    .replace(/\[1m\]$/i, "")
    .replace(new RegExp(`^${alias}/`, "i"), "")
    .toLowerCase();

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model an Agent's saved default becomes when
 * it had none, from what is certain about the Agent before the Model Router:
 * the model setting its harness was left with, on its one provider. A tier
 * word (opus, `opus[1m]`) is that provider's newest model carrying exactly
 * that word, never another tier in its place; a model id is kept when the
 * provider lists it; the harness's own default is the model the Agent's calls
 * mostly ran, when the provider lists it, under that name or as the one
 * listed id ending in it (Claude Code records `claude-opus-4-8` for IBM's
 * `aws/claude-opus-4-8`). Null when none of these holds, so
 * the owner picks the default instead of the platform guessing it.
 */
export function convertedDefaultModel(input: {
  setting: string | null;
  alias: string;
  listed: readonly string[];
  ran: readonly string[];
}): string | null {
  const { alias, listed } = input;
  const qualified = (upstreamId: string) => `${alias}/${upstreamId}`;
  const listedAs = (name: string) =>
    listed.find((id) => id.toLowerCase() === plain(name, alias));
  const setting = input.setting?.trim() ?? "";
  const ranAs = (name: string) => {
    const exact = listedAs(name);
    if (exact) return exact;
    const tail = listed.filter((id) =>
      id.toLowerCase().endsWith(`/${plain(name, alias)}`),
    );
    return tail.length === 1 ? tail[0] : undefined;
  };
  if (setting === "" || plain(setting, alias) === "default") {
    for (const name of input.ran) {
      const hit = ranAs(name);
      if (hit) return qualified(hit);
    }
    return null;
  }
  const tier = claudeTierOf(setting);
  if (tier) {
    const newest = newestOfTier(listed, tier);
    return newest ? qualified(newest) : null;
  }
  const hit = listedAs(setting);
  return hit ? qualified(hit) : null;
}
