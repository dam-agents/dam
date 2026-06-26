import { useMemo } from "react";

import type { AgentState } from "../../../types.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { useTemplates } from "../../templates/api/queries.js";

export interface AgentLabel {
  name: string;
  /** Harness-image name, resolved from the agent's template; null for a custom
   *  image or an unknown template. */
  templateName: string | null;
  state: AgentState;
}

/** Map an arm's `agentId` to a human label (agent name + harness image). Arms
 *  store only the agent id; the list/detail/wizard all need the name and image
 *  to identify a competitor, so resolve it once here. */
export function useAgentLabels(): Map<string, AgentLabel> {
  const agents = useAgentsList();
  const { data: templates } = useTemplates();
  return useMemo(() => {
    const templateName = new Map(templates?.map((t) => [t.id, t.name]) ?? []);
    const map = new Map<string, AgentLabel>();
    for (const agent of agents) {
      map.set(agent.id, {
        name: agent.name,
        templateName: agent.templateId
          ? (templateName.get(agent.templateId) ?? null)
          : null,
        state: agent.state,
      });
    }
    return map;
  }, [agents, templates]);
}
