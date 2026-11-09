import type { HarnessCatalogView } from "agent-runtime-api";
import {
  aliasForProviderType,
  CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID,
  CURVE_BENDER_WORK_MODEL,
  formatQualifiedModel,
  preferredModelOf,
  type SessionPair,
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

/**
 * UNIT_BOUNDARY_DESCRIPTION: which CurveBender notice a chat shows, and to
 * whom: a chat that does not exist yet, on an install whose shared Connection
 * the person holds, once every read behind its pair has answered, so a chat
 * already on CurveBender never flashes the offer to switch to it.
 */
export function curveBenderNotice({
  sessionId,
  shared,
  pair,
  pairSettled,
}: {
  sessionId: string | null;
  shared: ProviderConnectionRef | undefined;
  pair: SessionPair | null;
  pairSettled: boolean;
}): "setup" | "offer" | null {
  if (sessionId !== null || !shared || !pairSettled) return null;
  return pair?.provider === shared.id ? "setup" : "offer";
}
