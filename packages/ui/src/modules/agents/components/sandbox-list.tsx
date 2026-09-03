import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import { isDemoAgentId } from "../../packs/hooks/use-is-demo-agent.js";
import type { useAgentRows } from "../hooks/use-agent-rows.js";
import { isKnowledgeBase } from "../utils/agent-kind.js";
import type { TemporarySandboxSplit } from "../utils/temporary-sandboxes.js";
import { AgentRow } from "./agent-row.js";

interface Props {
  agents: AgentView[];
  drawByDriver: TemporarySandboxSplit["drawByDriver"];
  rowProps: ReturnType<typeof useAgentRows>["rowProps"];
  onStop: (agent: AgentView) => void;
  onDelete: (agent: AgentView) => void;
}

export function SandboxList({
  agents,
  drawByDriver,
  rowProps,
  onStop,
  onDelete,
}: Props) {
  const selectAgent = useStore((s) => s.selectAgent);
  const openKnowledgeBase = useStore((s) => s.openKnowledgeBase);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  return (
    <div className="flex flex-col gap-3">
      {agents.map((agent) => (
        <AgentRow
          key={agent.id}
          {...rowProps(agent)}
          isDemo={isDemoAgentId(agent.id)}
          temporaryDraw={drawByDriver.get(agent.id)}
          onSelect={() =>
            isKnowledgeBase(agent)
              ? openKnowledgeBase(agent.id)
              : selectAgent(agent.id)
          }
          onConfigure={() => navigateToSandboxHome(agent.id)}
          configureLabel="Configure agent"
          onStop={() => onStop(agent)}
          onDelete={() => onDelete(agent)}
        />
      ))}
    </div>
  );
}
