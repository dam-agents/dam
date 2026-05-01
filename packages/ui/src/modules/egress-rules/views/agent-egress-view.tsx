import { ArrowLeft } from "lucide-react";
import { useMemo } from "react";

import { useStore } from "../../../store.js";
import { useAgents } from "../../agents/api/queries.js";
import { AgentEgressEditor } from "../components/agent-egress-editor.js";

/**
 * Standalone page for the per-agent egress rules editor — kept as a deep-
 * link target from the inbox's "Customize…" action. The same editor
 * component renders inside the agent configure dialog as a tab.
 */
export function AgentEgressView() {
  const agentId = useStore((s) => s.agentId);
  const setView = useStore((s) => s.setView);
  const { data: agents = [] } = useAgents();

  const agent = useMemo(
    () => agents.find((a) => a.id === agentId) ?? null,
    [agents, agentId],
  );

  if (!agentId) {
    return (
      <div className="flex flex-col gap-3">
        <BackLink onClick={() => setView("list")} />
        <p className="text-[12px] text-text-muted">Missing agent id.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <BackLink onClick={() => setView("list")} />
      <div className="flex items-baseline justify-between">
        <h1 className="text-[20px] font-extrabold tracking-[-0.02em] text-text">
          Network access
        </h1>
        <span className="text-[11px] text-text-muted">
          {agent ? agent.name : agentId}
        </span>
      </div>
      <AgentEgressEditor agentId={agentId} />
    </div>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="self-start inline-flex items-center gap-1 text-[11px] text-text-muted hover:text-text transition-colors"
    >
      <ArrowLeft size={11} /> Back to agents
    </button>
  );
}
