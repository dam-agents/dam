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
 * UNIT_BOUNDARY_DESCRIPTION: The Slack workspace a call acts for. The empty
 * string is the install's original workspace — the one whose bot token the
 * operator set in Helm values, and the one every binding made before this
 * platform could install itself anywhere else belongs to. Keeping it a value
 * rather than an absent field is what lets a caller never have "no workspace":
 * every outbound call names one, and the resolver answers for it without
 * asking Slack who the operator's token belongs to.
 */
export type SlackWorkspace = string;

export const ORIGINAL_WORKSPACE: SlackWorkspace = "";

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
  teamId: SlackWorkspace;
}

export type SlackChannelMessageEvent = SlackMentionEvent;

export type SlackAck = (response: { text: string }) => Promise<void>;

export type SlackTokenResolver = (
  teamId: SlackWorkspace,
) => Promise<string | null>;

export interface SlackGatewayHandlers {
  onMention: (event: SlackMentionEvent) => Promise<void>;
  onCommand: (command: SlackSlashCommand, ack: SlackAck) => Promise<void>;
  onMessage: (event: SlackChannelMessageEvent) => Promise<void>;
  onDirectMessage: (event: SlackChannelMessageEvent) => Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A thread read together with whether the messenger
 * had more to give. Callers that record how far they have read must not infer
 * that from the row count: Slack returns the thread parent in every page, so a
 * count reads one high, and a full page is not proof of a full window either.
 * The adapter reports it from the messenger's own paging signal instead.
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

export const THREAD_TAIL_MAX_PAGES = 20;

export interface SlackMessage {
  ts?: string;
  user?: string;
  text?: string;
  blocks?: SlackBlock[];
  edited?: boolean;
}

export type SlackBlock = Record<string, unknown>;

export interface SlackPostMessage {
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: SlackBlock[];
  replyBroadcast?: boolean;
  teamId: SlackWorkspace;
}

export interface SlackPostEphemeral {
  channel: string;
  user: string;
  threadTs?: string;
  text: string;
  teamId: SlackWorkspace;
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
  postMessage(args: SlackPostMessage): Promise<void>;
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
    teamId: SlackWorkspace;
  }): Promise<SlackThreadRead>;
  getThreadTail(args: {
    channel: string;
    threadTs: string;
    limit: number;
    maxPages?: number;
    teamId: SlackWorkspace;
  }): Promise<SlackThreadRead>;
  getChannelHistory(args: {
    channel: string;
    limit: number;
    oldest?: string;
    teamId: SlackWorkspace;
  }): Promise<SlackChannelRead>;
  uploadFile(args: SlackUpload): Promise<void>;
  downloadFile(
    urlPrivate: string,
    maxBytes: number,
    teamId: SlackWorkspace,
  ): Promise<ArrayBuffer>;
  listBotChannels(teamId: SlackWorkspace): Promise<SlackChannelInfo[]>;
  getConversationInfo(
    channelId: string,
    teamId: SlackWorkspace,
  ): Promise<{ isMember: boolean } | null>;
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
  identifyWorkspace(botToken: string): Promise<string | null>;
}
