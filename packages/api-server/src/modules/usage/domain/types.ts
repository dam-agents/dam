export const ACTIVITY_RETENTION_DAYS = 180;

export type ActivityEventRow = {
  type: string;
  actorSub: string | null;
  agentId: string | null;
  surface: string | null;
  outcome: "success" | "failure";
  payload: Record<string, unknown>;
  externalActorId?: string | null;
  ownerSub?: string | null;
};

export type AgentRegistryRow = {
  id: string;
  ownerSub: string;
};
