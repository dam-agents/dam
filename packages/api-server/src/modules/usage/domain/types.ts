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
