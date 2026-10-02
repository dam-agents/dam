import { api } from "@/api";
import type { AgentView, TemplateView } from "@/types";

/** One agent from the fake backend's `agents.list`. */
export async function loadAgent(id: string): Promise<AgentView> {
  const list = await api.agents.list.query();
  const agent = list.find((a) => a.id === id);
  if (!agent) throw new Error(`fixture agent ${id} missing`);
  return agent;
}

/** The install's harness catalogue, as `templates.list` serves it. */
export async function loadTemplates(): Promise<TemplateView[]> {
  return api.templates.list.query();
}
