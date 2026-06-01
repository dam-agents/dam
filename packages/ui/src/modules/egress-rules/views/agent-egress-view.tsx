import { ArrowLeft } from "@carbon/icons-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";

import { useStore } from "../../../store.js";
import { useAgentsList } from "../../agents/api/queries.js";
import { AgentEgressEditor } from "../components/agent-egress-editor.js";

/**
 * Standalone page for the per-agent egress rules editor — kept as a deep-
 * link target from the inbox's "Customize…" action. The same editor
 * component renders inside the agent configure dialog as a tab.
 */
export function AgentEgressView() {
  const agentId = useStore((s) => s.agentId);
  const setView = useStore((s) => s.setView);
  const agents = useAgentsList();

  const agent = useMemo(
    () => agents.find((a) => a.id === agentId) ?? null,
    [agents, agentId],
  );

  if (!agentId) {
    return (
      <div className="flex flex-col gap-3">
        <BackLink onClick={() => setView("list")} />
        <p className="text-[12px] text-muted-foreground">Missing agent id.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BackLink onClick={() => setView("list")} />
      <div className="flex items-baseline justify-between">
        <h1 className="text-[20px] font-extrabold tracking-[-0.02em] text-foreground">
          Network access
        </h1>
        <span className="text-[11px] text-muted-foreground">
          {agent ? agent.name : agentId}
        </span>
      </div>
      <AgentEgressEditor agentId={agentId} />
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      className="self-start h-auto px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft size={11} /> Back to agents
    </Button>
  );
}
