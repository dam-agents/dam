import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ChannelType } from "api-server-api";
import { z } from "zod";
import { errorResult, json, run } from "../../core/mcp-tool-result.js";
import type {
  OwnedThreadsResult,
  StartedThread,
  ThreadLeave,
  ThreadStart,
} from "../../modules/channels/services/channel-manager.js";

export interface ThreadToolPorts {
  callerSessionId(): Promise<string | null>;
  startThread(
    channel: ChannelType,
    start: ThreadStart,
  ): Promise<StartedThread | { error: string }>;
  listThreads(
    channel: ChannelType,
    sessionId: string,
  ): Promise<OwnedThreadsResult | { error: string }>;
  leaveThread(
    channel: ChannelType,
    leave: ThreadLeave,
  ): Promise<{ ok: true } | { error: string }>;
  audit(
    action: "start" | "leave",
    outcome: { error: string } | { conversationId: string; threadTs: string },
  ): void;
}

const UNIDENTIFIED =
  "this session could not be identified, so it cannot own a thread; post the message with post instead, and its replies open a session of their own.";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The tools a Session uses to own Slack threads:
 * start one, see the ones it owns, and let one go. Ownership is per Session,
 * so every tool needs the calling Session's id, and refuses when the call
 * carries none rather than owning a thread nobody can be routed to.
 */
export function registerThreadTools(
  server: McpServer,
  ports: ThreadToolPorts,
): void {
  server.tool(
    "start_thread",
    "Start a Slack thread whose replies come back to this session. Posts text as a new top-level message in chatId, and from then on every message anyone posts under it — a person or another agent, tagging you or not — reaches this session as a new turn, also after the current turn ends, so end your turn instead of waiting or polling for an answer. Use it to ask a person or another agent something and act on the answer here; use post for an announcement nobody needs to answer. Answer in the thread with reply, passing its chatId and threadTs. Works from any session, a web chat or a scheduled run too. list_threads shows the threads this session follows, leave_thread stops one. Slack only: Telegram has no threads.",
    {
      channel: z.enum([ChannelType.Slack, ChannelType.Telegram]),
      chatId: z
        .string()
        .min(1)
        .describe(
          "Where to post: a chat id from describe_channel, or a Slack user id (U…) for a direct message — only with your owner, the person in a 1:1 DM you are connected to, or a member of a channel you are connected to.",
        ),
      text: z
        .string()
        .min(1)
        .describe(
          "The opening message, in standard Markdown. Say who should answer, and tag them when they should be notified.",
        ),
    },
    ({ channel, chatId, text }) =>
      run(async () => {
        const sessionId = await ports.callerSessionId();
        if (!sessionId) return errorResult(UNIDENTIFIED);
        const result = await ports.startThread(channel, {
          sessionId,
          conversationId: chatId,
          text,
        });
        ports.audit("start", result);
        if ("error" in result) return errorResult(result.error);
        return json({
          chatId: result.conversationId,
          threadTs: result.threadTs,
          replies:
            "every message in this thread comes back to this session as a new turn; end your turn now instead of waiting",
        });
      }),
  );

  server.tool(
    "list_threads",
    "List the Slack threads this session started with start_thread and still follows: chatId, threadTs, the first line, when it started, how many replies it has, when it last moved, and whether a reply arrived that has not reached this session yet. read_thread reads any of them in full. Slack only.",
    { channel: z.enum([ChannelType.Slack, ChannelType.Telegram]) },
    ({ channel }) =>
      run(async () => {
        const sessionId = await ports.callerSessionId();
        if (!sessionId) return errorResult(UNIDENTIFIED);
        const result = await ports.listThreads(channel, sessionId);
        if ("error" in result) return errorResult(result.error);
        return json({
          threads: result.threads.map((t) => ({
            chatId: t.conversationId,
            threadTs: t.threadTs,
            firstLine: t.firstLine,
            startedAt: t.startedAt,
            ...(t.replies !== undefined && { replies: t.replies }),
            ...(t.lastActivityAt !== undefined && {
              lastActivityAt: t.lastActivityAt,
            }),
            ...(t.replyWaiting !== undefined && {
              replyWaiting: t.replyWaiting,
            }),
          })),
        });
      }),
  );

  server.tool(
    "leave_thread",
    "Stop following a Slack thread this session started: later messages in it no longer come back here. A message there that tags you then opens a session of its own, as in any thread. Slack only.",
    {
      channel: z.enum([ChannelType.Slack, ChannelType.Telegram]),
      chatId: z
        .string()
        .min(1)
        .describe("The thread's chatId, from list_threads."),
      threadTs: z
        .string()
        .min(1)
        .describe("The thread's threadTs, from list_threads."),
    },
    ({ channel, chatId, threadTs }) =>
      run(async () => {
        const sessionId = await ports.callerSessionId();
        if (!sessionId) return errorResult(UNIDENTIFIED);
        const result = await ports.leaveThread(channel, {
          sessionId,
          conversationId: chatId,
          threadTs,
        });
        ports.audit(
          "leave",
          "error" in result ? result : { conversationId: chatId, threadTs },
        );
        if ("error" in result) return errorResult(result.error);
        return json({ left: true, chatId, threadTs });
      }),
  );
}
