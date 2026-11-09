import { z } from "zod";
import { ChannelType } from "api-server-api";

export interface ChannelAttachment {
  filename: string;
  data: Buffer;
  mimeType?: string;
  title?: string;
}

export interface PostMessageOptions {
  conversationId?: string;
  attachment?: ChannelAttachment;
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
}

export interface ChannelReply {
  text: string;
  threadTs?: string;
  conversationId?: string;
  alsoSendToChannel?: boolean;
  attachment?: ChannelAttachment;
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
}

export interface ChannelReaction {
  emoji: string;
  messageTs?: string;
  conversationId?: string;
}

export const sendResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    attachmentError: z.string().optional(),
    conversationId: z.string().optional(),
    ts: z.string().optional(),
  }),
  z.object({ error: z.string() }),
]);
export type ChannelSendResult = z.infer<typeof sendResultSchema>;

export const channelUserSchema = z.object({
  id: z.string(),
  username: z.string().optional(),
  realName: z.string().optional(),
  displayName: z.string().optional(),
  title: z.string().optional(),
  pronouns: z.string().optional(),
  email: z.string().optional(),
  timezone: z.string().optional(),
  timezoneLabel: z.string().optional(),
  statusText: z.string().optional(),
  statusEmoji: z.string().optional(),
  isBot: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  error: z.string().optional(),
});
export type ChannelUser = z.infer<typeof channelUserSchema>;

export interface ChannelMessageReaction {
  name: string;
  count: number;
  users: string[];
}

export interface ReactionsQuery {
  conversationId?: string;
  messageTs?: string;
}

export const messageReactionsResultSchema = z.object({
  reactions: z.array(
    z.object({
      name: z.string(),
      count: z.number(),
      users: z.array(z.string()),
    }),
  ),
  conversationId: z.string(),
  messageTs: z.string(),
});
export type MessageReactionsResult = z.infer<
  typeof messageReactionsResultSchema
>;

export interface MessageLinkQuery {
  conversationId?: string;
  messageTs: string;
}

export const messageLinkResultSchema = z.object({
  link: z.string(),
  conversationId: z.string(),
  messageTs: z.string(),
});
export type MessageLinkResult = z.infer<typeof messageLinkResultSchema>;

export interface ThreadQuery {
  threadTs: string;
  cursor?: string;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One window of a thread as the reading Agent gets
 * it. `hasMore` says the window is not the whole thread and `cursor` is how to
 * reach the rest, so the two together say which end is missing: a cursor means
 * the remainder sits before this window, and its absence under `hasMore` means
 * the thread is longer than a read can walk and nothing reaches the newest
 * replies. That second state carries no handle on purpose. The window returned
 * there is a slice from the middle whose position the platform cannot vouch
 * for, and a handle inviting a walk from it would send the Agent back through
 * the wrong part of a thread whose end it never saw.
 */
export const threadResultSchema = z.object({
  messages: z.array(z.string()),
  conversationId: z.string(),
  threadTs: z.string(),
  hasMore: z.boolean(),
  cursor: z.string().optional(),
});
export type ThreadResult = z.infer<typeof threadResultSchema>;

export interface ChannelHistoryQuery {
  conversationId?: string;
  cursor?: string;
  since?: string;
  until?: string;
}

export const channelHistoryResultSchema = z.object({
  messages: z.array(z.string()),
  conversationId: z.string(),
  hasMore: z.boolean(),
  cursor: z.string().optional(),
});
export type ChannelHistoryResult = z.infer<typeof channelHistoryResultSchema>;

export interface ThreadStart {
  sessionId: string;
  conversationId: string;
  text: string;
}

export const startedThreadSchema = z.object({
  ok: z.literal(true),
  conversationId: z.string(),
  threadTs: z.string(),
});
export type StartedThread = z.infer<typeof startedThreadSchema>;

/**
 * UNIT_BOUNDARY_DESCRIPTION: One thread a Session started, as list_threads
 * reports it. `replies` and `lastActivityAt` come from Slack at the time of
 * the call and are absent when Slack did not answer; `replyWaiting` says a
 * message from someone else arrived after the newest one the Session was
 * handed, so a turn for it is still to come or was lost and will be caught up.
 */
export const ownedThreadSchema = z.object({
  conversationId: z.string(),
  threadTs: z.string(),
  firstLine: z.string(),
  startedAt: z.string(),
  replies: z.number().optional(),
  lastActivityAt: z.string().optional(),
  replyWaiting: z.boolean().optional(),
});
export type OwnedThreadSummary = z.infer<typeof ownedThreadSchema>;

export const ownedThreadsResultSchema = z.object({
  threads: z.array(ownedThreadSchema),
});
export type OwnedThreadsResult = z.infer<typeof ownedThreadsResultSchema>;

export interface ThreadLeave {
  sessionId: string;
  conversationId: string;
  threadTs: string;
}

export interface AttachmentQuery {
  fileId: string;
}

export const attachmentResultSchema = z.object({
  path: z.string(),
  name: z.string(),
  size: z.number(),
  contentType: z.string().optional(),
  conversationId: z.string(),
});
export type AttachmentResult = z.infer<typeof attachmentResultSchema>;

export interface PersonNotice {
  slack: string;
  telegram?: string;
}

export type WireAttachment = Omit<ChannelAttachment, "data"> & {
  dataKey: string;
};

export interface ChannelWorker {
  type: ChannelType;
  stopAll(): Promise<void>;
  listConversations(
    instanceName: string,
  ): Promise<{ id: string; title: string }[]>;
  postMessage(
    instanceName: string,
    text: string,
    options?: PostMessageOptions,
  ): Promise<ChannelSendResult>;
  notifyPerson(keycloakSub: string, text: string): Promise<{ sent: number }>;
}

export interface AddressedWorker {
  reply(instanceName: string, reply: ChannelReply): Promise<ChannelSendResult>;
  react(
    instanceName: string,
    reaction: ChannelReaction,
  ): Promise<{ ok: true } | { error: string }>;
  declineTurn(
    instanceName: string,
    threadTs?: string,
  ): Promise<{ ok: true } | { error: string }>;
  handOffTurn(
    instanceName: string,
    threadTs: string,
    targetName: string,
    note?: string,
  ): Promise<{ ok: true; agent: string } | { error: string }>;
  describeUsers(
    instanceName: string,
    userIds: string[],
    conversationId?: string,
  ): Promise<{ users: ChannelUser[] } | { error: string }>;
  describeMessageReactions(
    instanceName: string,
    query: ReactionsQuery,
  ): Promise<MessageReactionsResult | { error: string }>;
  getMessageLink(
    instanceName: string,
    query: MessageLinkQuery,
  ): Promise<MessageLinkResult | { error: string }>;
  readThread(
    instanceName: string,
    query: ThreadQuery,
  ): Promise<ThreadResult | { error: string }>;
  readChannelHistory(
    instanceName: string,
    query: ChannelHistoryQuery,
  ): Promise<ChannelHistoryResult | { error: string }>;
  fetchAttachment(
    instanceName: string,
    query: AttachmentQuery,
  ): Promise<AttachmentResult | { error: string }>;
  startThread(
    instanceName: string,
    start: ThreadStart,
  ): Promise<StartedThread | { error: string }>;
  listThreads(
    instanceName: string,
    sessionId: string,
  ): Promise<OwnedThreadsResult | { error: string }>;
  leaveThread(
    instanceName: string,
    leave: ThreadLeave,
  ): Promise<{ ok: true } | { error: string }>;
}
