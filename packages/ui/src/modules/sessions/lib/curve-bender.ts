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
 * UNIT_BOUNDARY_DESCRIPTION: which CurveBender notice a chat shows, and to whom:
 * a chat that does not exist yet, on an install whose shared Connection the person
 * holds, once every read behind its pair has answered, so a chat already on
 * CurveBender never flashes the offer to switch to it.
 * The assistant's own chat never shows it, and neither does an account that was
 * onboarded with the assistant: its first chat is already set up on CurveBender,
 * so a notice there tells the person about a world they never had.
 */
export function curveBenderNotice({
  sessionId,
  shared,
  pair,
  pairSettled,
  agentId,
  assistant,
  assistantKnown,
}: {
  sessionId: string | null;
  shared: ProviderConnectionRef | undefined;
  pair: SessionPair | null;
  pairSettled: boolean;
  /* UNIT_BOUNDARY_DESCRIPTION: the chat's Agent. */
  agentId: string | null;
  /* UNIT_BOUNDARY_DESCRIPTION: the assistant record — which Agent it is, and whether the account had an Agent of its own before the platform gave it this one — or null for a person who has none. */
  assistant: { agentId: string; legacy: boolean } | null;
  /* UNIT_BOUNDARY_DESCRIPTION: whether that record has been read. An unread or failed read shows nothing, rather than the notice appearing and then vanishing, or staying up for a person it does not belong to. */
  assistantKnown: boolean;
}): "setup" | "offer" | null {
  if (sessionId !== null || !shared || !pairSettled) return null;
  if (!assistantKnown) return null;
  if (assistant !== null) {
    if (agentId === assistant.agentId) return null;
    if (!assistant.legacy) return null;
  }
  return pair?.provider === shared.id ? "setup" : "offer";
}
