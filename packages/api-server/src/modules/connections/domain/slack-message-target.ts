export type SlackMessageTarget =
  | { readonly kind: "conversation"; readonly id: string }
  | { readonly kind: "person"; readonly id: string };

const SLACK_MESSAGE_TOOLS: ReadonlySet<string> = new Set([
  "slack_send_message",
  "slack_schedule_message",
  "slack_send_message_draft",
]);

const SLACK_CONVERSATION_ID = /^[CGD][A-Z0-9]+$/;
const SLACK_PERSON_ID = /^[UW][A-Z0-9]+$/;

// UNIT_BOUNDARY_DESCRIPTION: where a Slack tool call that writes a message sends it, read from its `channel_id` argument: a conversation (a channel, a private channel or a direct message) or a person, whose id Slack takes for a direct message with them. Null for any other tool, and for an id in neither shape, so nothing else is ever looked up.
export function slackMessageTargetOf(
  tool: string,
  args: unknown,
): SlackMessageTarget | null {
  if (!SLACK_MESSAGE_TOOLS.has(tool)) return null;
  if (typeof args !== "object" || args === null) return null;
  const id = (args as Record<string, unknown>)["channel_id"];
  if (typeof id !== "string") return null;
  if (SLACK_CONVERSATION_ID.test(id)) return { kind: "conversation", id };
  if (SLACK_PERSON_ID.test(id)) return { kind: "person", id };
  return null;
}
