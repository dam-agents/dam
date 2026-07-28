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
  /** Workspace (team) id the event originated from. Slack requires it to
   *  stream a reply into a channel; absent → the reply is posted whole. */
  teamId?: string;
  /** Slack conversation type: `channel`/`group` (public/private channel),
   *  `mpim` (group DM), `im` (1:1 DM). Absent when Slack omits it (some
   *  `app_mention` payloads). Lets the worker tailor DM/group-DM copy. */
  channelType?: string;
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
  /** A plain message in a 1:1 DM (`message.im`). Every DM message is addressed
   *  to the bot, so a bound DM relays it like a mention — no @mention needed.
   *  Same gateway filtering as `onMessage` (bot posts, subtypes, and messages
   *  that @mention the bot — those arrive via `onMention` — are dropped). */
  onDirectMessage: (event: SlackChannelMessageEvent) => Promise<void>;
}

export interface SlackMessage {
  ts?: string;
  user?: string;
  text?: string;
  /** Layout blocks, when present. Carries the agent-attribution footer so the
   *  author of a bot post can be recovered from injected history (every agent
   *  posts under the same install-wide bot user id). */
  blocks?: SlackBlock[];
  /** Whether Slack reports this message as edited since it was first posted. */
  edited?: boolean;
}

export type SlackBlock = Record<string, unknown>;

export interface SlackPostMessage {
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: SlackBlock[];
  /** Slack's "Also send to channel": the threaded reply is one post that also
   *  surfaces in the channel. Slack ignores it without a `threadTs`. */
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
  /** Slack requires both recipient ids to stream into a channel (vs a DM). */
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
  /** Appended after the streamed text when the message is finalized. */
  blocks?: SlackBlock[];
}

export interface SlackSetStatus {
  channel: string;
  threadTs: string;
  /** Rendered as "<App Name> <status>"; empty string clears the status. */
  status: string;
}

export interface SlackChannelInfo {
  id: string;
  name: string;
}

/** Directory profile of a workspace member, as `users.info` reports it. Every
 *  field but the id is optional — Slack omits what the person never filled in
 *  and what the app's scopes don't cover (email needs `users:read.email`). */
export interface SlackUserInfo {
  id: string;
  /** Slack handle, without the leading `@`. */
  username?: string;
  realName?: string;
  displayName?: string;
  title?: string;
  pronouns?: string;
  email?: string;
  /** IANA zone (e.g. `Europe/Prague`) and its human label. */
  timezone?: string;
  timezoneLabel?: string;
  statusText?: string;
  statusEmoji?: string;
  isBot?: boolean;
  isDeleted?: boolean;
}

/** One emoji reaction on a message, as `reactions.get` reports it. */
export interface SlackMessageReaction {
  /** Emoji short name, no colons (e.g. `eyes`). */
  name: string;
  count: number;
  /** User ids who used this reaction. */
  users: string[];
}

export interface SlackGateway {
  start(handlers: SlackGatewayHandlers): Promise<boolean>;
  stop(): Promise<void>;
  postMessage(args: SlackPostMessage): Promise<void>;
  postEphemeral(args: SlackPostEphemeral): Promise<void>;
  /** Opens a streamed message in a thread; returns the message ts to append to. */
  startStream(args: SlackStartStream): Promise<{ ts: string }>;
  appendStream(args: SlackAppendStream): Promise<void>;
  stopStream(args: SlackStopStream): Promise<void>;
  /** Live "<App Name> is thinking…"-style status under the latest message. */
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
  /** Directory lookup for one workspace member; null when Slack can't resolve
   *  the id (deactivated-and-purged, another workspace, or simply wrong). */
  getUserInfo(userId: string): Promise<SlackUserInfo | null>;
  /** Reactions on one message, via `reactions.get`; null when the message
   *  can't be found (wrong ts, or a conversation the bot can't see into). */
  getMessageReactions(
    channel: string,
    ts: string,
  ): Promise<SlackMessageReaction[] | null>;
  /** Open (or reuse) the bot's DM with a user; returns the conversation id. */
  openDirectMessage(userId: string): Promise<string>;
  /** A permanent link to one message, via `chat.getPermalink`; null when
   *  Slack can't resolve it (wrong ts, or a conversation the bot can't see
   *  into) rather than throwing — a missing link degrades the turn contract,
   *  it doesn't fail it. */
  getPermalink(channel: string, ts: string): Promise<string | null>;
  /** Bot-token OAuth scopes Slack currently reports as granted — the
   *  install's actual permission set, read from the `x-oauth-scopes` header
   *  Slack attaches to every Web API response, as opposed to what the app
   *  manifest asks for. Null when it can't be determined (bot not running,
   *  or the probe itself failed); treat that as "unknown", not "missing". */
  getGrantedScopes(): Promise<Set<string> | null>;
}
