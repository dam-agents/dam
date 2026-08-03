import type { ApiKeyView } from "api-server-api";

import { Button } from "@/components/ui/button";

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
      <DialogHeader title="Revoke API key?" />
      <DialogBody>
        <p className="text-sm text-muted-foreground mb-2">
          The key{" "}
          <span className="font-semibold text-foreground">{apiKey.name}</span> (
          <code className="text-xs">{apiKey.id}</code>) will stop working
          immediately on every running CLI and integration that uses it.
        </p>
        <p className="text-sm text-muted-foreground">
          This cannot be undone — to restore access, create a new key.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={onConfirm}
          disabled={pending}
        >
          {pending ? "Revoking…" : "Revoke"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}
