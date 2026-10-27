import type {
  OutageAlertAffectedBy,
  ProviderOutageReason,
} from "api-server-api";

export type { OutageAlertAffectedBy };

export type OutageAlertState = "told" | "recovered";

export const RECOVERED_SHOWN_DAYS = 7;

export interface AffectedAgent {
  readonly agentId: string;
  readonly name: string;
  readonly affectedBy: readonly OutageAlertAffectedBy[];
}

export interface OutageAlert {
  readonly ownerSub: string;
  readonly templateId: string;
  readonly state: OutageAlertState;
  readonly reason: ProviderOutageReason;
  readonly since: Date;
  readonly toldAt: Date;
  readonly recoveredAt: Date | null;
  readonly agents: readonly AffectedAgent[];
  readonly statusPageUrl: string | null;
}

export interface Outage {
  readonly templateId: string;
  readonly reason: ProviderOutageReason;
  readonly since: Date;
}

export interface Evidence {
  readonly outages: readonly Outage[];
  readonly answering: readonly string[];
  readonly cleared: readonly string[];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: an outage is told only after it lasted the
 * delay, so a short blip sends nothing. An outage that only failed calls show
 * is not told while the fault is on the platform's side, because the provider
 * can be innocent.
 */
export function tellable(
  outage: Outage,
  damSide: boolean,
  checkedAt: Date,
  delayMs: number,
): boolean {
  return (
    checkedAt.getTime() - outage.since.getTime() >= delayMs &&
    !(damSide && outage.reason === "failing-calls")
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the agent list of a told alert once more of the
 * owner's work failed, or null when nothing new failed. The owner was told
 * once, so the list grows without a message, and the card and the recovery
 * message then name every agent to check.
 */
export function grownAgents(
  told: readonly AffectedAgent[],
  found: readonly AffectedAgent[],
): readonly AffectedAgent[] | null {
  const agents = new Map(told.map((agent) => [agent.agentId, agent]));
  let grew = false;
  for (const agent of found) {
    const known = agents.get(agent.agentId);
    const added = agent.affectedBy.filter(
      (reason) => !known?.affectedBy.includes(reason),
    );
    if (known && added.length === 0) continue;
    grew = true;
    agents.set(
      agent.agentId,
      known ? { ...known, affectedBy: [...known.affectedBy, ...added] } : agent,
    );
  }
  return grew
    ? [...agents.values()].sort((a, b) => a.name.localeCompare(b.name))
    : null;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a told alert recovers only on evidence that its
 * template answers again. Provider Status also drops a template that nobody
 * calls, so leaving the outages alone is not enough. A public source that
 * answers again ends only an outage that a public source reported, because a
 * proxy's readiness does not say that its models answer.
 */
export function recovers(
  alert: Pick<OutageAlert, "templateId" | "reason">,
  evidence: Evidence,
): boolean {
  if (evidence.outages.some((o) => o.templateId === alert.templateId))
    return false;
  return (
    evidence.answering.includes(alert.templateId) ||
    (alert.reason !== "failing-calls" &&
      evidence.cleared.includes(alert.templateId))
  );
}
