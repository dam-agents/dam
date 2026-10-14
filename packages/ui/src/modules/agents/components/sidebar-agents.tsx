import { Add } from "@carbon/icons-react";

import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { useCreateDefaultAgent } from "../hooks/use-create-default-agent.js";
import { useSidebarAgents } from "../hooks/use-sidebar-agents.js";
import { SidebarAgentRow } from "./sidebar-agent-row.js";

export function SidebarAgents({ onNavigate }: { onNavigate?: () => void }) {
  const { active, folded, openAgentId, unreadAgentIds, workingByAgent } =
    useSidebarAgents();
  const selectAgent = useStore((s) => s.selectAgent);
  const showFolded = useStore((s) => s.sidebarShowHibernating);
  const setShowFolded = useStore((s) => s.setSidebarShowHibernating);

  const row = (agent: AgentView) => (
    <SidebarAgentRow
      key={agent.id}
      agent={agent}
      selected={agent.id === openAgentId}
      unread={unreadAgentIds.has(agent.id)}
      working={workingByAgent.get(agent.id) ?? false}
      onSelect={() => {
        selectAgent(agent.id);
        onNavigate?.();
      }}
    />
  );

  return (
    <section aria-label="Agents" data-testid="sidebar-agents">
      <div className="flex items-center justify-between py-1 pl-2.5">
        <SectionLabel>Agents</SectionLabel>
        <CreateAgentButton onCreate={onNavigate} />
      </div>
      <ul className="flex flex-col gap-px">
        {active.map(row)}
        {showFolded && folded.map(row)}
      </ul>
      {folded.length > 0 && (
        <button
          type="button"
          onClick={() => setShowFolded(!showFolded)}
          aria-expanded={showFolded}
          className="mt-px flex h-[30px] w-full items-center rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {showFolded ? "Show less" : `See all (${folded.length} hibernating)`}
        </button>
      )}
    </section>
  );
}

function CreateAgentButton({ onCreate }: { onCreate?: () => void }) {
  const defaultAgent = useCreateDefaultAgent();
  return (
    <Tooltip content="Create agent" side="right">
      <button
        type="button"
        aria-label="Create agent"
        disabled={!defaultAgent.ready}
        onClick={() => {
          void defaultAgent.create();
          onCreate?.();
        }}
        className="flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <Add size={14} />
      </button>
    </Tooltip>
  );
}
