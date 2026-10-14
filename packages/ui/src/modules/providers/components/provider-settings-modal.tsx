import { DialogBody, DialogHeader, Modal } from "../../../components/modal.js";
import type { ProviderRef } from "./provider-item.js";
import { ProviderSection } from "./provider-section.js";

export function ProviderSettingsModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded?: (ref: ProviderRef) => void;
}) {
  return (
    <Modal onClose={onClose}>
      <DialogHeader
        title="Connect an LLM provider"
        subtitle="Agents need one to reach any models. You can change this later in Settings."
        onClose={onClose}
      />
      <DialogBody>
        <ProviderSection onAdded={onAdded} />
      </DialogBody>
    </Modal>
  );
}
