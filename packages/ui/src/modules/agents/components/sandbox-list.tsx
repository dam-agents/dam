import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import type { useAgentRows } from "../hooks/use-agent-rows.js";
import type { TemporarySandboxSplit } from "../utils/temporary-sandboxes.js";
import { AgentRow } from "./agent-row.js";

interface Props {
  agents: AgentView[];
  drawByDriver: TemporarySandboxSplit["drawByDriver"];
  rowProps: ReturnType<typeof useAgentRows>["rowProps"];
  workingByAgent?: ReadonlyMap<string, boolean>;
}

export function SandboxList({
  agents,
  drawByDriver,
  rowProps,
  workingByAgent,
}: Props) {
  const selectAgent = useStore((s) => s.selectAgent);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);

  return (
    <div className="flex flex-col gap-3">
      {agents.map((agent) => (
        <AgentRow
          key={agent.id}
          {...rowProps(agent)}
          working={workingByAgent?.get(agent.id)}
          temporaryDraw={drawByDriver.get(agent.id)}
          onSelect={() => selectAgent(agent.id)}
          onConfigure={() => navigateToSandboxHome(agent.id)}
          configureLabel="Configure agent"
        />
      ))}
    </div>
  );
}
