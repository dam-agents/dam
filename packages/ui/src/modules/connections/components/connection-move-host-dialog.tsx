import type { ConnectionView } from "api-server-api";
import { useState } from "react";

import { FormField } from "@/components/form-field";
import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Callout } from "@/components/ui/callout";
import { Select } from "@/components/ui/select";

import { useMoveConnectionToHost } from "../api/mutations.js";
import { mutationMessage } from "../lib/mutation-message.js";

export function ConnectionMoveHostDialog({
  connection,
  hosts,
  onMoved,
  onClose,
}: {
  connection: ConnectionView;
  hosts: readonly string[];
  onMoved: (connection: ConnectionView) => void;
  onClose: () => void;
}) {
  const move = useMoveConnectionToHost();
  const [host, setHost] = useState(hosts[0] ?? "");

  const moveError = mutationMessage(
    move.error,
    "Couldn't move the sign-in. Please try again.",
  );

  const submit = async () => {
    if (!host) return;
    try {
      await move.mutateAsync({ id: connection.id, host });
      onMoved(connection);
    } catch {}
  };

  return (
    <Modal onClose={move.isPending ? undefined : onClose}>
      <DialogHeader
        title="Move to another host"
        subtitle={connection.name}
        onClose={onClose}
        closeTestId="move-host-close"
      />
      <DialogBody className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          {connection.host
            ? `This sign-in is on ${connection.host}. `
            : undefined}
          It keeps its name, the connections made from it and the agents that
          hold them. You authorize it again on the new host.
        </p>
        <FormField label="New host">
          <Select
            data-testid="move-host-select"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          >
            {hosts.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </Select>
        </FormField>
        {moveError && (
          <Callout tone="danger" size="sm">
            {moveError}
          </Callout>
        )}
      </DialogBody>
      <DialogActions
        onCancel={onClose}
        cancelDisabled={move.isPending}
        label="Move and authorize"
        pendingLabel="Moving…"
        pending={move.isPending}
        disabled={!host}
        onSubmit={() => void submit()}
        testId="move-host-submit"
      />
    </Modal>
  );
}
