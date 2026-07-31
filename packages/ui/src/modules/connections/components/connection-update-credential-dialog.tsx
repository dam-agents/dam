import { TRPCClientError } from "@trpc/client";
import type { ConnectionAuthKind, ConnectionView } from "api-server-api";
import { useState } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Button } from "@/components/ui/button";

import { useUpdateConnection } from "../api/mutations.js";
import { LabeledInput } from "../forms/labeled-input.js";

/** What the one field means per auth kind — the server dispatches on the same
 *  distinction, so the copy has to name the right secret. */
const COPY: Record<
  Exclude<ConnectionAuthKind, "none" | "oauth">,
  { label: string; hint: string; multiline?: boolean }
> = {
  header: {
    label: "New credential value",
    hint: "Replaces the value injected on this connection's hosts.",
  },
  "client-credentials": {
    label: "New client secret",
    hint: "Verified by minting a token before it is stored — a wrong secret is rejected.",
  },
  "github-app": {
    label: "New private key",
    hint: "PEM from your GitHub App. Verified by minting an installation token before it is stored.",
    multiline: true,
  },
};

/**
 * Replaces a connection's stored credential in place. The connection's identity
 * and every sandbox grant survive, so this dialog only ever collects the one
 * secret. A rejection from the provider is shown inline rather than as a toast —
 * it is about what was typed.
 */
export function ConnectionUpdateCredentialDialog({
  connection,
  onClose,
}: {
  connection: ConnectionView;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const update = useUpdateConnection({ silent: true });

  const copy =
    connection.authKind === "none" || connection.authKind === "oauth"
      ? undefined
      : COPY[connection.authKind];
  if (!copy) return null;

  // A rejected credential is feedback about what was typed, so the server's own
  // message belongs on the field. Anything else (transport, 500) is not about
  // the value at all — showing "fetch failed" under the input would blame it.
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
    } catch {
      // Rendered inline from the mutation's error below.
    }
  };

  return (
    <Modal widthClass="w-[505px]">
      <DialogHeader
        title="Update credential"
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

/** The minting kinds reject a bad secret as BAD_REQUEST carrying the provider's
 *  own words; everything else is a failure of the request, not of the value. */
function isBadRequest(err: unknown): err is Error {
  return err instanceof TRPCClientError && err.data?.code === "BAD_REQUEST";
}
