import { TRPCClientError } from "@trpc/client";
import type {
  ConnectionCredentialUpdate,
  ConnectionView,
} from "api-server-api";
import { type ReactNode, useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";

import { useUpdateConnection } from "../api/mutations.js";
import {
  type CredentialCopy,
  credentialCopyFor,
  labelFor,
} from "../forms/field-copy.js";
import { LabeledInput } from "../forms/labeled-input.js";
import { ConnectionEditGithubAppScopeDialog } from "./connection-edit-github-app-scope-dialog.js";
import { ConnectionEditGithubUserTokenScopeDialog } from "./connection-edit-github-user-token-scope-dialog.js";

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
  if (
    maintenance.editingScope?.authKind === "oauth" &&
    maintenance.closeEditScope
  ) {
    return (
      <ConnectionEditGithubUserTokenScopeDialog
        connection={maintenance.editingScope}
        onClose={maintenance.closeEditScope}
      />
    );
  }
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

function ConnectionUpdateCredentialDialog({
  connection,
  onClose,
}: {
  connection: ConnectionView;
  onClose: () => void;
}) {
  const copy = credentialCopyFor(connection.authKind);
  if (!copy) return null;
  return copy.fields === "key-pair" ? (
    <KeyPairCredentialDialog
      connection={connection}
      copy={copy}
      onClose={onClose}
    />
  ) : (
    <SingleValueCredentialDialog
      connection={connection}
      copy={copy}
      onClose={onClose}
    />
  );
}

function SingleValueCredentialDialog({
  connection,
  copy,
  onClose,
}: {
  connection: ConnectionView;
  copy: Extract<CredentialCopy, { fields: "value" }>;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const update = useCredentialUpdate(connection, onClose);
  return (
    <CredentialDialogFrame
      title={copy.action}
      subtitle={connection.name}
      onClose={onClose}
      canSubmit={value.trim().length > 0}
      pending={update.pending}
      onSubmit={() => update.submit({ value: value.trim() })}
    >
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
        error={update.fieldError}
        autoFocus
      />
    </CredentialDialogFrame>
  );
}

function KeyPairCredentialDialog({
  connection,
  copy,
  onClose,
}: {
  connection: ConnectionView;
  copy: Extract<CredentialCopy, { fields: "key-pair" }>;
  onClose: () => void;
}) {
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const update = useCredentialUpdate(connection, onClose);
  const complete =
    accessKeyId.trim().length > 0 && secretAccessKey.trim().length > 0;
  return (
    <CredentialDialogFrame
      title={copy.action}
      subtitle={connection.name}
      onClose={onClose}
      canSubmit={complete}
      pending={update.pending}
      onSubmit={() =>
        update.submit({
          accessKeyId: accessKeyId.trim(),
          secretAccessKey: secretAccessKey.trim(),
        })
      }
    >
      <LabeledInput
        label={labelFor("accessKeyId")}
        testId="update-credential-access-key-id"
        type="text"
        value={accessKeyId}
        onChange={setAccessKeyId}
        autoFocus
      />
      <LabeledInput
        label={labelFor("secretAccessKey")}
        testId="update-credential-value"
        type="password"
        placeholder="•••••"
        help={copy.hint}
        value={secretAccessKey}
        onChange={setSecretAccessKey}
        error={update.fieldError}
      />
    </CredentialDialogFrame>
  );
}

function useCredentialUpdate(connection: ConnectionView, onClose: () => void) {
  const update = useUpdateConnection({ silent: true });
  const fieldError =
    update.error === null
      ? undefined
      : isBadRequest(update.error)
        ? update.error.message
        : "Couldn't update the credential. Please try again.";
  const submit = async (credential: ConnectionCredentialUpdate) => {
    try {
      await update.mutateAsync({ id: connection.id, ...credential });
      onClose();
    } catch {}
  };
  return { submit, pending: update.isPending, fieldError };
}

function CredentialDialogFrame({
  title,
  subtitle,
  onClose,
  canSubmit,
  pending,
  onSubmit,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  canSubmit: boolean;
  pending: boolean;
  onSubmit: () => Promise<void>;
  children: ReactNode;
}) {
  return (
    <Modal widthClass="w-[505px]">
      <DialogHeader
        title={title}
        subtitle={subtitle}
        onClose={onClose}
        closeTestId="update-credential-close"
      />
      <DialogBody className="flex flex-col gap-4">{children}</DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={!canSubmit || pending}
          onClick={() => void onSubmit()}
          data-testid="update-credential-submit"
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </Modal>
  );
}

function isBadRequest(err: unknown): err is Error {
  return err instanceof TRPCClientError && err.data?.code === "BAD_REQUEST";
}
