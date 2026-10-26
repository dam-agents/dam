import { useState } from "react";

import { Modal } from "../../../../components/modal.js";
import { CreateApiKeyForm } from "./create-form.js";
import { RevealToken } from "./reveal-token.js";

interface Props {
  onClose: () => void;
}

export function CreateApiKeyDialog({ onClose }: Props) {
  const [plaintext, setPlaintext] = useState<string | null>(null);

  return (
    <Modal>
      {plaintext ? (
        <RevealToken plaintext={plaintext} onClose={onClose} />
      ) : (
        <CreateApiKeyForm onCreated={setPlaintext} onCancel={onClose} />
      )}
    </Modal>
  );
}
