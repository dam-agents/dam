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
  hasServerAutoMode,
  isClaudeModel,
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
 * would otherwise send its titles, summaries and alias-named subagents to
 * the provider it left.
 * A provider whose models carry no tier word has no tiers to answer with,
 * so there every slot call runs on the session's own model, whichever
 * provider filled the slot.
 * The auto-mode classifier is not one of these calls: its own name is
 * answered first, by classifierModelOnSessionProvider.
 * A call on the session's own provider for a
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: where the auto-mode classifier runs when its
 * session is on another provider: the session provider's preferred classifier,
 * else the session's own model, so a session moved elsewhere follows itself
 * instead of the provider it left. The caller passes only a call Claude Code
 * classes as auxiliary and stamps with no subagent id, since a subagent or a
 * workflow agent naming the same model is work, and it keeps the side-call
 * rule; the call is then recognized by the exact name the process's
 * classifier variable holds, a string match only, and no tier logic applies.
 * Null when the call is not the classifier's. A session on a provider whose
 * own service answers the check keeps the call where the harness sent it,
 * which returning its own name says, so the tier rule below never touches it;
 * that needs the preset flag, a Claude session model and no non-Claude
 * subagent model, the same inputs the process env reads. The name is compared
 * with the catalog as it is when the call arrives, while the process holds the
 * value it read at spawn, so a replaced listing reaches a running process only
 * when it recycles.
 */
export function classifierModelOnSessionProvider(input: {
  requested: string;
  sessionModel: string;
  subagentModel?: string | null;
  harness: string;
  binding: ModelRouterBinding;
  providers: readonly CatalogProvider[];
  processClassifier: string | null;
}): string | null {
  if (!input.processClassifier || input.requested !== input.processClassifier)
    return null;
  const { binding } = input;
  const own = parseQualifiedModel(input.sessionModel, {
    claudePrefix: binding.namePrefix === CLAUDE_MODEL_NAME_PREFIX,
  });
  if (!own) return null;
  if (
    hasServerAutoMode(own.alias) &&
    isClaudeModel(input.sessionModel) &&
    isClaudeModel(input.subagentModel)
  )
    return input.requested;
  const provider = input.providers.find((p) => p.alias === own.alias);
  const ownView = provider
    ? forHarness(provider.entries, input.harness, binding)
    : [];
  const classifier = preferredModelOf("classifier", [
    { alias: own.alias, listed: ownView.map((e) => e.upstreamId) },
  ]);
  const entry = ownView.find((e) => e.upstreamId === classifier?.upstreamId);
  return entry ? renderName(entry, binding) : renderName(own, binding);
}
