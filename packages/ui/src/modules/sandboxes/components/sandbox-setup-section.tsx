import type { AgentView } from "../../../types.js";
import {
  AgentModelSettingsSection,
  AgentSleepSection,
} from "./agent-config-sections.js";

export function SandboxSetupSection({ agent }: { agent: AgentView }) {
  return (
    <>
      <AgentSleepSection agent={agent} />
      <AgentModelSettingsSection agentId={agent.id} />
    </>
  );
}
