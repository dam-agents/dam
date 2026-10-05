export interface SlackImageFile {
  id: string;
  name: string;
  mimetype: string;
  url_private: string;
  size: number;
}

export class FileTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`file is larger than ${maxBytes} bytes`);
    this.name = "FileTooLargeError";
  }
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The Slack workspace a call acts for, by its team
 * id. Every outbound call names one, and a workspace with no install row —
 * including the empty string, which Slack never sends — resolves to no
 * credential.
 */
export type SlackWorkspace = string;

export interface SlackMentionEvent {
  user?: string;
  channel: string;
  ts: string;
  threadTs?: string;
  text: string;
  files?: SlackImageFile[];
  teamId: SlackWorkspace;
  channelType?: string;
}

export interface SlackSlashCommand {
  text: string;
  userId: string;
  channelId: string;
  channelName?: string;
  teamId: SlackWorkspace;
  triggerId: string;
}

export type SlackChannelMessageEvent = SlackMentionEvent;

export type SlackAck = (response?: { text: string }) => Promise<void>;

export type SlackTokenResolver = (
  teamId: SlackWorkspace,
) => Promise<string | null>;

export interface SlackBotJoinedChannelEvent {
  channel: string;
  inviter?: string;
  teamId: SlackWorkspace;
}

export interface SlackGatewayHandlers {
  onMention: (event: SlackMentionEvent) => Promise<void>;
  onCommand: (command: SlackSlashCommand, ack: SlackAck) => Promise<void>;
  onMessage: (event: SlackChannelMessageEvent) => Promise<void>;
  onDirectMessage: (event: SlackChannelMessageEvent) => Promise<void>;
  onBotJoinedChannel: (event: SlackBotJoinedChannelEvent) => Promise<void>;
  onViewSubmission: (event: SlackViewSubmission) => Promise<void>;
}

export interface SlackViewSubmission {
  callbackId: string;
  privateMetadata: string;
  userId: string;
  teamId: SlackWorkspace;
  inputs: Record<string, string>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One page of a thread read, together with whether
 * the messenger had more to give. Slack serves the page from whichever end the
 * read names: given `oldest`, the oldest replies after it; given `latest` or no
 * bound at all, the newest replies before it, so the next page of a read with
 * no bound is older, not newer. Slack's reference suggests every read starts
 * at the oldest end, and it does not. Replies in a page are in the order they
 * were sent. The thread parent comes back in every page, carries the thread's
 * reply count, and does not count towards the limit. Callers that record how
 * far they have read must not infer that from the row count; the adapter
 * reports it from the messenger's own paging signal instead.
 */
export interface SlackThreadRead {
  messages: SlackMessage[];
  hasMore: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A channel read together with whether the messenger
 * had more to give. Messages come back newest first, the order Slack's channel
 * history uses, so a caller that wants them in the order they were sent
 * reverses them itself. The paging signal matters for the same reason it does
 * on a thread read: a caller that records how far it has read must not treat a
 * capped window as the whole channel.
 */
export interface SlackChannelRead {
  messages: SlackMessage[];
  hasMore: boolean;
}

export interface SlackMessageMetadata {
  eventType: string;
  payload: Record<string, unknown>;
}

export interface SlackMessage {
  ts?: string;
  user?: string;
  text?: string;
  blocks?: SlackBlock[];
  edited?: boolean;
  threadTs?: string;
  replyCount?: number;
  latestReplyTs?: string;
  subtype?: string;
  metadata?: SlackMessageMetadata;
}

export type SlackBlock = Record<string, unknown>;

export interface SlackReservedFile {
  fileId: string;
  uploadUrl: string;
}

export interface SlackPostMessage {
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: SlackBlock[];
  replyBroadcast?: boolean;
  teamId: SlackWorkspace;
  unfurlLinks?: boolean;
  unfurlMedia?: boolean;
  username?: string;
  iconUrl?: string;
  metadata?: SlackMessageMetadata;
}

export interface SlackPostEphemeral {
  channel: string;
  user: string;
  threadTs?: string;
  text: string;
  blocks?: SlackBlock[];
  teamId: SlackWorkspace;
  username?: string;
  iconUrl?: string;
}

export interface SlackUpload {
  channelId: string;
  file: Buffer;
  filename: string;
  title?: string;
  initialComment?: string;
  threadTs?: string;
  teamId: SlackWorkspace;
}

export interface SlackStartStream {
  channel: string;
  threadTs: string;
  recipientTeamId: string;
  recipientUserId: string;
  markdownText?: string;
  teamId: SlackWorkspace;
}

export interface SlackAppendStream {
  channel: string;
  ts: string;
  markdownText: string;
  teamId: SlackWorkspace;
}

export interface SlackStopStream {
  channel: string;
  ts: string;
  markdownText?: string;
  blocks?: SlackBlock[];
  teamId: SlackWorkspace;
}

export interface SlackSetStatus {
  channel: string;
  threadTs: string;
  status: string;
  teamId: SlackWorkspace;
}

export interface SlackChannelInfo {
  id: string;
  name: string;
}

export interface SlackConversationRef {
  channelId: string;
  teamId: SlackWorkspace;
}

export interface SlackConversationName extends SlackConversationRef {
  name: string | null;
}

export interface SlackUserInfo {
  id: string;
  username?: string;
  realName?: string;
  displayName?: string;
  title?: string;
  pronouns?: string;
  email?: string;
  timezone?: string;
  timezoneLabel?: string;
  statusText?: string;
  statusEmoji?: string;
  isBot?: boolean;
  isDeleted?: boolean;
}

export interface SlackMessageReaction {
  name: string;
  count: number;
  users: string[];
}

export interface SlackGateway {
  start(handlers: SlackGatewayHandlers): Promise<boolean>;
  stop(): Promise<void>;
  postMessage(args: SlackPostMessage): Promise<{ ts: string } | null>;
  deleteMessage(
    channel: string,
    ts: string,
    teamId: SlackWorkspace,
  ): Promise<boolean>;
  deleteFile(fileId: string, teamId: SlackWorkspace): Promise<void>;
  openModal(args: {
    triggerId: string;
    view: SlackBlock;
    teamId: SlackWorkspace;
  }): Promise<void>;
  postEphemeral(args: SlackPostEphemeral): Promise<void>;
  startStream(args: SlackStartStream): Promise<{ ts: string }>;
  appendStream(args: SlackAppendStream): Promise<void>;
  stopStream(args: SlackStopStream): Promise<void>;
  setStatus(args: SlackSetStatus): Promise<void>;
  addReaction(args: {
    channel: string;
    ts: string;
    name: string;
    teamId: SlackWorkspace;
  }): Promise<void>;
  getThreadReplies(args: {
    channel: string;
    threadTs: string;
    limit: number;
    oldest?: string;
    latest?: string;
    inclusive?: boolean;
    teamId: SlackWorkspace;
  }): Promise<SlackThreadRead>;
  getChannelHistory(args: {
    channel: string;
    limit: number;
    oldest?: string;
    teamId: SlackWorkspace;
  }): Promise<SlackChannelRead>;
  getMessage(args: {
    channel: string;
    ts: string;
    threadTs?: string;
    teamId: SlackWorkspace;
  }): Promise<(SlackMessage & { ts: string }) | null>;
  uploadFile(args: SlackUpload): Promise<void>;
  reserveFile(args: {
    filename: string;
    length: number;
    teamId: SlackWorkspace;
  }): Promise<SlackReservedFile>;
  sendFileBytes(args: {
    reserved: SlackReservedFile;
    file: Buffer;
    filename: string;
    teamId: SlackWorkspace;
  }): Promise<void>;
  shareFile(args: {
    fileId: string;
    filename: string;
    title?: string;
    username?: string;
    iconUrl?: string;
    channelId: string;
    threadTs?: string;
    teamId: SlackWorkspace;
  }): Promise<void>;
  downloadFile(
    urlPrivate: string,
    maxBytes: number,
    teamId: SlackWorkspace,
  ): Promise<ArrayBuffer>;
  listBotChannels(teamId: SlackWorkspace): Promise<SlackChannelInfo[]>;
  getConversationInfo(
    channelId: string,
    teamId: SlackWorkspace,
  ): Promise<{
    isMember: boolean;
    isDirectMessage: boolean;
    name: string | null;
  } | null>;
  listSharedChannels(userId: string, teamId: SlackWorkspace): Promise<string[]>;
  getUserInfo(
    userId: string,
    teamId: SlackWorkspace,
  ): Promise<SlackUserInfo | null>;
  getMessageReactions(
    channel: string,
    ts: string,
    teamId: SlackWorkspace,
  ): Promise<SlackMessageReaction[] | null>;
  openDirectMessage(userId: string, teamId: SlackWorkspace): Promise<string>;
  getPermalink(
    channel: string,
    ts: string,
    teamId: SlackWorkspace,
  ): Promise<string | null>;
  getGrantedScopes(teamId: SlackWorkspace): Promise<Set<string> | null>;
  getBotUserId(teamId: SlackWorkspace): Promise<string | null>;
}
