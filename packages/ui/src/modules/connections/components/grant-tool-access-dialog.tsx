import type { ConnectionView, GrantToolAccess } from "api-server-api";
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
  useSetGrantToolAccess,
} from "../api/mutations.js";
import {
  accessSummary,
  sameAccess,
  TOOL_GROUP_TITLE,
} from "../lib/grant-tool-access.js";
import { mutationMessage } from "../lib/mutation-message.js";
import { AccessSummaryBadge } from "./access-summary-label.js";
import { ToolListStatus } from "./tool-list-status.js";
import { ToolRuleGroup } from "./tool-rule-group.js";

export interface GrantAgent {
  id: string;
  name: string;
}

interface Props {
  agent: GrantAgent;
  connection: ConnectionView;
  access: GrantToolAccess;
  onClose: () => void;
}

// UNIT_BOUNDARY_DESCRIPTION: the dialog where the owner sets what one Agent may do with the tools of one MCP connection: a rule for the tools that read, one for the tools that post or change, and a tool that differs from its group as an exception. A tool the server adds later follows the second group. Save changes this Agent's grant only, never another Agent's.
export function GrantToolAccessDialog({
  agent,
  connection,
  access,
  onClose,
}: Props) {
  const [draft, setDraft] = useState(access);
  const save = useSetGrantToolAccess();
  const refresh = useRefreshConnectionTools();
  const toolAccess = refresh.data ?? connection.toolAccess;
  const tools = toolAccess?.tools ?? null;
  const saveError = mutationMessage(
    save.error,
    "Couldn't change the tool access. Please try again.",
  );
  const refreshError = mutationMessage(
    refresh.error,
    "the request failed. Please try again.",
  );

  const submit = async () => {
    try {
      await save.mutateAsync({
        agentId: agent.id,
        connectionId: connection.id,
        access: draft,
      });
      onClose();
    } catch {}
  };

  return (
    <Modal onClose={save.isPending ? undefined : onClose} size="md">
      <DialogHeader
        title="Tool access"
        subtitle={`${connection.name} · for ${agent.name}`}
        onClose={onClose}
        closeDisabled={save.isPending}
        closeTestId="grant-tool-access-close"
      />
      <DialogBody className="flex flex-col gap-3">
        <ToolRuleGroup
          group="read"
          access={draft}
          tools={tools}
          onChange={setDraft}
        />
        <ToolRuleGroup
          group="write"
          access={draft}
          tools={tools}
          onChange={setDraft}
          defaultOpen
        />
        <p className="text-sm text-muted-foreground">
          {`A tool the server adds later follows “${TOOL_GROUP_TITLE.write}”.`}
        </p>
        <ToolListStatus
          toolAccess={toolAccess}
          refreshing={refresh.isPending}
          refreshError={refreshError}
          onRefresh={() => refresh.mutate({ id: connection.id })}
        />
        {saveError && (
          <Callout tone="danger" size="sm">
            {saveError}
          </Callout>
        )}
      </DialogBody>
      <DialogActions
        leading={
          <AccessSummaryBadge
            summary={accessSummary(draft, tools)}
            testId="grant-tool-access-summary"
          />
        }
        onCancel={onClose}
        cancelDisabled={save.isPending}
        label="Save"
        pendingLabel="Saving…"
        pending={save.isPending}
        disabled={sameAccess(draft, access)}
        onSubmit={() => void submit()}
        testId="grant-tool-access-submit"
      />
    </Modal>
  );
}
