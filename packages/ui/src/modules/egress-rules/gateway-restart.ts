import {
  gatewayRestartImpact,
  promotedHosts,
  type PromotionRule,
} from "api-server-api";

import type { DialogSlice } from "../platform/store/dialog.js";
import { fetchEgressRulesForAgent } from "./api/queries.js";
import { splitHostPort } from "./host-port.js";

type ShowConfirm = DialogSlice["showConfirm"];

export const GATEWAY_RESTART_TITLE = "Restart network gateway?";

export interface StagedGatewayRestart {
  promoted: string[];
  demoted: string[];
  reapplied: string[];
  demotedByRemovals: string[];
  willRestart: boolean;
}

export function toPromotionRule(rule: {
  host: string;
  method: string;
  pathPattern: string;
}): PromotionRule {
  return {
    ...splitHostPort(rule.host.trim()),
    method: rule.method,
    pathPattern: rule.pathPattern.trim(),
    source: "manual",
  };
}

export function stagedGatewayRestart(input: {
  current: readonly (PromotionRule & { id: string })[];
  adds?: readonly PromotionRule[];
  removeIds?: readonly string[];
}): StagedGatewayRestart {
  const removeIds = input.removeIds ?? [];
  const afterDeletes = gatewayRestartImpact({
    current: input.current,
    removeIds,
  });
  const afterAll = gatewayRestartImpact({
    current: input.current,
    removeIds,
    adds: input.adds ?? [],
  });
  const stillDemoted = new Set(afterAll.demoted);
  return {
    promoted: afterAll.promoted,
    demoted: afterAll.demoted,
    reapplied: afterDeletes.demoted.filter((h) => !stillDemoted.has(h)),
    demotedByRemovals: afterDeletes.demoted,
    willRestart: afterAll.willRestart || afterDeletes.willRestart,
  };
}

const AGENT_KEEPS_RUNNING =
  "The agent keeps running — its outbound requests are briefly interrupted.";

export function describeGatewayRestart(impact: StagedGatewayRestart): string {
  const clauses = [
    impact.promoted.length > 0 &&
      `start inspecting requests to ${formatHosts(impact.promoted)}`,
    impact.demoted.length > 0 &&
      `stop inspecting requests to ${formatHosts(impact.demoted)}`,
    impact.reapplied.length > 0 &&
      `rebuild request inspection for ${formatHosts(impact.reapplied)}`,
  ].filter((c): c is string => c !== false);
  const rolls =
    impact.promoted.length +
    impact.demoted.length +
    impact.reapplied.length * 2;
  const timing =
    rolls > 1 ? "restarts more than once (~5–15s each)" : "restarts (~5–15s)";
  if (clauses.length === 0) {
    return `The network gateway ${timing}. ${AGENT_KEEPS_RUNNING}`;
  }
  return `The network gateway ${timing} to ${joinClauses(clauses)}. ${AGENT_KEEPS_RUNNING}`;
}

async function confirmGatewayRestart(
  showConfirm: ShowConfirm,
  impact: StagedGatewayRestart | null,
  confirmLabel: string,
): Promise<boolean> {
  if (!impact?.willRestart) return true;
  try {
    return await showConfirm(
      describeGatewayRestart(impact),
      GATEWAY_RESTART_TITLE,
      { confirmLabel },
    );
  } catch {
    return false;
  }
}

export async function confirmStagedGatewayRestart(
  showConfirm: ShowConfirm,
  agentId: string,
  staged: {
    adds?: readonly PromotionRule[];
    removeIds?: readonly string[];
  },
  confirmLabel: string,
): Promise<boolean> {
  const adds = staged.adds ?? [];
  const removeIds = staged.removeIds ?? [];
  if (removeIds.length === 0 && promotedHosts(adds).length === 0) return true;
  try {
    const current = await fetchEgressRulesForAgent(agentId);
    return await confirmGatewayRestart(
      showConfirm,
      stagedGatewayRestart({ current, adds, removeIds }),
      confirmLabel,
    );
  } catch {
    return false;
  }
}

function formatHosts(hosts: readonly string[]): string {
  if (hosts.length <= 2) return hosts.join(" and ");
  return `${hosts.slice(0, -1).join(", ")} and ${hosts[hosts.length - 1]}`;
}

function joinClauses(clauses: readonly string[]): string {
  if (clauses.length <= 2) return clauses.join(", and ");
  return `${clauses.slice(0, -1).join(", ")}, and ${clauses[clauses.length - 1]}`;
}
