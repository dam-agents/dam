import type { ConnectionView } from "api-server-api";
import { useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Callout } from "@/components/ui/callout";

import { useSetConnectionFullAccess } from "../api/mutations.js";
import { AccessChoiceField } from "../forms/access-choice-field.js";
import {
  type ConnectionAccess,
  connectionAccess,
  EDIT_ACCESS_TITLE,
} from "../lib/access-choice.js";
import { mutationMessage } from "../lib/mutation-message.js";

// UNIT_BOUNDARY_DESCRIPTION: the dialog where the owner switches a connection between read only and full access. The choice holds for every agent that has the connection, from its next request.
export function ConnectionEditAccessDialog({
  connection,
  onClose,
}: {
  connection: ConnectionView;
  onClose: () => void;
}) {
  const save = useSetConnectionFullAccess();
  const current = connectionAccess(connection) ?? "read-only";
  const [access, setAccess] = useState<ConnectionAccess>(current);
  const saveError = mutationMessage(
    save.error,
    "Couldn't change the access. Please try again.",
  );

  const submit = async () => {
    try {
      await save.mutateAsync({
        id: connection.id,
        fullAccess: access === "full",
      });
      onClose();
    } catch {}
  };

  return (
    <Modal onClose={save.isPending ? undefined : onClose} size="sm">
      <DialogHeader
        title={EDIT_ACCESS_TITLE}
        subtitle={connection.name}
        onClose={onClose}
        closeDisabled={save.isPending}
        closeTestId="edit-access-close"
      />
      <DialogBody className="flex flex-col gap-4">
        <AccessChoiceField
          value={access}
          onChange={setAccess}
          fullAccessLabel={connection.accessChoice?.fullAccessLabel ?? ""}
          testIdPrefix="edit-access"
        />
        <p className="text-sm text-muted-foreground">
          The choice holds for every agent that has this connection, from its
          next request.
        </p>
        {saveError && (
          <Callout tone="danger" size="sm">
            {saveError}
          </Callout>
        )}
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelDisabled={save.isPending}
        label="Save"
        pendingLabel="Saving…"
        pending={save.isPending}
        disabled={access === current}
        onSubmit={() => void submit()}
        testId="edit-access-submit"
      />
    </Modal>
  );
}
