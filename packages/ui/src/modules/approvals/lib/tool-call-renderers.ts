import {
  MCP_TOOL_CALL_ARGUMENTS_MAX_BYTES,
  type McpToolCallPayload,
} from "api-server-api";

export type SlackDelivery =
  { kind: "post" } | { kind: "draft" } | { kind: "scheduled"; at: Date };

export interface SlackMessageCall {
  kind: "slack-message";
  delivery: SlackDelivery;
  target: { kind: "person" | "conversation"; id: string; label: string | null };
  threadTs: string | null;
  alsoToChannel: boolean;
  text: string;
}

export type ToolCallVerb = "post" | "schedule" | "draft";

export interface TemplateToolCall {
  iconSlug: string;
  action: string;
  verb: ToolCallVerb;
  message: SlackMessageCall | null;
}

type ArgumentsRecord = Readonly<Record<string, unknown>>;

interface ToolRenderer {
  render: (
    args: ArgumentsRecord,
    targetLabel: string | null,
  ) => SlackMessageCall | null;
  action: (message: SlackMessageCall | null) => string;
  verb: ToolCallVerb;
}

interface TemplateRenderers {
  iconSlug: string;
  tools: Readonly<Partial<Record<string, ToolRenderer>>>;
}

const SLACK_DIRECT_MESSAGE_ID = /^[UWD][A-Z0-9]+$/;

const optionalString = (value: unknown): string | null | undefined =>
  value === undefined ? null : typeof value === "string" ? value : undefined;

function slackMessage(
  args: ArgumentsRecord,
  targetLabel: string | null,
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
      kind: SLACK_DIRECT_MESSAGE_ID.test(channelId) ? "person" : "conversation",
      id: channelId,
      label: targetLabel,
    },
    threadTs,
    alsoToChannel: threadTs !== null && broadcast,
    text,
  };
}

function slackScheduledMessage(
  args: ArgumentsRecord,
  targetLabel: string | null,
): SlackMessageCall | null {
  const postAt = args["post_at"];
  if (typeof postAt !== "number" || !Number.isFinite(postAt)) return null;
  return slackMessage(args, targetLabel, {
    kind: "scheduled",
    at: new Date(postAt * 1000),
  });
}

const RENDERERS: Readonly<Partial<Record<string, TemplateRenderers>>> = {
  slack: {
    iconSlug: "slack",
    tools: {
      slack_send_message: {
        render: (args, targetLabel) =>
          slackMessage(args, targetLabel, { kind: "post" }),
        action: (message) =>
          message?.threadTs
            ? "reply in a Slack thread"
            : "send a Slack message",
        verb: "post",
      },
      slack_send_message_draft: {
        render: (args, targetLabel) =>
          slackMessage(args, targetLabel, { kind: "draft" }),
        action: () => "save a Slack draft",
        verb: "draft",
      },
      slack_schedule_message: {
        render: slackScheduledMessage,
        action: () => "schedule a Slack message",
        verb: "schedule",
      },
    },
  },
};

const isRecord = (value: unknown): value is ArgumentsRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// UNIT_BOUNDARY_DESCRIPTION: how a tool-call approval shows a call that its Connection's Template knows. A Template registers a renderer per tool: its logo, what the call does in plain words for the headline, such as "send a Slack message", the verb its answer buttons name (post, schedule or save a draft), and the arguments read as what the call will do, such as the Slack message a post sends, named by the target label the api-server looked up when there is one. The message is null when the arguments are cut, gone or not in the shape the renderer expects. Every other tool, and every tool of a Template with no renderers, returns null and shows as the generic tool name and JSON.
export function templateToolCallOf(
  payload: McpToolCallPayload,
): TemplateToolCall | null {
  const template =
    payload.templateId === null ? undefined : RENDERERS[payload.templateId];
  const renderer = template?.tools[payload.tool];
  if (!template || !renderer) return null;
  const args = payload.arguments;
  const message =
    payload.argumentsBytes <= MCP_TOOL_CALL_ARGUMENTS_MAX_BYTES &&
    isRecord(args)
      ? renderer.render(args, payload.targetLabel ?? null)
      : null;
  return {
    iconSlug: template.iconSlug,
    action: renderer.action(message),
    verb: renderer.verb,
    message,
  };
}
