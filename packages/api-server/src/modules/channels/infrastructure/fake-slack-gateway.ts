import type { SlackOutboundRecord } from "api-server-api";
import { FileTooLargeError } from "./slack-gateway.js";
import type {
  SlackViewSubmission,
  SlackBotJoinedChannelEvent,
  SlackChannelMessageEvent,
  SlackGateway,
  SlackGatewayHandlers,
  SlackMentionEvent,
  SlackMessage,
  SlackMessageReaction,
  SlackSlashCommand,
  SlackUserInfo,
  SlackWorkspace,
} from "./slack-gateway.js";

export const FAKE_WORKSPACE: SlackWorkspace = "";

export interface FakeSlackChannel {
  id: string;
  name: string;
  botIsMember: boolean;
  members?: string[];
}

export type FiredSlackEvent = Omit<SlackMentionEvent, "teamId"> & {
  teamId?: string;
};
export type FiredSlackCommand = Omit<
  SlackSlashCommand,
  "teamId" | "triggerId"
> & {
  teamId?: string;
  triggerId?: string;
};
export type FiredSlackBotJoin = Omit<SlackBotJoinedChannelEvent, "teamId"> & {
  teamId?: string;
};

export interface FakeSlackGateway extends SlackGateway {
  fireMention(event: FiredSlackEvent): Promise<void>;
  fireMessage(event: FiredSlackEvent): Promise<void>;
  fireDirectMessage(event: FiredSlackEvent): Promise<void>;
  fireCommand(command: FiredSlackCommand): Promise<string>;
  fireBotJoinedChannel(event: FiredSlackBotJoin): Promise<void>;
  fireViewSubmission(event: SlackViewSubmission): Promise<void>;
  readOutbound(): SlackOutboundRecord[];
  resetOutbound(): void;
  setChannels(channels: FakeSlackChannel[], teamId?: string): void;
  setHistory(messages: SlackMessage[]): void;
  setMessage(channel: string, message: SlackMessage & { ts: string }): void;
  setThreadedHistory(messages: SlackMessage[]): void;
  setUsers(users: SlackUserInfo[]): void;
  readUserLookups(): string[];
  setGrantedScopes(scopes: string[] | null): void;
  setBotUserId(id: string | null): void;
  setFileBytes(urlPrivate: string, bytes: Buffer): void;
  setMessageReactions(
    channel: string,
    ts: string,
    reactions: SlackMessageReaction[],
  ): void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: One page and the cursor that follows it. The
 * paging signal is page state — whether a next cursor exists — never a count of
 * the messages handed back, which the gateway contract forbids inferring from
 * because the thread parent rides along in every page. That repeat is modelled
 * on every page but the first, since a caller folding pages together has to
 * cope with it and would not see the need from a fake that tidied it away.
 */
function isAfter(ts: string | undefined, bound: string, inclusive: boolean) {
  if (ts === undefined) return true;
  const at = Number(ts);
  const floor = Number(bound);
  if (!Number.isFinite(at) || !Number.isFinite(floor)) return true;
  return inclusive ? at >= floor : at > floor;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Models one page of Slack's thread read the way the
 * real API serves it, which was checked against Slack itself. A read given
 * `oldest` starts at the oldest end and returns the first replies after it; a
 * read given `latest`, or no bound at all, starts at the newest end and returns
 * the last replies before it. Either way the page is in the order replies were
 * sent, and the parent comes back first, with the thread's reply count, outside
 * the limit. A fake that started every read at the oldest end is what let a
 * thread's oldest replies pass for its end in every test. Whether a fixture
 * models threads at all is its own explicit choice, never read off its
 * contents: setHistory means the history is the thread, setThreadedHistory
 * means reads are exact.
 */
function threadPageOf(
  history: SlackMessage[],
  args: {
    threadTs: string;
    limit: number;
    oldest?: string;
    latest?: string;
    inclusive?: boolean;
  },
  modelsThreads: boolean,
): { messages: SlackMessage[]; hasMore: boolean } {
  const thread = modelsThreads
    ? history.filter(
        (m) => m.ts === args.threadTs || m.threadTs === args.threadTs,
      )
    : [...history];
  const parent = thread.find((m) => m.ts === args.threadTs);
  const replies = thread.filter((m) => m !== parent);
  const inclusive = args.inclusive ?? false;
  const inRange = replies.filter(
    (m) =>
      (args.oldest === undefined || isAfter(m.ts, args.oldest, inclusive)) &&
      (args.latest === undefined ||
        m.ts === undefined ||
        !isAfter(m.ts, args.latest, !inclusive)),
  );
  const page =
    args.oldest !== undefined
      ? inRange.slice(0, args.limit)
      : inRange.slice(Math.max(inRange.length - args.limit, 0));
  return {
    messages: parent
      ? [{ ...parent, replyCount: replies.length }, ...page]
      : page,
    hasMore: inRange.length > page.length,
  };
}

function hiddenInThread(m: SlackMessage): boolean {
  return (
    m.threadTs !== undefined &&
    m.threadTs !== m.ts &&
    m.subtype !== "thread_broadcast"
  );
}

function channelWindowOf(
  history: SlackMessage[],
  oldest: string | undefined,
  modelsThreads: boolean,
): SlackMessage[] {
  const topLevel = modelsThreads
    ? history.filter((m) => !hiddenInThread(m))
    : [...history];
  if (oldest === undefined) return [...topLevel];
  return topLevel.filter((m) => {
    if (m.ts === undefined) return true;
    const at = Number(m.ts);
    const floor = Number(oldest);
    if (!Number.isFinite(at) || !Number.isFinite(floor)) return true;
    return at >= floor;
  });
}

export function createFakeSlackGateway(): FakeSlackGateway {
  let handlers: SlackGatewayHandlers | null = null;
  const outbound: SlackOutboundRecord[] = [];
  const channelsByWorkspace = new Map<string, FakeSlackChannel[]>();
  let history: SlackMessage[] = [];
  let modelsThreads = false;
  let users: SlackUserInfo[] = [];
  const userLookups: string[] = [];
  let nextStreamTs = 1;
  let nextPostTs = 100000;
  const stagedFiles = new Map<string, string>();
  let nextFileId = 1;
  let grantedScopes: Set<string> | null = null;
  let botUserId: string | null = "U-BOT";
  const messageReactions = new Map<string, SlackMessageReaction[]>();
  const messagesByRef = new Map<string, SlackMessage & { ts: string }>();
  const fileBytes = new Map<string, Buffer>();

  function requireHandlers(): SlackGatewayHandlers {
    if (!handlers) {
      throw new Error(
        "fake slack gateway not started — connect a Slack channel first",
      );
    }
    return handlers;
  }

  return {
    async start(h) {
      handlers = h;
      return true;
    },

    async stop() {
      handlers = null;
    },

    async postMessage(args) {
      outbound.push({
        kind: "message",
        teamId: args.teamId,
        channel: args.channel,
        text: args.text,
        ...(args.threadTs !== undefined ? { threadTs: args.threadTs } : {}),
        ...(args.replyBroadcast !== undefined
          ? { replyBroadcast: args.replyBroadcast }
          : {}),
        ...(args.unfurlLinks !== undefined
          ? { unfurlLinks: args.unfurlLinks }
          : {}),
        ...(args.unfurlMedia !== undefined
          ? { unfurlMedia: args.unfurlMedia }
          : {}),
        ...(args.username !== undefined ? { username: args.username } : {}),
        ...(args.iconUrl !== undefined ? { iconUrl: args.iconUrl } : {}),
      });
      const ts = `${Math.floor(Date.now() / 1000)}.${nextPostTs++}`;
      messagesByRef.set(`${args.channel}:${ts}`, {
        ts,
        text: args.text,
        ...(botUserId ? { user: botUserId } : {}),
        ...(args.threadTs !== undefined ? { threadTs: args.threadTs } : {}),
        ...(args.blocks ? { blocks: args.blocks } : {}),
        ...(args.metadata ? { metadata: args.metadata } : {}),
      });
      return { ts };
    },

    async deleteMessage() {
      return true;
    },

    async deleteFile() {},

    async openModal() {},

    async postEphemeral(args) {
      outbound.push({
        kind: "ephemeral",
        teamId: args.teamId,
        channel: args.channel,
        user: args.user,
        text: args.text,
        ...(args.threadTs !== undefined ? { threadTs: args.threadTs } : {}),
      });
    },

    async startStream(args) {
      const ts = `stream-${nextStreamTs++}`;
      outbound.push({
        kind: "stream_start",
        teamId: args.teamId,
        channel: args.channel,
        threadTs: args.threadTs,
        ts,
        text: args.markdownText ?? "",
        ...(args.recipientTeamId !== undefined
          ? { recipientTeamId: args.recipientTeamId }
          : {}),
        ...(args.recipientUserId !== undefined
          ? { recipientUserId: args.recipientUserId }
          : {}),
      });
      return { ts };
    },

    async appendStream(args) {
      outbound.push({
        kind: "stream_append",
        teamId: args.teamId,
        channel: args.channel,
        ts: args.ts,
        text: args.markdownText,
      });
    },

    async stopStream(args) {
      outbound.push({
        kind: "stream_stop",
        teamId: args.teamId,
        channel: args.channel,
        ts: args.ts,
        ...(args.markdownText !== undefined ? { text: args.markdownText } : {}),
      });
    },

    async setStatus(args) {
      outbound.push({
        kind: "status",
        teamId: args.teamId,
        channel: args.channel,
        threadTs: args.threadTs,
        status: args.status,
      });
    },

    async addReaction(args) {
      outbound.push({
        kind: "reaction",
        teamId: args.teamId,
        channel: args.channel,
        ts: args.ts,
        name: args.name,
      });
    },

    async getThreadReplies(args) {
      return threadPageOf(history, args, modelsThreads);
    },

    async getMessage(args) {
      return messagesByRef.get(`${args.channel}:${args.ts}`) ?? null;
    },

    async getChannelHistory(args) {
      const newestFirst = channelWindowOf(
        history,
        args.oldest,
        modelsThreads,
      ).reverse();
      return {
        messages: newestFirst.slice(0, args.limit),
        hasMore: newestFirst.length > args.limit,
      };
    },

    async uploadFile(args) {
      outbound.push({
        kind: "upload",
        teamId: args.teamId,
        channelId: args.channelId,
        filename: args.filename,
        ...(args.threadTs ? { threadTs: args.threadTs } : {}),
      });
    },

    async reserveFile(args) {
      const fileId = `F${nextFileId++}-${args.filename}`;
      stagedFiles.set(fileId, args.filename);
      return { fileId, uploadUrl: `https://files.fake/${fileId}` };
    },

    async sendFileBytes() {},

    async shareFile(args) {
      outbound.push({
        kind: "upload",
        teamId: args.teamId,
        channelId: args.channelId,
        filename: stagedFiles.get(args.fileId) ?? args.fileId,
        ...(args.threadTs ? { threadTs: args.threadTs } : {}),
      });
    },

    async downloadFile(urlPrivate, maxBytes) {
      const bytes = fileBytes.get(urlPrivate);
      if (!bytes) throw new Error(`HTTP 404`);
      if (bytes.byteLength > maxBytes) {
        throw new FileTooLargeError(maxBytes);
      }
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer;
    },

    setFileBytes(urlPrivate, bytes) {
      fileBytes.set(urlPrivate, bytes);
    },

    async listBotChannels(teamId) {
      return (channelsByWorkspace.get(teamId) ?? [])
        .filter((c) => c.botIsMember)
        .map(({ id, name }) => ({ id, name }));
    },

    async getConversationInfo(channelId, teamId) {
      const channel = (channelsByWorkspace.get(teamId) ?? []).find(
        (c) => c.id === channelId,
      );
      return channel
        ? {
            isMember: channel.botIsMember,
            isDirectMessage: false,
            name: channel.name,
          }
        : null;
    },

    async listSharedChannels(userId, teamId) {
      return (channelsByWorkspace.get(teamId) ?? [])
        .filter((c) => c.botIsMember && (c.members ?? []).includes(userId))
        .map((c) => c.id);
    },

    async getUserInfo(userId) {
      userLookups.push(userId);
      return users.find((u) => u.id === userId) ?? null;
    },

    async getMessageReactions(channel, ts) {
      return messageReactions.get(`${channel}:${ts}`) ?? null;
    },

    async getPermalink(channel, ts) {
      return `https://fake-workspace.slack.com/archives/${channel}/p${ts.replace(".", "")}`;
    },

    async openDirectMessage(userId) {
      return `D-${userId}`;
    },

    async fireMention(input) {
      const event: SlackMentionEvent = {
        ...input,
        teamId: input.teamId ?? FAKE_WORKSPACE,
      };
      await requireHandlers().onMention(event);
    },

    async fireMessage(input) {
      const event: SlackMentionEvent = {
        ...input,
        teamId: input.teamId ?? FAKE_WORKSPACE,
      };
      await requireHandlers().onMessage(event);
    },

    async fireViewSubmission(event) {
      await requireHandlers().onViewSubmission(event);
    },

    async fireBotJoinedChannel(input) {
      await requireHandlers().onBotJoinedChannel({
        ...input,
        teamId: input.teamId ?? FAKE_WORKSPACE,
      });
    },

    async fireDirectMessage(input) {
      const event: SlackMentionEvent = {
        ...input,
        teamId: input.teamId ?? FAKE_WORKSPACE,
      };
      await requireHandlers().onDirectMessage(event);
    },

    async fireCommand(input) {
      const command: SlackSlashCommand = {
        ...input,
        teamId: input.teamId ?? FAKE_WORKSPACE,
        triggerId: input.triggerId ?? "fake-trigger",
      };
      let ackText = "";
      await requireHandlers().onCommand(command, async (response) => {
        ackText = response?.text ?? "";
      });
      return ackText;
    },

    readOutbound() {
      return [...outbound];
    },

    resetOutbound() {
      outbound.length = 0;
    },

    setChannels(next, teamId = "") {
      channelsByWorkspace.set(teamId, [...next]);
    },

    setHistory(next) {
      history = [...next];
      modelsThreads = false;
    },

    setMessage(channel, message) {
      messagesByRef.set(`${channel}:${message.ts}`, message);
    },

    setThreadedHistory(next) {
      history = [...next];
      modelsThreads = true;
    },

    setUsers(next) {
      users = [...next];
    },

    readUserLookups() {
      return [...userLookups];
    },

    async getGrantedScopes() {
      return grantedScopes;
    },

    async getBotUserId() {
      return botUserId;
    },

    setGrantedScopes(scopes) {
      grantedScopes = scopes ? new Set(scopes) : null;
    },

    setBotUserId(id) {
      botUserId = id;
    },

    setMessageReactions(channel, ts, reactions) {
      messageReactions.set(`${channel}:${ts}`, [...reactions]);
    },
  };
}
