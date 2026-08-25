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

export interface SlackMentionEvent {
  user?: string;
  channel: string;
  ts: string;
  threadTs?: string;
  text: string;
  files?: SlackImageFile[];
  teamId?: string;
  channelType?: string;
}

export interface SlackSlashCommand {
  text: string;
  userId: string;
  channelId: string;
}

export type SlackChannelMessageEvent = SlackMentionEvent;

export type SlackAck = (response: { text: string }) => Promise<void>;

export interface SlackGatewayHandlers {
  onMention: (event: SlackMentionEvent) => Promise<void>;
  onCommand: (command: SlackSlashCommand, ack: SlackAck) => Promise<void>;
  onMessage: (event: SlackChannelMessageEvent) => Promise<void>;
  onDirectMessage: (event: SlackChannelMessageEvent) => Promise<void>;
}

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
}

export interface SlackPostEphemeral {
  channel: string;
  user: string;
  threadTs?: string;
  text: string;
}

export interface SlackUpload {
  channelId: string;
  file: Buffer;
  filename: string;
  title?: string;
  initialComment?: string;
}

export interface SlackStartStream {
  channel: string;
  threadTs: string;
  recipientTeamId: string;
  recipientUserId: string;
  markdownText?: string;
}

export interface SlackAppendStream {
  channel: string;
  ts: string;
  markdownText: string;
}

export interface SlackStopStream {
  channel: string;
  ts: string;
  markdownText?: string;
  blocks?: SlackBlock[];
}

export interface SlackSetStatus {
  channel: string;
  threadTs: string;
  status: string;
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
  }): Promise<void>;
  getThreadReplies(args: {
    channel: string;
    threadTs: string;
    limit: number;
    oldest?: string;
  }): Promise<SlackMessage[]>;
  getChannelHistory(args: {
    channel: string;
    limit: number;
  }): Promise<SlackMessage[]>;
  uploadFile(args: SlackUpload): Promise<void>;
  downloadFile(urlPrivate: string, maxBytes: number): Promise<ArrayBuffer>;
  listBotChannels(): Promise<SlackChannelInfo[]>;
  getConversationInfo(channelId: string): Promise<{ isMember: boolean } | null>;
  getUserInfo(userId: string): Promise<SlackUserInfo | null>;
  getMessageReactions(
    channel: string,
    ts: string,
  ): Promise<SlackMessageReaction[] | null>;
  openDirectMessage(userId: string): Promise<string>;
  getPermalink(channel: string, ts: string): Promise<string | null>;
  getGrantedScopes(): Promise<Set<string> | null>;
  getBotUserId(): Promise<string | null>;
}
