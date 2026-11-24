import type { McpToolCallPayload } from "api-server-api";
import { match } from "ts-pattern";

import { formatDateTime } from "../../../lib/format-time.js";
import {
  type SlackMessageCall,
  type TemplateToolCall,
  templateToolCallOf,
} from "./tool-call-renderers.js";

export interface ToolCallAnswerCopy {
  label: string;
  done: string;
}

export interface ToolCallCardCopy {
  title: { verb: string; object: string | null };
  subtitle: string;
  stamps: readonly string[];
  allow: ToolCallAnswerCopy;
  deny: ToolCallAnswerCopy;
}

export interface ToolCallCardContext {
  agentName: string;
  actor: string;
  accountLabel: string | null;
}

const scheduledTime = (at: Date): string =>
  formatDateTime(at, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });

const targetName = (message: SlackMessageCall): string =>
  message.target.label ?? message.target.id;

const isPerson = (message: SlackMessageCall): boolean =>
  message.target.kind === "person";

function threadPlace(message: SlackMessageCall): string | null {
  if (message.threadTs === null) return null;
  return isPerson(message) ? "in a thread with" : "in a thread in";
}

function placeOf(message: SlackMessageCall): string {
  const thread = threadPlace(message);
  if (thread) return `${thread} ${targetName(message)}`;
  return `${isPerson(message) ? "to" : "in"} ${targetName(message)}`;
}

function messageVerb(call: TemplateToolCall, message: SlackMessageCall) {
  const thread = threadPlace(message);
  const person = isPerson(message);
  return match(call.verb)
    .with("post", () =>
      thread
        ? `reply ${thread}`
        : person
          ? "send a direct message to"
          : "post in",
    )
    .with("schedule", () =>
      thread
        ? `schedule a reply ${thread}`
        : person
          ? "schedule a direct message to"
          : "schedule a post in",
    )
    .with("draft", () =>
      thread
        ? `save a draft reply ${thread}`
        : person
          ? "save a draft direct message to"
          : "save a draft in",
    )
    .exhaustive();
}

function messageStamps(
  call: TemplateToolCall,
  message: SlackMessageCall,
): string[] {
  const when = match(message.delivery)
    .with({ kind: "post" }, () => "Goes out now")
    .with({ kind: "scheduled" }, ({ at }) => `Goes out ${scheduledTime(at)}`)
    .with({ kind: "draft" }, () => "Saved as a draft, not sent")
    .exhaustive();
  return [
    when,
    ...(message.threadTs !== null ? ["In a thread"] : []),
    ...(message.alsoToChannel ? ["Also sent to the conversation"] : []),
  ];
}

function answers(
  call: TemplateToolCall,
  context: ToolCallCardContext,
): { allow: ToolCallAnswerCopy; deny: ToolCallAnswerCopy } {
  const { message } = call;
  const place = message ? ` ${placeOf(message)}` : "";
  const told = `${context.agentName} was told.`;
  return match(call.verb)
    .with("post", () => ({
      allow: { label: "Post", done: `Posted${place} as ${context.actor}` },
      deny: { label: "Don't post", done: `Not posted. ${told}` },
    }))
    .with("schedule", () => ({
      allow: {
        label: "Schedule",
        done:
          message?.delivery.kind === "scheduled"
            ? `Scheduled for ${scheduledTime(message.delivery.at)}${place}`
            : "Scheduled",
      },
      deny: { label: "Don't schedule", done: `Not scheduled. ${told}` },
    }))
    .with("draft", () => ({
      allow: { label: "Save draft", done: `Saved as a draft${place}` },
      deny: { label: "Don't save", done: `Not saved. ${told}` },
    }))
    .exhaustive();
}

const onConnection = (
  payload: McpToolCallPayload,
  context: ToolCallCardContext,
): string => `On ${payload.connectionName}, as ${context.actor}`;

function templateCopy(
  payload: McpToolCallPayload,
  call: TemplateToolCall,
  context: ToolCallCardContext,
): ToolCallCardCopy {
  const { message } = call;
  return {
    title: message
      ? {
          verb: `wants to ${messageVerb(call, message)}`,
          object: targetName(message),
        }
      : { verb: `wants to ${call.action}`, object: null },
    subtitle:
      context.actor === "you" && context.accountLabel
        ? `As you, ${context.accountLabel}`
        : onConnection(payload, context),
    stamps: message ? messageStamps(call, message) : [],
    ...answers(call, context),
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the words of a tool-call approval card, the same in the chat and on Home. The title says who wants to do what where ("Standup writer wants to post in #launch-team"), the line under it the account the call acts as, the stamps when and how a message goes out, and the two buttons name the action ("Post" / "Don't post") with the line the card shows after the answer. A tool with no renderer of its own keeps "Allow once" / "Deny". `actor` is "you" for the owner and the owner's email for an Agent Editor, since the call runs with the owner's Connection.
export function toolCallCardCopy(
  payload: McpToolCallPayload,
  context: ToolCallCardContext,
): ToolCallCardCopy {
  const call = templateToolCallOf(payload);
  if (call) return templateCopy(payload, call, context);
  return {
    title: { verb: "wants to use", object: payload.tool },
    subtitle: onConnection(payload, context),
    stamps: [],
    allow: { label: "Allow once", done: `Allowed once: ${payload.tool}` },
    deny: { label: "Deny", done: `Denied. ${context.agentName} was told.` },
  };
}
