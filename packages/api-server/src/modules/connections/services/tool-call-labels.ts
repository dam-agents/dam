import type { SecretStore } from "../../secret-store/index.js";
import type { ConnectionsRepository } from "../infrastructure/connections-repository.js";
import { slackMessageTargetOf } from "../domain/slack-message-target.js";
import { lookupSlackTargetLabel } from "../infrastructure/slack-target-labels.js";
import { storedAccessToken } from "./account-label.js";

interface LabelledCall {
  readonly tool: string;
  readonly arguments: unknown;
}

type ToolCallLabeler = (
  call: LabelledCall,
  accessToken: () => Promise<string | null>,
  signal: AbortSignal,
) => Promise<string | null>;

const labelSlackToolCall: ToolCallLabeler = async (
  call,
  accessToken,
  signal,
) => {
  const target = slackMessageTargetOf(call.tool, call.arguments);
  if (!target) return null;
  const token = await accessToken();
  return token ? lookupSlackTargetLabel(token, target, signal) : null;
};

function toolCallLabelerFor(templateId: string): ToolCallLabeler | undefined {
  return templateId === "slack" ? labelSlackToolCall : undefined;
}

export interface ToolCallLabels {
  targetLabel(
    call: LabelledCall & { connectionId: string; templateId: string },
    signal: AbortSignal,
  ): Promise<string | null>;
}

// UNIT_BOUNDARY_DESCRIPTION: names the target of a held tool call with the Connection's own credential, so the person who answers the approval sees where the call goes and not a raw id. A Template may label its tool calls; the Slack Account names the conversation or the person a message goes to. A Template with no labeler, or a call it does not label, reads neither the Connection nor its Secret.
export function createToolCallLabels(deps: {
  repo: Pick<ConnectionsRepository, "getById">;
  secretStore: SecretStore;
}): ToolCallLabels {
  return {
    async targetLabel(call, signal) {
      const labeler = toolCallLabelerFor(call.templateId);
      if (!labeler) return null;
      return labeler(
        call,
        async () => {
          const connection = await deps.repo.getById(call.connectionId);
          return connection
            ? storedAccessToken(connection, deps.secretStore)
            : null;
        },
        signal,
      );
    },
  };
}
