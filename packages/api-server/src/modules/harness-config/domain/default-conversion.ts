import { claudeTierOf, newestOfTier } from "agent-runtime-api";
import { preferredModelOf, type ProviderListing } from "api-server-api";

const plain = (name: string, alias: string): string =>
  name
    .trim()
    .replace(/^claude\//i, "")
    .replace(/\[1m\]$/i, "")
    .replace(new RegExp(`^${alias}/`, "i"), "")
    .toLowerCase();

/**
 * UNIT_BOUNDARY_DESCRIPTION: a model name against one provider's listing, for
 * the spellings that differ from it: the provider's own name for the model,
 * else the one listed id ending in the name, since a kit names a model the
 * same way whatever provider serves it (`claude-opus-5` for IBM's
 * `aws/claude-opus-5`) and Claude Code records a call's model without IBM's
 * route prefix. Null when the provider lists neither, or when two routes end
 * in the name and neither is the one meant.
 */
function finder(alias: string, listed: readonly string[]) {
  const listedAs = (name: string) =>
    listed.find((id) => id.toLowerCase() === plain(name, alias));
  const endingIn = (name: string) => {
    const exact = listedAs(name);
    if (exact) return exact;
    const tail = listed.filter((id) =>
      id.toLowerCase().endsWith(`/${plain(name, alias)}`),
    );
    return tail.length === 1 ? tail[0] : undefined;
  };
  return { listedAs, endingIn };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model an Agent's kit declares (`defaultModel`),
 * resolved across the providers it holds in alias order, since a kit names a
 * model, not a provider. It is the most specific thing known about the Agent,
 * so it is answered before anything else, and a model no provider lists falls
 * through to the rest of the conversion so that a kit's pin never becomes a
 * call that fails every time.
 */
export function declaredModelOf(input: {
  declared?: string | null;
  providers: readonly ProviderListing[];
}): string | null {
  const declared = input.declared?.trim();
  if (!declared) return null;
  for (const { alias, listed } of input.providers) {
    const hit = finder(alias, listed).endingIn(declared);
    if (hit) return `${alias}/${hit}`;
  }
  return null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model an Agent's saved default becomes when
 * it had none. Three sources, in this order. First what is certain about the
 * Agent: the model its kit declares (`declared`), else the model its calls
 * mostly ran (`ran`, ordered by output tokens, most first) when its harness's
 * setting names nothing, else that setting — a tier word (opus, `opus[1m]`)
 * becomes the provider's newest model carrying exactly that word, never
 * another tier in its place, and a model id is kept when the provider lists
 * it, under that name or as the one listed id ending in it. A model the calls
 * ran less never stands in for it, and a model id no provider lists is the
 * owner's call, never another version's. Only a tier word names nothing on
 * several providers, so only a tier word is left to the next step there; an id
 * the setting or the history names is resolved against each provider in turn,
 * since it names the same model wherever it is. Second the platform's model
 * preference list, across every fitting provider: it fills the gaps the first
 * step leaves — a tier word the provider lists no model of (CurveBender's ids
 * carry no tier word at all), a history whose models it does not list — and it
 * decides an Agent that fits several providers, where the list's order beats
 * the providers' own. Null when neither holds, so the owner picks the default
 * instead of the platform guessing it.
 */
export function convertedDefaultModel(input: {
  setting: string | null;
  providers: readonly ProviderListing[];
  ran: readonly string[];
  declared?: string | null;
}): string | null {
  const declared = declaredModelOf(input);
  if (declared) return declared;
  const preferred = preferredModelOf("work", input.providers);
  const listed = preferred
    ? `${preferred.alias}/${preferred.upstreamId}`
    : null;
  const setting = input.setting?.trim() ?? "";
  const tier = claudeTierOf(setting);
  if (tier) {
    const one = input.providers.length === 1 ? input.providers[0] : undefined;
    const newest = one ? newestOfTier(one.listed, tier) : undefined;
    return newest ? `${one!.alias}/${newest}` : listed;
  }

  const resolved = input.providers
    .map(({ alias, listed: ids }) => {
      const found = finder(alias, ids);
      const [mostly] = input.ran;
      const hit =
        setting === "" || plain(setting, alias) === "default"
          ? mostly === undefined
            ? undefined
            : found.endingIn(mostly)
          : found.listedAs(setting);
      return hit ? `${alias}/${hit}` : null;
    })
    .find((model) => model !== null);
  if (resolved) return resolved;
  const unset = input.providers.some(
    ({ alias }) => setting === "" || plain(setting, alias) === "default",
  );
  return unset ? listed : null;
}
