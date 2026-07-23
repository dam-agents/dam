import { useEffect, useMemo, useRef, useState } from "react";

import type { AgentView } from "../../../types.js";
import { useAgents, useAgentsList } from "../api/queries.js";

export interface InlineAgentCreate {
  /** True until the agents list has loaded for the first time. */
  isLoading: boolean;
  /** The agents list, with a just-created agent bridged in until the
   *  refetched server list includes it. */
  displayedAgents: readonly AgentView[];
  /** Id of an agent created on this page, for highlighting; null if none. */
  justCreatedId: string | null;
  /** Whether the inline create form is open. */
  creating: boolean;
  /** Open the create form (the "＋ Create a new agent" affordance). */
  openCreateForm: () => void;
  /** Record a freshly created agent and collapse the form. */
  markCreated: (agent: AgentView) => void;
}

/**
 * Orchestration shared by the Slack and Telegram bind pickers. It bridges the
 * create→refetch gap — a just-created agent shows in the picker immediately,
 * before the invalidated list query has refetched — and opens the create form
 * by default when the user owns no agents, keeping it mounted across an
 * out-of-band list change so in-progress input is never discarded.
 */
export function useInlineAgentCreate(): InlineAgentCreate {
  const agents = useAgents();
  const list = useAgentsList();
  const [creating, setCreating] = useState(false);
  const [justCreated, setJustCreated] = useState<AgentView | null>(null);

  // The server list is authoritative once it includes the agent.
  const displayedAgents = useMemo(() => {
    if (!justCreated || list.some((a) => a.id === justCreated.id)) return list;
    return [...list, justCreated];
  }, [list, justCreated]);

  // Seeded once, after the first load. A ref (not state) so an out-of-band
  // 0→N list change can never re-open a form the user has since closed.
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
