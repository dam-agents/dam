import type { ApiKeyView } from "api-server-api";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "../../../components/modal.js";

interface Props {
  apiKey: Pick<ApiKeyView, "id" | "name">;
  onConfirm: () => void;
  onCancel: () => void;
  pending: boolean;
}

export function ConfirmRevokeDialog({
  apiKey,
  onConfirm,
  onCancel,
  pending,
}: Props) {
  return (
    <Modal>
      <DialogHeader>
        <h2 className="text-[18px] font-bold">Revoke API key?</h2>
      </DialogHeader>
      <DialogBody>
        <p className="text-[13px] text-text-secondary mb-2">
          The key <span className="font-semibold text-text">{apiKey.name}</span>{" "}
          (<code className="text-[12px]">{apiKey.id}</code>) will stop working
          immediately on every running CLI and integration that uses it.
        </p>
        <p className="text-[13px] text-text-secondary">
          This cannot be undone — to restore access, create a new key.
        </p>
      </DialogBody>
      <DialogFooter>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-[13px] font-semibold rounded-lg text-text-secondary hover:bg-surface-raised"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className="px-3 py-1.5 text-[13px] font-semibold rounded-lg bg-danger text-white hover:bg-danger/90 disabled:opacity-50"
        >
          {pending ? "Revoking…" : "Revoke"}
        </button>
      </DialogFooter>
    </Modal>
  );
}
