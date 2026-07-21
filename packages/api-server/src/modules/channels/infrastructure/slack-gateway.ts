export interface SlackImageFile {
  id: string;
  name: string;
  mimetype: string;
  url_private: string;
  size: number;
}

export interface SlackMentionEvent {
  user?: string;
  channel: string;
  ts: string;
  threadTs?: string;
  text: string;
  files?: SlackImageFile[];
}

export interface SlackSlashCommand {
  text: string;
  userId: string;
  channelId: string;
}

/** A plain channel message the bot reads along with (ambient mode). Same
 *  shape as a mention — only the trigger differs. Gateways deliver only
 *  human, non-mention channel messages here: bot posts (including the
 *  agent's own), message edits/joins, DMs, and mentions (those arrive via
 *  `onMention`) are filtered out at the gateway. */
export type SlackChannelMessageEvent = SlackMentionEvent;

export type SlackAck = (response: { text: string }) => Promise<void>;

export interface SlackGatewayHandlers {
  onMention: (event: SlackMentionEvent) => Promise<void>;
  onCommand: (command: SlackSlashCommand, ack: SlackAck) => Promise<void>;
  onMessage: (event: SlackChannelMessageEvent) => Promise<void>;
}

export interface SlackMessage {
  ts?: string;
  user?: string;
  text?: string;
}

export type SlackBlock = Record<string, unknown>;

export interface SlackPostMessage {
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: SlackBlock[];
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

export interface SlackChannelInfo {
  id: string;
  name: string;
}

export interface SlackGateway {
  start(handlers: SlackGatewayHandlers): Promise<boolean>;
  stop(): Promise<void>;
  postMessage(args: SlackPostMessage): Promise<void>;
  postEphemeral(args: SlackPostEphemeral): Promise<void>;
  addReaction(args: {
    channel: string;
    ts: string;
    name: string;
  }): Promise<void>;
  getThreadReplies(args: {
    channel: string;
    threadTs: string;
    limit: number;
  }): Promise<SlackMessage[]>;
  getChannelHistory(args: {
    channel: string;
    limit: number;
  }): Promise<SlackMessage[]>;
  uploadFile(args: SlackUpload): Promise<void>;
  downloadFile(urlPrivate: string): Promise<ArrayBuffer>;
  /** Channels (public + private) the bot is a member of. */
  listBotChannels(): Promise<SlackChannelInfo[]>;
  /** Membership lookup for one conversation; null when Slack can't resolve it. */
  getConversationInfo(channelId: string): Promise<{ isMember: boolean } | null>;
  /** Open (or reuse) the bot's DM with a user; returns the conversation id. */
  openDirectMessage(userId: string): Promise<string>;
}
