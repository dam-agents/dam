import { useMemo, useState } from "react";

import type { AgentView } from "../../../types.js";
import { useAgents, useAgentsList } from "../api/queries.js";
import { useCreateDefaultAgent } from "./use-create-default-agent.js";

interface InlineAgentCreate {
  isLoading: boolean;
  displayedAgents: readonly AgentView[];
  creating: boolean;
  canCreate: boolean;
  create: () => Promise<AgentView | undefined>;
}

export function useInlineAgentCreate(): InlineAgentCreate {
  const agents = useAgents();
  const list = useAgentsList();
  const defaultAgent = useCreateDefaultAgent();
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<AgentView | null>(null);

  const displayedAgents = useMemo(() => {
    if (!justCreated || list.some((a) => a.id === justCreated.id)) return list;
    return [...list, justCreated];
  }, [list, justCreated]);

  const create = async () => {
    setCreating(true);
    const agent = await defaultAgent.create({ navigate: false });
    setCreating(false);
    if (agent) setJustCreated(agent);
    return agent;
  };

  return {
    isLoading: agents.isLoading,
    displayedAgents,
    creating,
    canCreate: defaultAgent.ready && !creating,
    create,
  };
}
