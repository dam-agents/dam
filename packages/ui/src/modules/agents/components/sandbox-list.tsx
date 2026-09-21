import { useState } from "react";

import { useStore } from "../../../store.js";
import type { AgentView } from "../../../types.js";
import {
  type BindMessenger,
  ChannelBindModal,
} from "../../sandboxes/components/channels/channel-bind-modal.js";
import { useAgents } from "../api/queries.js";
import type { useAgentRows } from "../hooks/use-agent-rows.js";
import type { TemporarySandboxSplit } from "../utils/temporary-sandboxes.js";
import { AgentRow } from "./agent-row.js";

interface Props {
  agents: AgentView[];
  drawByDriver: TemporarySandboxSplit["drawByDriver"];
  rowProps: ReturnType<typeof useAgentRows>["rowProps"];
  workingByAgent?: ReadonlyMap<string, boolean>;
  onStop: (agent: AgentView) => void;
  onDelete: (agent: AgentView) => void;
}

export function SandboxList({
  agents,
  drawByDriver,
  rowProps,
  workingByAgent,
  onStop,
  onDelete,
}: Props) {
  const selectAgent = useStore((s) => s.selectAgent);
  const navigateToSandboxHome = useStore((s) => s.navigateToSandboxHome);
  const messengers = useAgents().data?.availableChannels ?? {};
  const [bindMessenger, setBindMessenger] = useState<BindMessenger | null>(
    null,
  );

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
          onShare={() => navigateToSandboxHome(agent.id, "setup", "knowledge")}
          configureLabel="Configure agent"
          onStop={() => onStop(agent)}
          onDelete={() => onDelete(agent)}
          messengers={messengers}
          onAddToChannel={setBindMessenger}
        />
      ))}
      {bindMessenger && (
        <ChannelBindModal
          messengers={[bindMessenger]}
          onClose={() => setBindMessenger(null)}
        />
      )}
    </div>
  );
}
