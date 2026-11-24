import type { ConnectionView, ToolMode } from "api-server-api";
import { useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Callout } from "@/components/ui/callout";

import { useSetConnectionToolMode } from "../api/mutations.js";
import { ToolModeField } from "../forms/tool-mode-field.js";
import { mutationMessage } from "../lib/mutation-message.js";
import {
  CHANGE_ACCESS_TITLE,
  connectionPickableToolModes,
  ownToolModeNames,
  TOOL_MODE_SAVED_NOTE,
} from "../lib/tool-mode.js";

// UNIT_BOUNDARY_DESCRIPTION: the dialog where the owner changes the tool mode of an MCP connection while the `mcp-tool-approval` feature is off: the Slack Account's choice between read only and "Can post as me", and the way to switch a connection still left in needs approval away from it. The mode holds for every agent that has the connection, from its next request. With the feature on, the tool access dialog of each Agent's grant takes its place.
export function ConnectionToolAccessDialog({
  connection,
  onClose,
}: {
  connection: ConnectionView;
  onClose: () => void;
}) {
  const save = useSetConnectionToolMode();
  const toolAccess = connection.toolAccess;
  const current = toolAccess?.mode ?? "allow-all";
  const [mode, setMode] = useState<ToolMode>(current);
  const saveError = mutationMessage(
    save.error,
    "Couldn't change the access. Please try again.",
  );

  const submit = async () => {
    try {
      await save.mutateAsync({ id: connection.id, mode });
      onClose();
    } catch {}
  };

  return (
    <Modal onClose={save.isPending ? undefined : onClose} size="sm">
      <DialogHeader
        title={CHANGE_ACCESS_TITLE}
        subtitle={connection.name}
        onClose={onClose}
        closeDisabled={save.isPending}
        closeTestId="edit-access-close"
      />
      <DialogBody className="flex flex-col gap-4">
        <ToolModeField
          value={mode}
          onChange={setMode}
          modes={connectionPickableToolModes(toolAccess, false)}
          ownNames={ownToolModeNames(toolAccess)}
          testIdPrefix="edit-access"
        />
        <p className="text-sm text-muted-foreground">{TOOL_MODE_SAVED_NOTE}</p>
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
        disabled={mode === current}
        onSubmit={() => void submit()}
        testId="edit-access-submit"
      />
    </Modal>
  );
}
