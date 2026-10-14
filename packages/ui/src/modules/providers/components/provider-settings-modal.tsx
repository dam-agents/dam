import { DialogBody, DialogHeader, Modal } from "../../../components/modal.js";
import { useGrantProvider } from "../../sessions/api/session-pair.js";
import { ProviderSection } from "./provider-section.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The prompt for an agent that holds no provider.
 * Its first message would run with no model key, so the provider the user
 * connects here — or picks among those already connected — is attached to
 * that agent, and the prompt closes.
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
          onConnected={
            agentId
              ? (id) => {
                  void grant(id);
                  onClose();
                }
              : undefined
          }
        />
      </DialogBody>
    </Modal>
  );
}
