import { useIsMutating } from "@tanstack/react-query";
import { useState } from "react";

import { Modal } from "../../../../components/modal.js";
import { trpc } from "../../../../trpc.js";
import { CreateApiKeyForm } from "./create-form.js";
import { RevealToken } from "./reveal-token.js";

interface Props {
  onClose: () => void;
}

export function CreateApiKeyDialog({ onClose }: Props) {
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const creating =
    useIsMutating({ mutationKey: trpc.apiKeys.create.mutationKey() }) > 0;

  return (
    <Modal onClose={plaintext || creating ? undefined : onClose}>
      {plaintext ? (
        <RevealToken plaintext={plaintext} onClose={onClose} />
      ) : (
        <CreateApiKeyForm onCreated={setPlaintext} onCancel={onClose} />
      )}
    </Modal>
  );
}
