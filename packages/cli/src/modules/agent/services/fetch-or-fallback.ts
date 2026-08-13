import type { AgentView } from "../domain/agent-view.js";
import type { AgentService } from "./agent-service.js";

export async function fetchOrFallback(
  svc: AgentService,
  fallback: AgentView,
  context: string,
): Promise<AgentView> {
  const refreshed = await svc.get(fallback.id);
  if (refreshed.ok && refreshed.value !== null) return refreshed.value;
  process.stderr.write(
    `warning: could not refresh agent "${fallback.name}" ${context}; emitting last-known state\n`,
  );
  return fallback;
}
