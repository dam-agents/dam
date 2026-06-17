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
      <DialogHeader>
        <h2 className="text-[18px] font-bold">Revoke API key?</h2>
      </DialogHeader>
      <DialogBody>
        <p className="text-[13px] text-muted-foreground mb-2">
          The key{" "}
          <span className="font-semibold text-foreground">{apiKey.name}</span> (
          <code className="text-[12px]">{apiKey.id}</code>) will stop working
          immediately on every running CLI and integration that uses it.
        </p>
        <p className="text-[13px] text-muted-foreground">
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
