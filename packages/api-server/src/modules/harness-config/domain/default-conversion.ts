import { chatModels, claudeTierOf, newestOfTier } from "agent-runtime-api";
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

/** UNIT_BOUNDARY_DESCRIPTION: the source that decided a converted default, named in the conversion's log line. */
export type ConversionStep =
  | "kit"
  | "setting"
  | "history"
  | "preferred"
  | "provider-default"
  | "first-listed";

export interface ConvertedModel {
  model: string;
  step: ConversionStep;
  changedFrom?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model a provider's own service runs when it
 * is asked for none, for a provider whose models the platform's preference
 * list names none of: Bob lists only its own names (`premium`, `fast`, …).
 */
const PROVIDER_DEFAULTS: Readonly<Record<string, string>> = { bob: "premium" };

/**
 * UNIT_BOUNDARY_DESCRIPTION: providers whose calls before the Model Router
 * left no per-call records, so a history read for them is empty or partial
 * and says nothing about the model the agent ran.
 */
const WITHOUT_HISTORY: ReadonlySet<string> = new Set(["bob"]);

/**
 * UNIT_BOUNDARY_DESCRIPTION: the model an Agent's saved default becomes when
 * it had none, and which source decided it. First what is certain about the
 * Agent: the model its kit declares (`declared`), else the model its calls
 * mostly ran (`ran`, ordered by output tokens, most first) when its harness's
 * setting names nothing, else that setting — a tier word (opus, `opus[1m]`)
 * becomes the provider's newest model carrying exactly that word, and a model
 * id is kept when the provider lists it, under that name or as the one listed
 * id ending in it (`claude-sonnet-4-6` for IBM's `aws/claude-sonnet-4-6`). A
 * model the calls ran less never stands in for the one they mostly ran. Only a
 * tier word names nothing on several providers, so only a tier word skips the
 * first step there; an id the setting or the history names is resolved
 * against each provider in turn, since it names the same model wherever it
 * is. What the first step leaves open falls back, so an Agent that holds a
 * provider listing a model always gets one: the platform's model preference
 * list across every fitting provider, whose order beats the providers' own;
 * then a provider's own default (Bob's `premium`); then the first chat model a
 * provider lists. A model id the setting named and no provider lists is noted
 * as what the fallback replaced, so the owner is told; a tier word is the
 * image's preset (Claude Code's `opus`) rather than the owner's pick, so a new
 * Agent on CurveBender is not told about it. Null only when no provider lists
 * a chat model, which saves the default as not set.
 */
export function convertedDefaultModel(input: {
  setting: string | null;
  providers: readonly ProviderListing[];
  ran: readonly string[];
  declared?: string | null;
}): ConvertedModel | null {
  const declared = declaredModelOf(input);
  if (declared) return { model: declared, step: "kit" };
  const setting = input.setting?.trim() ?? "";
  const unset = (alias: string) =>
    setting === "" || plain(setting, alias) === "default";
  const tier = claudeTierOf(setting);
  if (tier) {
    const one = input.providers.length === 1 ? input.providers[0] : undefined;
    const newest = one ? newestOfTier(one.listed, tier) : undefined;
    if (newest) return { model: `${one!.alias}/${newest}`, step: "setting" };
  } else {
    const [mostly] = input.ran;
    const resolved = input.providers
      .map(({ alias, listed }): ConvertedModel | null => {
        const { endingIn } = finder(alias, listed);
        if (!unset(alias)) {
          const hit = endingIn(setting);
          return hit ? { model: `${alias}/${hit}`, step: "setting" } : null;
        }
        if (mostly === undefined || WITHOUT_HISTORY.has(alias)) return null;
        const hit = endingIn(mostly);
        return hit ? { model: `${alias}/${hit}`, step: "history" } : null;
      })
      .find((model) => model !== null);
    if (resolved) return resolved;
  }
  const fallback = fallbackModelOf(input.providers);
  const named = !tier && !input.providers.some(({ alias }) => unset(alias));
  return fallback && named ? { ...fallback, changedFrom: setting } : fallback;
}

function fallbackModelOf(
  providers: readonly ProviderListing[],
): ConvertedModel | null {
  const preferred = preferredModelOf("work", providers);
  if (preferred)
    return {
      model: `${preferred.alias}/${preferred.upstreamId}`,
      step: "preferred",
    };
  for (const { alias, listed } of providers) {
    const own = PROVIDER_DEFAULTS[alias];
    const hit = own ? finder(alias, listed).listedAs(own) : undefined;
    if (hit) return { model: `${alias}/${hit}`, step: "provider-default" };
  }
  for (const { alias, listed } of providers) {
    const [first] = chatModels(listed);
    if (first) return { model: `${alias}/${first}`, step: "first-listed" };
  }
  return null;
}
