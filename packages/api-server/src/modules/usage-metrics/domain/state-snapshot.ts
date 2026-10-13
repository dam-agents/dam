import type { HarnessOf } from "./harness.js";

export const AGENT_ORIGINS = ["starter_kit", "blank", "invocation"] as const;

export type AgentOrigin = (typeof AGENT_ORIGINS)[number];

export const SLACK_CREDENTIAL_STATES = ["active", "rejected"] as const;

export type SlackCredentialState = (typeof SLACK_CREDENTIAL_STATES)[number];

export interface LiveAgentRow {
  id: string;
  starterKit: string | null;
  spawnedByAgentId: string | null;
}

export interface StateCountsReader {
  liveAgents(): Promise<LiveAgentRow[]>;
  slackWorkspacesByState(): Promise<
    { state: SlackCredentialState; count: number }[]
  >;
  activeKbShares(): Promise<number>;
  skillSets(): Promise<number>;
}

export interface AgentCount {
  harness: string;
  origin: AgentOrigin;
  count: number;
}

export interface StateSnapshot {
  agents: AgentCount[];
  slackWorkspaces: { state: SlackCredentialState; count: number }[];
  sharedKnowledgeBases: number;
  skillSets: number;
}

export function agentOrigin(row: LiveAgentRow): AgentOrigin {
  if (row.spawnedByAgentId !== null) return "invocation";
  return row.starterKit !== null ? "starter_kit" : "blank";
}

export function countAgents(
  rows: readonly LiveAgentRow[],
  harnessOf: HarnessOf,
  harnesses: Iterable<string>,
): AgentCount[] {
  const counts = new Map<string, AgentCount>();
  const keyOf = (harness: string, origin: AgentOrigin) =>
    `${harness}\0${origin}`;
  for (const harness of harnesses)
    for (const origin of AGENT_ORIGINS)
      counts.set(keyOf(harness, origin), { harness, origin, count: 0 });
  for (const row of rows) {
    const harness = harnessOf(row.id);
    const origin = agentOrigin(row);
    const entry = counts.get(keyOf(harness, origin));
    if (entry) entry.count++;
    else counts.set(keyOf(harness, origin), { harness, origin, count: 1 });
  }
  return [...counts.values()];
}

export function countSlackWorkspaces(
  rows: readonly { state: SlackCredentialState; count: number }[],
): { state: SlackCredentialState; count: number }[] {
  return SLACK_CREDENTIAL_STATES.map((state) => ({
    state,
    count: rows.find((r) => r.state === state)?.count ?? 0,
  }));
}
