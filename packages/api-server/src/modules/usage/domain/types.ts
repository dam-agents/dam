// Business policy: how long activity_events rows are retained before
// the weekly retention job deletes them.
export const ACTIVITY_RETENTION_DAYS = 180;

export type ActivityEventRow = {
  type: string;
  actorSub: string | null;
  agentId: string | null;
  surface: string | null;
  outcome: "success" | "failure";
  payload: Record<string, unknown>;
};

export type AgentRegistryRow = {
  id: string;
  ownerSub: string;
};
