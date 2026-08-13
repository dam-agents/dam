import { useEffect, useMemo, useRef, useState } from "react";

import type { AgentView } from "../../../types.js";
import { useAgents, useAgentsList } from "../api/queries.js";

export interface InlineAgentCreate {
  isLoading: boolean;
  displayedAgents: readonly AgentView[];
  justCreatedId: string | null;
  creating: boolean;
  openCreateForm: () => void;
  markCreated: (agent: AgentView) => void;
}

export function useInlineAgentCreate(): InlineAgentCreate {
  const agents = useAgents();
  const list = useAgentsList();
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<AgentView | null>(null);

  const displayedAgents = useMemo(() => {
    if (!justCreated || list.some((a) => a.id === justCreated.id)) return list;
    return [...list, justCreated];
  }, [list, justCreated]);

  const seededCreate = useRef(false);
  useEffect(() => {
    if (seededCreate.current || agents.isLoading) return;
    seededCreate.current = true;
    if (list.length === 0) setCreating(true);
  }, [agents.isLoading, list.length]);

  const markCreated = (agent: AgentView) => {
    setJustCreated(agent);
    setCreating(false);
  };

  return {
    isLoading: agents.isLoading,
    displayedAgents,
    justCreatedId: justCreated?.id ?? null,
    creating,
    openCreateForm: () => setCreating(true),
    markCreated,
  };
}
