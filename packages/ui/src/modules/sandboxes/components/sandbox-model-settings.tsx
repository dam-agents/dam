import { ModelSettingsPanel } from "../../sessions/components/model-settings-panel.js";
import { useOperableState, WakeToEditButton } from "./sandbox-wake-to-edit.js";

/**
 * Sandbox-home Model Settings: the shared panel in its page variant, gated by
 * the agent's lifecycle. Editable only while operable; asleep it shows the
 * last-known values (or placeholders) read-only with a "Start agent to edit"
 * action, and a spinner while the agent is coming up.
 */
export function SandboxModelSettings({ agentId }: { agentId: string }) {
  const { operable, comingUp } = useOperableState(agentId);

  return (
    <ModelSettingsPanel
      agentId={agentId}
      variant="page"
      disabled={!operable}
      headerAction={
        operable ? undefined : (
          <WakeToEditButton agentId={agentId} comingUp={comingUp} />
        )
      }
    />
  );
}
