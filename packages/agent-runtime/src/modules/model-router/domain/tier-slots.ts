import {
  CLAUDE_TIERS,
  chatModels,
  compareModelVersions,
  newestOfTier,
  tierWordOf,
  type ClaudeTier,
} from "agent-runtime-api";
import {
  CLAUDE_MODEL_NAME_PREFIX,
  parseQualifiedModel,
  preferredModelOf,
} from "api-server-api";
import type { CatalogProvider } from "../../model-catalog/index.js";
import { forHarness, renderName } from "../../model-catalog/index.js";
import type { ModelRouterBinding } from "../../runtime-channel/manifest.js";

export type TierModels = Record<ClaudeTier, string>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Claude Code's tier slots, which its picker and
 * `/model` offer, each filled with the newest model carrying the tier word,
 * so a provider that serves no Claude model still answers every slot with
 * one of its own. A provider whose ids carry no tier word at all has nothing
 * to answer with, and then the platform's preferred model stands in, so that
 * provider's slots name the model the platform means rather than whichever id
 * it happens to list last.
 */
export function tierModels(candidates: readonly string[]): TierModels | null {
  const ids = chatModels(candidates);
  if (ids.length === 0) return null;
  const [fable, opus, sonnet, haiku] = CLAUDE_TIERS.map((t) =>
    newestOfTier(ids, t),
  );
  const tierless = !fable && !opus && !sonnet && !haiku;
  const preferred = tierless
    ? (preferredModelOf("work", [{ alias: "", listed: ids }])?.upstreamId ??
      null)
    : null;
  const fallback =
    preferred ??
    opus ??
    sonnet ??
    haiku ??
    [...ids].sort(compareModelVersions).at(-1)!;
  return {
    fable: fable ?? fallback,
    opus: fallback,
    sonnet: sonnet ?? fallback,
    haiku: haiku ?? sonnet ?? fallback,
  };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the tier a model id stands for when Claude Code
 * asks for it: the slot the id fills on its provider, read from the same
 * slots the process env holds, else the tier word the id carries. The slot
 * comes first because a provider without a Haiku fills its haiku slot with
 * its Sonnet, and a call on that slot still asks for the small tier, which
 * the next provider answers with a Haiku of its own. One id filling several
 * slots names the smallest, since the background calls that use the slots
 * ask for Haiku. An id that fills no slot, one the provider has since
 * replaced, is read by its word. Null for an id that is neither.
 */
function tierOf(
  upstreamId: string,
  slots: TierModels | null,
): ClaudeTier | null {
  const id = upstreamId.toLowerCase();
  const slot = slots
    ? [...CLAUDE_TIERS]
        .reverse()
        .find((tier) => slots[tier].toLowerCase() === id)
    : undefined;
  return slot ?? tierWordOf(id);
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: where a call for one of Claude Code's tier
 * slots runs when its session is on another provider: that provider's model
 * of the same tier, else the session's own model. The slots are filled per
 * process from the agent's default provider, and Claude Code resolves its
 * built-in aliases through them, so a session moved to another provider
 * would otherwise send its titles, summaries, classifier calls and
 * alias-named subagents to the provider it left. The auto-mode classifier
 * asks for Claude Code's own Sonnet by a bare id, which goes the same way
 * when the session's provider lists neither that id nor a deployment of it.
 * A provider whose models carry no tier word has no tiers to answer with,
 * so there every slot call runs on the session's own model, whichever
 * provider filled the slot. The classifier is not one of these calls: Claude
 * Code takes its model from its own knob, which the runtime fills per process
 * (classifierModelEnv), so no Sonnet name is reinterpreted here and a
 * `sonnet`-aliased subagent keeps the slot the person put it on. A call on the session's own provider for a
 * model it no longer lists, a slot the process holds from before a listing
 * change, is read by its tier the same way. Null when the call names a
 * model the session's own provider lists among its tiers, or no tier at
 * all, so the name stands.
 */
export function tierModelOnSessionProvider(input: {
  requested: string;
  sessionModel: string;
  harness: string;
  binding: ModelRouterBinding;
  providers: readonly CatalogProvider[];
}): string | null {
  const { binding } = input;
  const claudePrefix = binding.namePrefix === CLAUDE_MODEL_NAME_PREFIX;
  const asked = parseQualifiedModel(input.requested, { claudePrefix });
  const own = parseQualifiedModel(input.sessionModel, { claudePrefix });
  if (!own) return null;
  const viewOf = (alias: string) => {
    const provider = input.providers.find((p) => p.alias === alias);
    return provider ? forHarness(provider.entries, input.harness, binding) : [];
  };
  const ownView = viewOf(own.alias);
  const ownHasTiers = ownView.some((e) => tierWordOf(e.upstreamId) !== null);
  const toOwnTier = (tier: ClaudeTier): string => {
    if (!ownHasTiers) return renderName(own, binding);
    const ownSlots = tierModels(ownView.map((e) => e.upstreamId));
    const target = ownSlots
      ? ownView.find((e) => e.upstreamId === ownSlots[tier])
      : undefined;
    return renderName(target ?? own, binding);
  };
  if (!asked) {
    const bare = (
      claudePrefix && input.requested.startsWith(CLAUDE_MODEL_NAME_PREFIX)
        ? input.requested.slice(CLAUDE_MODEL_NAME_PREFIX.length)
        : input.requested
    ).toLowerCase();
    const tier = tierWordOf(bare);
    const ownListsBare = ownView.some((e) => {
      const id = e.upstreamId.toLowerCase();
      return id === bare || id.endsWith(`/${bare}`);
    });
    return tier && !ownListsBare ? toOwnTier(tier) : null;
  }
  const sameProvider = asked.alias === own.alias;
  const askedView = sameProvider ? ownView : viewOf(asked.alias);
  const listed = askedView.some(
    (e) => e.upstreamId.toLowerCase() === asked.upstreamId.toLowerCase(),
  );
  if (sameProvider && listed && ownHasTiers) return null;
  const askedSlots = tierModels(askedView.map((e) => e.upstreamId));
  const tier = tierOf(asked.upstreamId, askedSlots);
  return tier ? toOwnTier(tier) : null;
}
