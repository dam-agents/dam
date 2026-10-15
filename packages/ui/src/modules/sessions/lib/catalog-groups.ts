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
  PROVIDERS,
  templateIdsForAlias,
} from "api-server-api";

import type { ProviderConnectionRef } from "./session-pair-options.js";

export interface ModelGroup {
  connectionId: string;
  alias: string;
  displayName: string;
  status: CatalogProviderView["status"];
  listedAt: string | null;
  native: boolean;
  models: CatalogModelView[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: every provider the harness accepts, in the
 * catalog's order, each with its listing state, so a provider that failed to
 * list shows as such rather than vanishing. A granted provider the pod has
 * not received yet follows them, never listed, so an attach never makes it
 * disappear.
 */
export function modelGroups(
  catalog: HarnessCatalogView | undefined,
  granted: readonly ProviderConnectionRef[] = [],
): ModelGroup[] {
  const groups = (catalog?.providers ?? []).map((p) => ({
    connectionId: p.connectionId,
    alias: p.alias,
    displayName: p.displayName,
    status: p.status,
    listedAt: p.listedAt,
    native: p.native,
    models: p.models,
  }));
  if (!catalog) return groups;
  const held = new Set(groups.map((g) => g.connectionId));
  return [
    ...groups,
    ...granted
      .filter((c) => !held.has(c.id))
      .map((c) => ({
        connectionId: c.id,
        alias: aliasForProviderType(c.type),
        displayName: PROVIDERS[c.type].displayName,
        status: "unavailable" as const,
        listedAt: null,
        native: false,
        models: [],
      })),
  ];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a granted provider missing from the catalog has
 * not reached the pod yet, a revoked one still listed has not left it yet,
 * and an unavailable one has not listed yet; either way the UI asks again.
 */
export function catalogSettled(
  catalog: HarnessCatalogView | undefined,
  grantedIds: readonly string[],
): boolean {
  if (!catalog) return false;
  const held = new Set(catalog.providers.map((p) => p.connectionId));
  const granted = new Set(grantedIds);
  return (
    grantedIds.every((id) => held.has(id)) &&
    catalog.providers.every(
      (p) => granted.has(p.connectionId) && p.status !== "unavailable",
    )
  );
}

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
