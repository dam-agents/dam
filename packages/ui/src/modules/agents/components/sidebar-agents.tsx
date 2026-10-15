import { Add, NewTab, Tools } from "@carbon/icons-react";
import type { ReactNode } from "react";

import { Collapse } from "@/components/ui/collapse";
import { SectionLabel } from "@/components/ui/section-label";
import { Tooltip } from "@/components/ui/tooltip";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { SessionFilterMenu } from "../../sessions/components/session-filter-menu.js";
import { SidebarAgentSessions } from "../../sessions/components/sidebar-agent-sessions.js";
import { useStartSession } from "../../sessions/hooks/use-start-session.js";
import { useCreateDefaultAgent } from "../hooks/use-create-default-agent.js";
import { useSidebarAgents } from "../hooks/use-sidebar-agents.js";
import { SidebarAgentRow } from "./sidebar-agent-row.js";

export function SidebarAgents({ onNavigate }: { onNavigate?: () => void }) {
  const { active, folded, openAgentId, unreadAgentIds } = useSidebarAgents();
  const selectAgent = useStore((s) => s.selectAgent);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const showFolded = useStore((s) => s.sidebarShowHibernating);
  const setShowFolded = useStore((s) => s.setSidebarShowHibernating);
  const startSession = useStartSession();

  const navigate = (go: () => void) => () => {
    go();
    onNavigate?.();
  };

  const row = (agent: AgentView) => {
    const open = agent.id === openAgentId;
    return (
      <SidebarAgentRow
        key={agent.id}
        agent={agent}
        selected={open}
        unread={unreadAgentIds.has(agent.id)}
        onSelect={() => {
          if (!open) selectAgent(agent.id);
        }}
        actions={
          <>
            <RowIconButton
              label="New session"
              onClick={navigate(() => startSession(agent.id))}
            >
              <NewTab size={14} />
            </RowIconButton>
            {open && <SessionFilterMenu />}
            <RowIconButton
              label="Configure agent"
              onClick={navigate(() => navigateToSandboxHome(agent.id))}
            >
              <Tools size={14} />
            </RowIconButton>
          </>
        }
      >
        <Collapse open={open}>
          <SidebarAgentSessions agentId={agent.id} onNavigate={onNavigate} />
        </Collapse>
      </SidebarAgentRow>
    );
  };

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

function RowIconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
      >
        {children}
      </button>
    </Tooltip>
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
