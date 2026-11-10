import { PLATFORM_REFUSAL_HEADER } from "api-server-api";
import type { MessagesEndpoint } from "./web-search-request.js";

export interface WebSearchRefusal {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const MESSAGE_ID = "msg_platform_web_search_refused";
const TOOL_USE_ID = "srvtoolu_platform_web_search_refused";

// UNIT_BOUNDARY_DESCRIPTION: why a web search was refused, in the words the agent reads in the failed search's text and its owner reads in the log. `denied` is the owner's answer to this one search, `rule` the agent's remembered web search rule, `unattended` a scheduled or channel run nobody can answer from, `expired` a hold nobody answered in time, and `child` a sub-agent whose own network allows only what is listed for it.
export type WebSearchRefusalReason =
  "denied" | "rule" | "unattended" | "expired" | "child";

const SETTINGS_HINT =
  "The agent's owner can change this under Web search in the agent's Network settings.";

export function webSearchRefusalText(reason: WebSearchRefusalReason): string {
  const lead =
    "The web search was refused by the platform's egress gateway, not by the search provider.";
  const why = {
    denied: "The agent's owner denied this search.",
    rule: "The agent's web search rule denies every search.",
    unattended:
      "Web search needs the owner's approval, and nobody can give one in a scheduled or channel run. To let this agent search in such runs, the owner chooses Always allow under Web search in the agent's Network settings.",
    expired: "Nobody answered the approval for this search in time.",
    child:
      "This sub-agent's network allows only what is listed for it, and web search is not.",
  }[reason];
  const next =
    "Find the information another way, for example by fetching a page you know.";
  return reason === "unattended"
    ? `${lead} ${why} ${next}`
    : `${lead} ${why} ${next} ${SETTINGS_HINT}`;
}

function messageBody(model: string, query: string | null, text: string) {
  return {
    id: MESSAGE_ID,
    type: "message",
    role: "assistant",
    model,
    content: [
      {
        type: "server_tool_use",
        id: TOOL_USE_ID,
        name: "web_search",
        input: { query: query ?? "" },
      },
      {
        type: "web_search_tool_result",
        tool_use_id: TOOL_USE_ID,
        content: {
          type: "web_search_tool_result_error",
          error_code: "unavailable",
        },
      },
      { type: "text", text },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      server_tool_use: { web_search_requests: 0 },
    },
  };
}

function event(name: string, data: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function eventStream(model: string, query: string | null, text: string) {
  const message = messageBody(model, query, text);
  const [toolUse, result] = message.content;
  return [
    event("message_start", {
      type: "message_start",
      message: {
        ...message,
        content: [],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }),
    event("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { ...toolUse, input: {} },
    }),
    event("content_block_delta", {
      type: "content_block_delta",
      index: 0,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify({ query: query ?? "" }),
      },
    }),
    event("content_block_stop", { type: "content_block_stop", index: 0 }),
    event("content_block_start", {
      type: "content_block_start",
      index: 1,
      content_block: result,
    }),
    event("content_block_stop", { type: "content_block_stop", index: 1 }),
    event("content_block_start", {
      type: "content_block_start",
      index: 2,
      content_block: { type: "text", text: "" },
    }),
    event("content_block_delta", {
      type: "content_block_delta",
      index: 2,
      delta: { type: "text_delta", text },
    }),
    event("content_block_stop", { type: "content_block_stop", index: 2 }),
    event("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 0, server_tool_use: { web_search_requests: 0 } },
    }),
    event("message_stop", { type: "message_stop" }),
  ].join("");
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a refused web search. On the endpoint that creates a message it is a successful reply in the Messages API's own shape whose search failed as unavailable, streamed when the call streams, so the agent reads a failed search and keeps working; a refused model call would end its session. Any other endpoint gets a plain 403 that names the gateway.
export function refusedWebSearch(input: {
  endpoint: MessagesEndpoint;
  stream: boolean;
  model: string;
  query: string | null;
  reason: WebSearchRefusalReason;
}): WebSearchRefusal {
  const text = webSearchRefusalText(input.reason);
  if (input.endpoint !== "messages")
    return {
      status: 403,
      headers: {
        "content-type": "text/plain",
        [PLATFORM_REFUSAL_HEADER]: "web-search",
      },
      body: text,
    };
  return input.stream
    ? {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          [PLATFORM_REFUSAL_HEADER]: "web-search",
        },
        body: eventStream(input.model, input.query, text),
      }
    : {
        status: 200,
        headers: {
          "content-type": "application/json",
          [PLATFORM_REFUSAL_HEADER]: "web-search",
        },
        body: JSON.stringify(messageBody(input.model, input.query, text)),
      };
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a model call whose body the gateway did not send with the check while web search control is on, which happens only while the agent's gateway restarts onto the setting. A retry reaches the restarted gateway, so the answer asks for one.
export function bodyNotReadRefusal(): WebSearchRefusal {
  return {
    status: 503,
    headers: {
      "content-type": "text/plain",
      "retry-after": "5",
      [PLATFORM_REFUSAL_HEADER]: "web-search",
    },
    body: "The platform's egress gateway is restarting to apply web search control, so it could not check this model request. Retry in a few seconds.",
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the answer to a Messages call whose body is not one strict JSON document: the gateway cannot tell whether it declares web search, and a provider might read it another way, so it is refused rather than passed.
export function unreadableBodyRefusal(): WebSearchRefusal {
  return {
    status: 400,
    headers: {
      "content-type": "text/plain",
      "x-should-retry": "false",
      [PLATFORM_REFUSAL_HEADER]: "web-search",
    },
    body: "The platform's egress gateway refused this model request, not the provider: web search control is on for this agent, and the gateway reads a Messages request only as one plain JSON document in UTF-8, with no repeated key and no compression.",
  };
}
