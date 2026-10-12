import { DialogBody, DialogHeader, Modal } from "../../../components/modal.js";
import { ProviderSection } from "./provider-section.js";

export function ProviderSettingsModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose}>
      <DialogHeader
        title="Connect an LLM provider"
        subtitle="Agents need one to reach any models. You can change this later in Settings."
        onClose={onClose}
      />
      <DialogBody>
        <ProviderSection />
      </DialogBody>
    </Modal>
  );
}
