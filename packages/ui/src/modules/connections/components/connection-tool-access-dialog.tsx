import type { ConnectionView, ToolMode } from "api-server-api";
import { useState } from "react";

import {
  DialogActions,
  DialogBody,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Callout } from "@/components/ui/callout";

import {
  useRefreshConnectionTools,
  useSetConnectionToolMode,
} from "../api/mutations.js";
import { ToolModeField } from "../forms/tool-mode-field.js";
import { useToolApprovalOffered } from "../hooks/use-tool-approval-offered.js";
import { mutationMessage } from "../lib/mutation-message.js";
import {
  connectionPickableToolModes,
  ownToolModeNames,
  TOOL_MODE_SAVED_NOTE,
  toolAccessTitle,
} from "../lib/tool-mode.js";
import { ConnectionToolList } from "./connection-tool-list.js";

// UNIT_BOUNDARY_DESCRIPTION: the dialog where the owner changes the tool mode of an MCP connection. With the `mcp-tool-approval` feature on it also shows the server's tools, read tools first, with a refresh; with it off it keeps the Slack Account's choice between read only and "Can post as me", and lets the owner switch a connection still left in needs approval away from it. The mode holds for every agent that has the connection, from its next request.
export function ConnectionToolAccessDialog({
  connection,
  onClose,
}: {
  connection: ConnectionView;
  onClose: () => void;
}) {
  const offered = useToolApprovalOffered();
  const save = useSetConnectionToolMode();
  const refresh = useRefreshConnectionTools();
  const toolAccess = refresh.data ?? connection.toolAccess;
  const current = toolAccess?.mode ?? "allow-all";
  const [mode, setMode] = useState<ToolMode>(current);
  const modes = connectionPickableToolModes(toolAccess, offered);
  const saveError = mutationMessage(
    save.error,
    "Couldn't change the access. Please try again.",
  );
  const refreshError = mutationMessage(
    refresh.error,
    "the request failed. Please try again.",
  );

  const submit = async () => {
    try {
      await save.mutateAsync({ id: connection.id, mode });
      onClose();
    } catch {}
  };

  return (
    <Modal
      onClose={save.isPending ? undefined : onClose}
      size={offered ? "md" : "sm"}
    >
      <DialogHeader
        title={toolAccessTitle(offered)}
        subtitle={connection.name}
        onClose={onClose}
        closeDisabled={save.isPending}
        closeTestId="edit-access-close"
      />
      <DialogBody className="flex flex-col gap-4">
        <ToolModeField
          value={mode}
          onChange={setMode}
          modes={modes}
          offered={ownToolModeNames(toolAccess, offered)}
          testIdPrefix="edit-access"
        />
        <p className="text-sm text-muted-foreground">{TOOL_MODE_SAVED_NOTE}</p>
        {offered && toolAccess && (
          <ConnectionToolList
            toolAccess={toolAccess}
            refreshing={refresh.isPending}
            refreshError={refreshError}
            onRefresh={() => refresh.mutate({ id: connection.id })}
          />
        )}
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
