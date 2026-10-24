import type { AgentView } from "../../../types.js";
import {
  AgentModelSettingsSection,
  AgentResourcesSection,
} from "./agent-config-sections.js";

export function SandboxSetupSection({ agent }: { agent: AgentView }) {
  return (
    <>
      <AgentResourcesSection agent={agent} />
      <AgentModelSettingsSection agentId={agent.id} />
    </>
  );
}
