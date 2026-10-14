import { DialogBody, DialogHeader, Modal } from "../../../components/modal.js";
import { useGrantProvider } from "../../sessions/api/session-pair.js";
import { ProviderSection } from "./provider-section.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The first-run prompt for an agent's owner who has
 * no provider yet. The agent was created before the provider existed, so no
 * default was attached to it; the provider connected here is attached to that
 * agent, or its first message would run with no model key.
 */
export function ProviderSettingsModal({
  agentId,
  onClose,
}: {
  agentId: string | null;
  onClose: () => void;
}) {
  const { grant } = useGrantProvider(agentId);
  return (
    <Modal onClose={onClose}>
      <DialogHeader
        title="Connect an LLM provider"
        subtitle="Agents need one to reach any models. You can change this later in Settings."
        onClose={onClose}
      />
      <DialogBody>
        <ProviderSection
          onConnected={agentId ? (id) => void grant(id) : undefined}
        />
      </DialogBody>
    </Modal>
  );
}
