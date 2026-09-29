import type { SlackBlock } from "./slack-gateway.js";

export const DELETE_POST_ACTION = "agent_post_delete";

export const DELETE_POST_CONFIRM = "agent_post_delete_confirm";

const REASON_INPUT = "reason";

const REASON_MAX_CHARS = 2000;

export function deletePostActions(fileIds: string[]): SlackBlock {
  return {
    type: "actions",
    elements: [
      {
        type: "button",
        action_id: DELETE_POST_ACTION,
        text: { type: "plain_text", text: "Delete (owner only)" },
        value: JSON.stringify({ files: fileIds }),
      },
    ],
  };
}

export function deletePostFileIds(value: string): string[] {
  try {
    const files = (JSON.parse(value) as { files?: unknown }).files;
    return Array.isArray(files)
      ? files.filter((f): f is string => typeof f === "string")
      : [];
  } catch {
    return [];
  }
}

export interface DeletePostModalMetadata {
  pendingId: string;
  channel: string;
  threadTs?: string;
}

export function deletePostModal(metadata: DeletePostModalMetadata): SlackBlock {
  return {
    type: "modal",
    callback_id: DELETE_POST_CONFIRM,
    private_metadata: JSON.stringify(metadata),
    title: { type: "plain_text", text: "Delete post" },
    submit: { type: "plain_text", text: "Delete" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "This removes the post and its attachments for everyone in the " +
            "conversation. The agent's session keeps what it wrote.",
        },
      },
      {
        type: "input",
        block_id: REASON_INPUT,
        optional: true,
        label: { type: "plain_text", text: "Tell the agent why (optional)" },
        element: {
          type: "plain_text_input",
          action_id: REASON_INPUT,
          multiline: true,
          max_length: REASON_MAX_CHARS,
        },
      },
    ],
  };
}

export function parseDeletePostModal(
  privateMetadata: string,
  inputs: Record<string, string>,
): { metadata: DeletePostModalMetadata; reason: string | null } | null {
  try {
    const metadata = JSON.parse(privateMetadata) as DeletePostModalMetadata;
    if (
      typeof metadata.pendingId !== "string" ||
      typeof metadata.channel !== "string"
    )
      return null;
    const reason = inputs[REASON_INPUT]?.trim().slice(0, REASON_MAX_CHARS);
    return { metadata, reason: reason || null };
  } catch {
    return null;
  }
}
