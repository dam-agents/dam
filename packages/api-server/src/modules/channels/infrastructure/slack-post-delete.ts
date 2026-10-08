import type {
  SlackBlock,
  SlackMessage,
  SlackMessageMetadata,
} from "./slack-gateway.js";

export const DELETE_POST_CONFIRM = "agent_post_delete_confirm";

const AGENT_POST_METADATA = "agent_post";

const REASON_INPUT = "reason";

const REASON_MAX_CHARS = 2000;

const POST_LINK_RE = /\/archives\/([A-Za-z0-9]+)\/p(\d{10})(\d{6})/;

const THREAD_TS_RE = /[?&]thread_ts=([\d.]+)/;

export interface AgentPostLink {
  channel: string;
  ts: string;
  threadTs?: string;
}

export function parseAgentPostLink(raw: string): AgentPostLink | null {
  const link = raw.trim().replace(/^</, "").replace(/>$/, "").split("|")[0];
  const target = link ? POST_LINK_RE.exec(link) : null;
  if (!target || !link) return null;
  const threadTs = THREAD_TS_RE.exec(link)?.[1];
  return {
    channel: target[1]!,
    ts: `${target[2]!}.${target[3]!}`,
    ...(threadTs ? { threadTs } : {}),
  };
}

export function agentPostMetadata(fileIds: string[]): SlackMessageMetadata {
  return { eventType: AGENT_POST_METADATA, payload: { files: fileIds } };
}

export function deletePostFileIds(message: SlackMessage): string[] {
  const files =
    message.metadata?.eventType === AGENT_POST_METADATA
      ? message.metadata.payload["files"]
      : [];
  const shared = Array.isArray(files)
    ? files.filter((f): f is string => typeof f === "string")
    : [];
  return [...new Set([...shared, ...(message.fileIds ?? [])])];
}

export interface DeletePostModalMetadata {
  pendingId: string;
  channel: string;
}

export function deletePostModal(
  metadata: DeletePostModalMetadata,
  reason: string | null,
): SlackBlock {
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
          ...(reason
            ? { initial_value: reason.slice(0, REASON_MAX_CHARS) }
            : {}),
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
