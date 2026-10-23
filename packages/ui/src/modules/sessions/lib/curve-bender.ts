import type { HarnessCatalogView } from "agent-runtime-api";
import {
  aliasForProviderType,
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  CURVE_BENDER_WORK_MODEL,
  formatQualifiedModel,
  preferredModelOf,
} from "api-server-api";

import type { ProviderConnectionRef } from "./session-pair-options.js";

export const CURVE_BENDER_ALIAS = aliasForProviderType("curve-bender");

export function sharedCurveBender(
  connections: readonly ProviderConnectionRef[],
): ProviderConnectionRef | undefined {
  return connections.find(
    (c) => c.templateId === CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  );
}

export function curveBenderModelName(
  catalog: HarnessCatalogView | undefined,
  connectionId: string,
): string {
  const listed =
    catalog?.providers.find((p) => p.connectionId === connectionId)?.models ??
    [];
  const preferred = preferredModelOf("work", [
    { alias: CURVE_BENDER_ALIAS, listed: listed.map((m) => m.upstreamId) },
  ]);
  const hit = preferred
    ? listed.find((m) => m.upstreamId === preferred.upstreamId)
    : undefined;
  return (
    hit?.name ??
    formatQualifiedModel(CURVE_BENDER_ALIAS, CURVE_BENDER_WORK_MODEL)
  );
}

export function curveBenderProvider(
  connections: readonly ProviderConnectionRef[],
): ProviderConnectionRef | undefined {
  return connections.find((c) => c.type === "curve-bender");
}
