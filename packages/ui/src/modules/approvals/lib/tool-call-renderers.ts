import type { McpToolCallPayload } from "api-server-api";

export type SlackDelivery =
  { kind: "post" } | { kind: "draft" } | { kind: "scheduled"; at: Date };

export interface SlackMessageCall {
  kind: "slack-message";
  delivery: SlackDelivery;
  target: { kind: "person" | "conversation"; id: string };
  threadTs: string | null;
  alsoToChannel: boolean;
  text: string;
}

export type ToolCallPresentation = { kind: "generic" } | SlackMessageCall;

type ArgumentsRecord = Readonly<Record<string, unknown>>;
type ToolCallRenderer = (args: ArgumentsRecord) => ToolCallPresentation | null;

const SLACK_PERSON_ID = /^[UW][A-Z0-9]+$/;

const optionalString = (value: unknown): string | null | undefined =>
  value === undefined ? null : typeof value === "string" ? value : undefined;

function slackMessage(
  args: ArgumentsRecord,
  delivery: SlackDelivery,
): SlackMessageCall | null {
  const channelId = args["channel_id"];
  const text = args["message"];
  const threadTs = optionalString(args["thread_ts"]);
  const broadcast = args["reply_broadcast"] ?? false;
  if (typeof channelId !== "string" || channelId === "") return null;
  if (typeof text !== "string") return null;
  if (threadTs === undefined || typeof broadcast !== "boolean") return null;
  return {
    kind: "slack-message",
    delivery,
    target: {
      kind: SLACK_PERSON_ID.test(channelId) ? "person" : "conversation",
      id: channelId,
    },
    threadTs,
    alsoToChannel: threadTs !== null && broadcast,
    text,
  };
}

const slackScheduledMessage: ToolCallRenderer = (args) => {
  const postAt = args["post_at"];
  if (typeof postAt !== "number" || !Number.isFinite(postAt)) return null;
  return slackMessage(args, {
    kind: "scheduled",
    at: new Date(postAt * 1000),
  });
};

const RENDERERS: Readonly<
  Partial<Record<string, Readonly<Partial<Record<string, ToolCallRenderer>>>>>
> = {
  slack: {
    slack_send_message: (args) => slackMessage(args, { kind: "post" }),
    slack_send_message_draft: (args) => slackMessage(args, { kind: "draft" }),
    slack_schedule_message: slackScheduledMessage,
  },
};

const isRecord = (value: unknown): value is ArgumentsRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// UNIT_BOUNDARY_DESCRIPTION: how a tool-call approval shows its call. A Template can register a renderer per tool that reads the arguments as what the call will do, such as the Slack message a post sends; every other tool, and a call whose arguments are cut, gone or not in the shape the renderer expects, shows as the generic tool name and JSON.
export function toolCallPresentationOf(
  payload: McpToolCallPayload,
  args: unknown,
): ToolCallPresentation {
  const render =
    payload.templateId === null
      ? undefined
      : RENDERERS[payload.templateId]?.[payload.tool];
  if (!render || !isRecord(args)) return { kind: "generic" };
  return render(args) ?? { kind: "generic" };
}
