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

export type SlackAck = (response: { text: string }) => Promise<void>;

export interface SlackGatewayHandlers {
  onMention: (event: SlackMentionEvent) => Promise<void>;
  onCommand: (command: SlackSlashCommand, ack: SlackAck) => Promise<void>;
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
}
