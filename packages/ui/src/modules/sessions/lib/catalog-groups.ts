import type {
  CatalogModelView,
  CatalogProviderView,
  HarnessCatalogView,
} from "agent-runtime-api";
import {
  type AliasedConnection,
  aliasForProviderType,
  type ProviderAliasConflict,
  providerAliasConflict,
  templateIdsForAlias,
} from "api-server-api";

import { prettyModelLabel } from "./model-families.js";
import type { ProviderConnectionRef } from "./session-pair-options.js";

export interface ModelGroup {
  connectionId: string;
  alias: string;
  displayName: string;
  status: CatalogProviderView["status"];
  listedAt: string | null;
  native: boolean;
  /* UNIT_BOUNDARY_DESCRIPTION: granted to the agent; a pick from a provider that is not connects it first. */
  attached: boolean;
  models: CatalogModelView[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: every provider the harness accepts, each with
 * its listing state, so a provider that failed to list shows as such rather
 * than vanishing. The agent's own providers come first, in the catalog's
 * order, so a model several providers offer picks a connected one; with
 * `granted` null (no agent) every provider counts as connected.
 */
export function modelGroups(
  catalog: HarnessCatalogView | undefined,
  granted: readonly string[] | null = null,
): ModelGroup[] {
  return (catalog?.providers ?? [])
    .map((p) => ({
      connectionId: p.connectionId,
      alias: p.alias,
      displayName: p.displayName,
      status: p.status,
      listedAt: p.listedAt,
      native: p.native,
      attached: granted === null || granted.includes(p.connectionId),
      models: p.models,
    }))
    .sort((a, b) => Number(b.attached) - Number(a.attached));
}

export const providerLabel = (group: ModelGroup): string =>
  group.attached ? group.displayName : `${group.displayName} (not connected)`;

/**
 * UNIT_BOUNDARY_DESCRIPTION: one harness process reaches either the Model
 * Router or a native provider, so a model-valued session setting (the
 * subagent model) is offered from the session model's side only. No model
 * runs on the router's default, as the runtime decides, so it is the router
 * side; a model the catalog does not list leaves the side open.
 */
export function sameSideGroups(
  groups: readonly ModelGroup[],
  model: string | null,
): ModelGroup[] {
  if (model === null) return groups.filter((g) => !g.native);
  const own = findModel(groups, model)?.group;
  return own === undefined
    ? [...groups]
    : groups.filter((g) => g.native === own.native);
}

export function modelLabel(model: CatalogModelView): string {
  return model.upstreamId;
}

export function contextLabel(model: CatalogModelView): string | null {
  if (model.contextWindow === null) return null;
  const k = Math.round(model.contextWindow / 1000);
  return k >= 1000 ? `${(k / 1000).toFixed(k % 1000 === 0 ? 0 : 1)}M` : `${k}K`;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the catalog names a model the way its harness
 * sees it (Claude Code's lowercased `claude/…`) while a session stores the
 * plain name, so names compare without that prefix and case.
 */
export function sameModel(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const plain = (n: string) => n.toLowerCase().replace(/^claude\//, "");
  return plain(a) === plain(b);
}

export function findModel(
  groups: readonly ModelGroup[],
  name: string | null,
): { group: ModelGroup; model: CatalogModelView } | null {
  if (name === null) return null;
  for (const group of groups) {
    const model = group.models.find((m) => sameModel(m.name, name));
    if (model) return { group, model };
  }
  return null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the upstream id and the Connection's name, so a
 * reader sees where the next turn goes.
 */
export function modelIndicatorLabel(
  groups: readonly ModelGroup[],
  name: string | null,
): string | null {
  const hit = findModel(groups, name);
  if (hit) return `${modelLabel(hit.model)} (${hit.group.displayName})`;
  return name;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: what the chat shows for the session's model: the
 * family's name for a model the menu recognises, and the upstream id with its
 * provider for one it does not.
 */
export function sessionModelLabel(
  groups: readonly ModelGroup[],
  name: string | null,
): string | null {
  if (name === null) return null;
  const hit = findModel(groups, name);
  return (
    (hit && prettyModelLabel(hit.model.name)) ??
    (hit ? `${modelLabel(hit.model)} (${hit.group.displayName})` : name)
  );
}

export interface AddableProvider {
  connection: ProviderConnectionRef;
  conflict: ProviderAliasConflict | null;
}

const aliased = (p: ProviderConnectionRef): AliasedConnection => ({
  id: p.id,
  name: p.name,
  templateId:
    p.templateId ?? templateIdsForAlias(aliasForProviderType(p.type))[0]!,
});

/**
 * UNIT_BOUNDARY_DESCRIPTION: each addable provider carries the alias conflict
 * that would refuse attaching it, so the picker shows the reason instead of
 * an attach that fails.
 */
export function addableProviders(
  granted: readonly ProviderConnectionRef[],
  owned: readonly ProviderConnectionRef[],
  fits: (connection: ProviderConnectionRef) => boolean,
): AddableProvider[] {
  const held = new Set(granted.map((c) => c.id));
  const grantedAliased = granted.map(aliased);
  return owned
    .filter((c) => !held.has(c.id) && fits(c))
    .map((connection) => ({
      connection,
      conflict: providerAliasConflict(grantedAliased, aliased(connection)),
    }));
}

export function attachableProviders(
  granted: readonly ProviderConnectionRef[],
  candidates: readonly ProviderConnectionRef[],
): ProviderConnectionRef[] {
  return addableProviders(granted, candidates, () => true)
    .filter((a) => a.conflict === null)
    .map((a) => a.connection);
}
