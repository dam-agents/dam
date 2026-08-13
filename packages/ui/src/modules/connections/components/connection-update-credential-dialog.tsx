import { TRPCClientError } from "@trpc/client";
import type { ConnectionView } from "api-server-api";
import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";

import { useUpdateConnection } from "../api/mutations.js";
import { credentialCopyFor } from "../forms/field-copy.js";
import { LabeledInput } from "../forms/labeled-input.js";
import { ConnectionEditGithubAppScopeDialog } from "./connection-edit-github-app-scope-dialog.js";

export function ConnectionMaintenanceDialog({
  maintenance,
}: {
  maintenance: {
    updating: ConnectionView | null;
    closeUpdate: () => void;
    editingScope?: ConnectionView | null;
    closeEditScope?: () => void;
  };
}) {
  if (maintenance.editingScope && maintenance.closeEditScope) {
    return (
      <ConnectionEditGithubAppScopeDialog
        connection={maintenance.editingScope}
        onClose={maintenance.closeEditScope}
      />
    );
  }
  if (!maintenance.updating) return null;
  return (
    <ConnectionUpdateCredentialDialog
      connection={maintenance.updating}
      onClose={maintenance.closeUpdate}
    />
  );
}

export function ConnectionUpdateCredentialDialog({
  connection,
  onClose,
}: {
  connection: ConnectionView;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const update = useUpdateConnection({ silent: true });

  const copy = credentialCopyFor(connection.authKind);
  if (!copy) return null;

  const fieldError =
    update.error === null
      ? undefined
      : isBadRequest(update.error)
        ? update.error.message
        : "Couldn't update the credential. Please try again.";

  const submit = async () => {
    try {
      await update.mutateAsync({ id: connection.id, value: value.trim() });
      onClose();
    } catch {}
  };

  return (
    <Modal widthClass="w-[505px]">
      <DialogHeader
        title={copy.action}
        subtitle={connection.name}
        onClose={onClose}
        closeTestId="update-credential-close"
      />
      <DialogBody className="flex flex-col gap-4">
        <LabeledInput
          label={copy.label}
          testId="update-credential-value"
          type="password"
          multiline={copy.multiline}
          placeholder={
            copy.multiline ? "-----BEGIN RSA PRIVATE KEY-----\n…" : "•••••"
          }
          help={copy.hint}
          value={value}
          onChange={setValue}
          error={fieldError}
          autoFocus
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={value.trim().length === 0 || update.isPending}
          onClick={() => void submit()}
          data-testid="update-credential-submit"
        >
          {update.isPending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}

function isBadRequest(err: unknown): err is Error {
  return err instanceof TRPCClientError && err.data?.code === "BAD_REQUEST";
}
