import { z } from "zod";
import { ChannelType } from "api-server-api";
import type {
  SlackConversationRef,
  SlackLabelledConversation,
  SlackWorkspace,
} from "../infrastructure/slack-gateway.js";
import type { SlackConversationStanding } from "./slack-workspace-probe.js";

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
  z.object({ ok: z.literal(true), attachmentError: z.string().optional() }),
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
  readThread(
    instanceName: string,
    query: ThreadQuery,
  ): Promise<ThreadResult | { error: string }>;
  fetchAttachment(
    instanceName: string,
    query: AttachmentQuery,
  ): Promise<AttachmentResult | { error: string }>;
}
