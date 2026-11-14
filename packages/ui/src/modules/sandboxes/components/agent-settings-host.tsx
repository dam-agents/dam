import { useStore } from "../../../store.js";
import { useAgent } from "../../agents/api/queries.js";
import { ConfigureAgentModal } from "./configure-agent-modal.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The one place the Agent's settings modal is
 * shown, mounted beside the app's other overlays, so every wrench — the
 * chat's top bar, a sidebar row, a Home card — opens the same modal over
 * whatever view is behind it. An Agent that is gone, or no longer known,
 * shows nothing and clears the request.
 */
export function AgentSettingsHost() {
  const target = useStore((s) => s.agentSettings);
  const close = useStore((s) => s.closeAgentSettings);
  const agent = useAgent(target?.agentId ?? null);
  if (!target || !agent) return null;
  return (
    <ConfigureAgentModal
      key={`${agent.id}:${target.section}`}
      agent={agent}
      initialSection={target.section}
      onClose={close}
    />
  );
}
