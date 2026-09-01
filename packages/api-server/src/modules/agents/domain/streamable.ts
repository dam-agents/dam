export interface AgentStreamability {
  ready: boolean;
  stopRequested: boolean;
}

export function agentStreamable(info: AgentStreamability | null): boolean {
  return info !== null && info.ready && !info.stopRequested;
}
