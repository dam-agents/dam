import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { PodSession, SessionMessageEventPayload } from "agent-runtime-api";
import { z } from "zod";
import { errorResult, json, run } from "../../core/mcp-tool-result.js";

const LIST_DEFAULT = 20;
const LIST_MAX = 50;
const MESSAGE_MAX = 20_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: a message is worth delivering only while the
 * work it steers is still going on. One that waited longer than this is dropped
 * rather than arriving out of context.
 */
const MESSAGE_TTL_MS = 60 * 60 * 1000;

export interface SessionMessageEvent {
  id: string;
  kind: "session-message";
  payload: SessionMessageEventPayload;
  expiresAt: Date;
}

export interface SessionMessagePorts {
  agentId: string;
  listSessions(query: {
    sessionId?: string;
    limit?: number;
  }): Promise<PodSession[]>;
  callerSessionId(): Promise<string | null>;
  acceptsSessionMessages(): Promise<boolean>;
  deliver(event: SessionMessageEvent): Promise<void>;
  now?: () => number;
}

function summary(session: PodSession, caller: string | null) {
  return {
    sessionId: session.sessionId,
    title: session.title,
    type: session.type,
    running: session.running,
    runStartedAt: session.runStartedAt,
    lastActivityAt: session.updatedAt ?? session.createdAt,
    ...(session.sessionId === caller && { current: true }),
  };
}

export function registerSessionMessageTools(
  server: McpServer,
  ports: SessionMessagePorts,
): void {
  server.tool(
    "list_sessions",
    "List this agent's own sessions, most recently active first: id, title, type (regular chat, Slack or Telegram thread, schedule, sub-agent run), whether a turn is running in it right now, and when it was last active. The session making this call is marked current. Use it to find the session a message is for before send_session_message. Covers this agent only, never another agent's sessions.",
    {
      runningOnly: z
        .boolean()
        .optional()
        .describe("Only sessions with a turn running right now."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(LIST_MAX)
        .optional()
        .describe(`Most sessions to return; default ${LIST_DEFAULT}.`),
    },
    ({ runningOnly, limit }) =>
      run(async () => {
        const [sessions, caller] = await Promise.all([
          ports.listSessions({ limit: LIST_MAX }),
          ports.callerSessionId(),
        ]);
        const chats = sessions.filter(
          (s) => s.mode === "chat" && (!runningOnly || s.running),
        );
        return json({
          sessions: chats
            .slice(0, limit ?? LIST_DEFAULT)
            .map((s) => summary(s, caller)),
        });
      }),
  );

  server.tool(
    "send_session_message",
    "Send a message into another of this agent's own sessions, e.g. to tell a session that is working on something that the plan changed. When that session is running a turn, the message joins it at the next point the harness can take it (after the current tool call), as a message typed in the chat does; when it is idle, it starts a new turn there. The receiving session sees which session sent it. Its answer stays in that session and does not come back here. Find the session with list_sessions first. Delivery takes a few seconds; a message not delivered within an hour is dropped.",
    {
      sessionId: z
        .string()
        .min(1)
        .describe("The receiving session's id, from list_sessions."),
      text: z
        .string()
        .min(1)
        .max(MESSAGE_MAX)
        .describe("The message, written for the receiving session to act on."),
    },
    ({ sessionId, text }) =>
      run(async () => {
        const caller = await ports.callerSessionId();
        if (caller === sessionId)
          return errorResult(
            "that is the session making this call; a message to yourself needs no tool.",
          );
        const [target, sender, accepts] = await Promise.all([
          ports.listSessions({ sessionId, limit: 1 }).then((s) => s[0]),
          caller
            ? ports
                .listSessions({ sessionId: caller, limit: 1 })
                .then((s) => s[0])
            : Promise.resolve(undefined),
          ports.acceptsSessionMessages(),
        ]);
        if (!target || target.sessionId !== sessionId)
          return errorResult(
            `this agent has no session ${sessionId}; list_sessions shows the ones it has.`,
          );
        if (target.mode !== "chat")
          return errorResult(
            "that is a terminal session; only a chat session takes messages.",
          );
        if (!accepts)
          return errorResult(
            "this agent's runtime is too old to take messages between sessions; apply its image update first.",
          );
        const at = (ports.now ?? Date.now)();
        const event: SessionMessageEvent = {
          id: `session-message:${ports.agentId}:${randomUUID()}:${at}`,
          kind: "session-message",
          payload: {
            sessionId,
            text,
            from: {
              ...(caller && { sessionId: caller }),
              ...(sender?.title && { title: sender.title }),
              ...(sender && { type: sender.type }),
            },
          },
          expiresAt: new Date(at + MESSAGE_TTL_MS),
        };
        await ports.deliver(event);
        return json({
          sent: true,
          sessionId,
          running: target.running,
          delivery: target.running
            ? "joins the running turn at its next steer point, or starts the next turn if that one ends first"
            : "starts a new turn in that session",
        });
      }),
  );
}
