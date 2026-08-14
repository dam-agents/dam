import type { TtlStore } from "../../../core/ttl-store.js";
import type { ChannelTurnAttendance } from "../../../core/turn-attendance.js";
import { channelNetworkAccessGuidance } from "./network-access-copy.js";
import { match, P } from "ts-pattern";
import {
  ambientThreadKey,
  slackThreadKey,
  ChannelType,
  SessionType,
  type AgentsService,
} from "api-server-api";
import type { StoredChannelConfig } from "../stored-channel.js";
import {
  classifyInboundAttachment,
  type InboundAttachment,
} from "../inbound-image.js";
import type {
  ChannelReaction,
  ChannelReply,
  ChannelUser,
  MessageReactionsResult,
  PostMessageOptions,
  ReactionsQuery,
} from "../services/channel-manager.js";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import {
  type AcpClient,
  type AcpClientFactory,
  type PromptUpdate,
} from "../../../core/acp-client.js";
import {
  EventType,
  emit as defaultEmit,
  type DomainEvent,
  type TurnOutcome,
} from "../../../events.js";
import type { IdentityLinkService } from "./../services/identity-link-service.js";
import {
  buildAuthorizeUrl,
  generatePkce,
  type KeycloakOAuthConfig,
} from "./identity-oauth.js";
import { formatError } from "../../../core/format-error.js";
import { getLogger } from "../../../core/logger.js";
import { securityLog } from "../../../core/security-log.js";
import {
  isAgentStoppedError,
  isAgentWakeTimeoutError,
  isTransientWakeFailure,
  wakeFailureReasonToken,
} from "../../agents/index.js";
import { wakeFailureUserCopy } from "./wake-failure-copy.js";
import type {
  SlackAck,
  SlackChannelInfo,
  SlackChannelMessageEvent,
  SlackGateway,
  SlackImageFile,
  SlackMentionEvent,
  SlackMessageReaction,
  SlackSlashCommand,
  SlackUserInfo,
} from "./slack-gateway.js";
import {
  createTurnPresenter,
  renderAssistantBlocks,
  type TurnPresenter,
} from "./slack-turn-presenter.js";
import {
  agentContextBlock,
  agentFooterMrkdwn,
  formatSlackTs,
  historyLegend,
  labelHistoryMessage,
  parseAgentFooter,
  type AgentFooter,
} from "./agent-footer.js";

function slackTurnContract(ctx: {
  replyThreadTs: string;
  eventTs: string;
  brand: { name: string; short: string };
  canLookupUsers: boolean;
  batch?: { count: number; inThread: boolean };
  isDirectMessage: boolean;
  permalink: string | null;
}): string {
  const batchCount = ctx.batch?.count ?? 1;
  const multi = batchCount > 1;
  const replyBullet =
    multi && ctx.batch?.inThread === false
      ? "• reply — post a message threaded under the batched message you are " +
        "answering: pass its [ts …] tag as threadTs (several messages share " +
        "this turn, so an id-less reply is refused). Pass alsoSendToChannel " +
        "when that message is old enough that people watching the channel " +
        "would miss a thread-only reply."
      : `• reply — post a message into this thread (threadTs="${ctx.replyThreadTs}"). ` +
        "Pass alsoSendToChannel when this thread is old enough that people " +
        "watching the channel would miss a thread-only reply.";
  const reactIds = multi
    ? "messageTs = the [ts …] tag of the message you are reacting to"
    : `messageTs="${ctx.eventTs}"`;
  return [
    "<how-to-respond>",
    `You appear in this Slack workspace as the bot "${ctx.brand.name}" ` +
      `(mentioned as @${ctx.brand.short}). Nothing you write as plain text ` +
      "is delivered to Slack — only tool calls reach the channel. To " +
      "respond, call one of:",
    replyBullet,
    "• react — add a fitting emoji reaction to the message you're answering: a " +
      "quiet acknowledgement that notifies no one — pick an emoji that suits " +
      "the message (e.g. eyes on a bug report, tada on good news) " +
      `(${reactIds}). Pass the Slack emoji short name, no colons.`,
    "• no_reply_needed — end your turn without posting anything, when the " +
      "message doesn't call for a response.",
    ...(ctx.canLookupUsers
      ? [
          "People appear here as bare Slack ids like U024BE7LH, in speaker labels " +
            'and inside message text — call describe_channel_users with channel="slack" ' +
            "to learn who they are before naming someone, attributing work, or " +
            "reasoning about their local time.",
        ]
      : []),
    multi
      ? `You're reading ${batchCount} messages from ` +
        `${ctx.isDirectMessage ? "a 1:1 direct message" : "a shared channel or group DM"}. ` +
        "Each [ts …] tag above is that message's own send time, in seconds " +
        "since the Unix epoch."
      : `You're answering a message sent ${formatSlackTs(ctx.eventTs)}, in ` +
        `${ctx.isDirectMessage ? "a 1:1 direct message" : "a shared channel or group DM"}` +
        (ctx.permalink ? ` (permalink: ${ctx.permalink})` : "") +
        ".",
    "These instructions apply to the message they arrive with, not to this " +
      "conversation as a whole — a later message carries its own. A message " +
      "that arrives with no such block didn't come from Slack: answer it " +
      "where it arrived, in plain text, and post to Slack for it only if " +
      "you're asked to.",
    "If a tool is deferred, load it via ToolSearch first.",
    "</how-to-respond>",
    channelNetworkAccessGuidance(ctx.brand.name),
  ].join("\n");
}

function ambientGuidance(brand: { name: string }): string {
  return [
    "<reading-along>",
    "You are reading along in a shared Slack channel; the following " +
      "message(s) were not @-mentions. A message that calls you by name — " +
      `"${brand.name}", or the name you know yourself by — is addressed to ` +
      "you: answer it as you would a mention. Otherwise chime in only when " +
      "you can clearly help — answer a question you know the answer to, pick " +
      "up a task someone described, or flag a clear mistake. If in doubt, " +
      "stay silent by calling no_reply_needed.",
    "When a message is worth engaging with, open with a fitting emoji " +
      "reaction before you do anything else — it notifies no one and is a " +
      "quiet signal that you have picked it up. Choose an emoji that suits " +
      "the message rather than a rote one, and let the reaction stand alone " +
      "as your whole response when a full reply isn't warranted. Don't react " +
      "to messages you would otherwise stay silent on.",
    "</reading-along>",
  ].join("\n");
}

function framePrompt(opts: {
  contract: string;
  guidance?: string;
  context?: string[];
  contextLegend?: string;
  text: string;
  images: FetchedImage[];
}): string | ContentBlock[] {
  const parts: string[] = [opts.contract];
  if (opts.guidance) parts.push(opts.guidance);
  if (opts.context && opts.context.length > 0) {
    if (opts.contextLegend) parts.push(opts.contextLegend);
    parts.push(`<context>\n${opts.context.join("\n")}\n</context>`);
  }
  parts.push(opts.text);
  const text = parts.join("\n\n");
  if (opts.images.length === 0) return text;
  return [{ type: "text", text }, ...opts.images.map((i) => i.block)];
}

function isDirectMessageId(channelId: string): boolean {
  return channelId.startsWith("D");
}

export type FetchedImage = {
  block: ContentBlock;
  meta: { name: string; size: number };
};

type FetchedFailure = { name: string; reason: string };

type FetchImagesResult =
  | { kind: "ok"; images: FetchedImage[]; failures: FetchedFailure[] }
  | { kind: "cap_exceeded"; totalBytes: number; count: number };

const TOTAL_IMAGE_BYTES_CAP = 30 * 1_000_000;
const CONCURRENT_IMAGE_FETCH_LIMIT = 10;

function createSemaphore(max: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return {
    async acquire(): Promise<() => void> {
      if (active < max) active++;
      else await new Promise<void>((r) => queue.push(r));
      let released = false;
      return () => {
        if (released) return;
        released = true;
        const next = queue.shift();
        if (next) next();
        else active--;
      };
    },
  };
}

const imageFetchSemaphore = createSemaphore(CONCURRENT_IMAGE_FETCH_LIMIT);

async function unreadableImageCopy(
  gw: SlackGateway,
  attachment: Exclude<InboundAttachment, { kind: "image" }>,
): Promise<string> {
  if (attachment.kind === "unreadable") {
    return attachment.retryable
      ? `it is ${attachment.description}, so the upload arrived incomplete. Try resending.`
      : `it is ${attachment.description}. The agent reads PNG, JPEG, GIF and WebP images.`;
  }
  const scopes = await grantedScopes(gw);
  return scopes && !scopes.has("files:read")
    ? "Slack returned a web page instead of the file — this install lacks the " +
        "`files:read` permission, so it cannot download attachments. Reinstall " +
        "the app with that scope and send the image again."
    : "Slack returned a web page instead of the file, so the agent never saw " +
        "the image. That usually means the app cannot download attachments in " +
        "this conversation — check that it is still installed and can read files.";
}

const GENERIC_MIME_TYPES = ["application/octet-stream", "binary/octet-stream"];

function mayBeImageAttachment(f: SlackImageFile): boolean {
  if (f.mimetype?.startsWith("image/")) return true;
  if (f.mimetype && !GENERIC_MIME_TYPES.includes(f.mimetype)) return false;
  return /\.(png|jpe?g|gif|webp)$/i.test(f.name ?? "");
}

async function fetchSlackImages(
  gateway: SlackGateway,
  files: SlackImageFile[] | undefined,
): Promise<FetchImagesResult> {
  const imageFiles = (files ?? []).filter(mayBeImageAttachment);
  const totalBytes = imageFiles.reduce((sum, f) => sum + (f.size ?? 0), 0);
  if (totalBytes > TOTAL_IMAGE_BYTES_CAP) {
    return { kind: "cap_exceeded", totalBytes, count: imageFiles.length };
  }

  const release = await imageFetchSemaphore.acquire();
  try {
    const images: FetchedImage[] = [];
    const failures: FetchedFailure[] = [];
    for (const f of imageFiles) {
      try {
        const bytes = Buffer.from(await gateway.downloadFile(f.url_private));
        const attachment = classifyInboundAttachment(bytes);
        if (attachment.kind !== "image") {
          getLogger().warn(
            {
              file: f.name,
              claimedMimeType: f.mimetype,
              bytes: bytes.length,
              verdict: attachment.kind,
            },
            "slack.image.unreadable",
          );
          failures.push({
            name: f.name,
            reason: await unreadableImageCopy(gateway, attachment),
          });
          continue;
        }
        images.push({
          block: {
            type: "image",
            data: bytes.toString("base64"),
            mimeType: attachment.mimeType,
          },
          meta: { name: f.name, size: f.size },
        });
      } catch (err) {
        failures.push({
          name: f.name,
          reason: `${formatError(err)}. Try resending.`,
        });
      }
    }
    return { kind: "ok", images, failures };
  } finally {
    release();
  }
}

type TurnImages = { images: FetchedImage[]; withheldNote: string };

function renderWithheldNote(failures: FetchedFailure[]): string {
  if (failures.length === 0) return "";
  const list = failures.map((f) => `${f.name} (${f.reason})`).join("; ");
  return (
    `\n\nAn attachment on this message could not be read and was not ` +
    `included: ${list} Say so plainly if the question depends on seeing it — ` +
    `do not guess at its contents.`
  );
}

function renderTurnFiles(images: FetchedImage[]): string {
  if (images.length === 0) return "";
  const list = images
    .map((i) => `${i.meta.name} (${(i.meta.size / 1_000_000).toFixed(1)} MB)`)
    .join(", ");
  return `\nTurn included: ${list}.`;
}

async function getContextMessages(
  gateway: SlackGateway,
  channel: string,
  ts: string,
  readingAgentId: string,
  threadTs?: string,
): Promise<{ lines: string[]; hasAgentAuthored: boolean }> {
  const raw = threadTs
    ? await gateway.getThreadReplies({ channel, threadTs, limit: 50 })
    : (await gateway.getChannelHistory({ channel, limit: 10 }))
        .slice()
        .reverse();

  let hasAgentAuthored = false;
  const lines = raw
    .filter((m) => m.ts !== ts)
    .map((m) => {
      const footer = parseAgentFooter(m);
      if (footer) hasAgentAuthored = true;
      return labelHistoryMessage(m, footer, readingAgentId);
    });
  return { lines, hasAgentAuthored };
}

export interface ChannelRegistry {
  resolveSlackBinding(slackChannelId: string): Promise<{
    instanceName: string;
    owner: string;
    ambient?: boolean;
  } | null>;
  resolveSlackChannelsByInstance(agentId: string): Promise<string[]>;
}

export interface SlackWorker {
  type: ChannelType.Slack;
  connect(): Promise<void>;
  start(instanceName: string, channel: StoredChannelConfig): Promise<void>;
  stop(instanceName: string): Promise<void>;
  stopAll(): Promise<void>;
  listConversations(
    instanceName: string,
  ): Promise<{ id: string; title: string }[]>;
  postMessage(
    instanceName: string,
    text: string,
    options?: PostMessageOptions,
  ): Promise<{ ok: true } | { error: string }>;
  reply(
    instanceName: string,
    reply: ChannelReply,
  ): Promise<{ ok: true } | { error: string }>;
  react(
    instanceName: string,
    reaction: ChannelReaction,
  ): Promise<{ ok: true } | { error: string }>;
  describeUsers(
    instanceName: string,
    userIds: string[],
  ): Promise<{ users: ChannelUser[] } | { error: string }>;
  supportsUserLookup(): Promise<boolean>;
  describeMessageReactions(
    instanceName: string,
    query: ReactionsQuery,
  ): Promise<MessageReactionsResult | { error: string }>;
  supportsMessageReactions(): Promise<boolean>;
}

export interface SlackOAuthPending {
  slackUserId: string;
  channelId: string;
  codeVerifier: string;
  intent: "login" | "bind";
  createdAt: number;
}

async function resolveOutboundTarget(
  gateway: SlackGateway,
  boundChannelIds: string[],
  conversationId: string | undefined,
): Promise<{ id: string } | { error: string }> {
  if (!conversationId) {
    if (boundChannelIds.length === 1) return { id: boundChannelIds[0]! };
    return {
      error:
        `this agent is connected to ${boundChannelIds.length} Slack conversations ` +
        `(${boundChannelIds.join(", ")}) — pass chatId to say which one`,
    };
  }
  if (boundChannelIds.includes(conversationId)) {
    return { id: conversationId };
  }
  if (/^[UW][A-Z0-9]+$/.test(conversationId)) {
    try {
      return { id: await gateway.openDirectMessage(conversationId) };
    } catch (err) {
      return {
        error: `could not open a direct message with ${conversationId}: ${formatError(err)}`,
      };
    }
  }
  if (conversationId.startsWith("D")) {
    return { id: conversationId };
  }
  let info: { isMember: boolean } | null;
  try {
    info = await gateway.getConversationInfo(conversationId);
  } catch (err) {
    return {
      error: `could not resolve conversation ${conversationId}: ${formatError(err)}`,
    };
  }
  if (!info) {
    return {
      error: `conversation ${conversationId} not found — if it is a private channel, the bot must be invited to it first (/invite)`,
    };
  }
  if (!info.isMember) {
    return {
      error: `the bot is not a member of ${conversationId} — invite it to the channel first (/invite), or pick a chat from describe_channel`,
    };
  }
  return { id: conversationId };
}

export const TURN_LINGER_MS = 60 * 60_000;

const USER_CACHE_TTL_MS = 10 * 60_000;

const userLookupSemaphore = createSemaphore(5);

function normalizeSlackUserId(input: string): string | null {
  const bare = input.trim().replace(/^<@/, "").replace(/>$/, "").split("|")[0]!;
  return /^[UW][A-Z0-9]+$/i.test(bare) ? bare.toUpperCase() : null;
}

async function grantedScopes(gw: SlackGateway): Promise<Set<string> | null> {
  try {
    return await gw.getGrantedScopes();
  } catch {
    return null;
  }
}

async function canLookupUsers(gw: SlackGateway): Promise<boolean> {
  const scopes = await grantedScopes(gw);
  return !scopes || scopes.has("users:read");
}

async function canReadReactions(gw: SlackGateway): Promise<boolean> {
  const scopes = await grantedScopes(gw);
  return !scopes || scopes.has("reactions:read");
}

const SCOPE_CAPABILITIES: Array<{ scope: string; backs: string }> = [
  { scope: "app_mentions:read", backs: "answering mentions" },
  { scope: "chat:write", backs: "posting replies" },
  { scope: "files:read", backs: "reading images people attach" },
  { scope: "files:write", backs: "sending files into a channel" },
  { scope: "channels:history", backs: "reading channel history for context" },
  { scope: "im:history", backs: "answering direct messages" },
  { scope: "reactions:write", backs: "the agent's own emoji reactions" },
  { scope: "users:read", backs: "telling the agent who people are" },
  { scope: "reactions:read", backs: "reading the reactions on a message" },
  { scope: "channels:read", backs: "posting outside the bound channel" },
];

async function reportMissingPermissions(gw: SlackGateway): Promise<void> {
  const scopes = await grantedScopes(gw);
  if (!scopes) return;
  const missing = SCOPE_CAPABILITIES.filter((c) => !scopes.has(c.scope));
  if (missing.length === 0) return;
  getLogger().warn(
    {
      missing: missing.map((m) => m.scope),
      affects: missing.map((m) => m.backs),
    },
    `slack.permissions.missing: the Slack app lacks ${missing
      .map((m) => `${m.scope} (${m.backs})`)
      .join(
        ", ",
      )}. Reinstall the app to grant them — an app already installed ` +
      `keeps the permissions it was installed with.`,
  );
}

async function turnContractContext(
  gw: SlackGateway,
  channel: string,
  eventTs: string,
  opts?: { batched?: boolean },
): Promise<{ canLookupUsers: boolean; permalink: string | null }> {
  const [lookup, permalink] = await Promise.all([
    canLookupUsers(gw),
    opts?.batched
      ? Promise.resolve(null)
      : gw.getPermalink(channel, eventTs).catch(() => null),
  ]);
  return { canLookupUsers: lookup, permalink };
}

export function createSlackWorker(
  makeAcpClient: AcpClientFactory,
  createGateway: () => SlackGateway,
  agents: () => AgentsService,
  identityLinks: IdentityLinkService,
  oauthConfig: KeycloakOAuthConfig,
  pendingOAuthFlows: TtlStore<SlackOAuthPending>,
  getInstanceOwner: (agentId: string) => Promise<string | null>,
  channelRegistry: ChannelRegistry,
  unbindSlackChannel: (slackChannelId: string) => Promise<void>,
  setSlackChannelAmbient: (
    slackChannelId: string,
    ambient: boolean,
  ) => Promise<void>,
  brand: { name: string; short: string },
  isTermsAccepted: (sub: string) => Promise<boolean>,
  uiBaseUrl: string,
  attendance: ChannelTurnAttendance,
  emit: (event: DomainEvent) => void = defaultEmit,
): SlackWorker {
  const brandShort = brand.short;
  let gateway: SlackGateway | null = null;

  type TurnRef = {
    channel: string;
    threadTs: string;
    eventTs: string;
    sessionId?: string;
    releaseAttendance?: () => void;
  };

  const inFlightTurns = new Map<string, Set<TurnRef>>();

  const lingeringTurns = new Map<string, Map<TurnRef, number>>();

  const lastTurn = new Map<string, TurnRef>();

  function beginTurn(
    instanceName: string,
    ref: TurnRef,
    opts?: { advanceLastTurn?: boolean },
  ) {
    if (opts?.advanceLastTurn !== false) lastTurn.set(instanceName, ref);
    let live = inFlightTurns.get(instanceName);
    if (!live) {
      live = new Set();
      inFlightTurns.set(instanceName, live);
    }
    live.add(ref);
    ref.releaseAttendance ??= attendance.openChannelTurn(instanceName);
  }

  function endTurn(
    instanceName: string,
    ref: TurnRef,
    opts?: { harnessMayStillRun?: boolean },
  ) {
    const live = inFlightTurns.get(instanceName);
    if (live) {
      live.delete(ref);
      if (live.size === 0) inFlightTurns.delete(instanceName);
    }
    ref.releaseAttendance?.();
    ref.releaseAttendance = undefined;
    if (opts?.harnessMayStillRun) {
      let lingering = lingeringTurns.get(instanceName);
      if (!lingering) {
        lingering = new Map();
        lingeringTurns.set(instanceName, lingering);
      }
      lingering.set(ref, Date.now() + TURN_LINGER_MS);
    }
  }

  function lingeringFor(instanceName: string): TurnRef[] {
    const lingering = lingeringTurns.get(instanceName);
    if (!lingering) return [];
    const now = Date.now();
    for (const [ref, expiresAt] of lingering) {
      if (expiresAt <= now) lingering.delete(ref);
    }
    if (lingering.size === 0) {
      lingeringTurns.delete(instanceName);
      return [];
    }
    return [...lingering.keys()];
  }

  function resolveTurn(
    instanceName: string,
    kind: "reply" | "react",
  ): { ref: TurnRef } | { ambiguous: true } | { none: true } {
    const candidates = [
      ...(inFlightTurns.get(instanceName) ?? []),
      ...lingeringFor(instanceName),
    ];
    if (candidates.length > 0) {
      const target = (ref: TurnRef) =>
        kind === "reply"
          ? `${ref.channel} ${ref.threadTs}`
          : `${ref.channel} ${ref.eventTs}`;
      const targets = new Set(candidates.map(target));
      return targets.size === 1 ? { ref: candidates[0]! } : { ambiguous: true };
    }
    const last = lastTurn.get(instanceName);
    return last ? { ref: last } : { none: true };
  }

  function findTurnRef(
    instanceName: string,
    match: (ref: TurnRef) => boolean,
  ): TurnRef | undefined {
    const live = [...(inFlightTurns.get(instanceName) ?? [])];
    for (let i = live.length - 1; i >= 0; i--) {
      if (match(live[i]!)) return live[i];
    }
    const lingering = lingeringFor(instanceName);
    for (let i = lingering.length - 1; i >= 0; i--) {
      if (match(lingering[i]!)) return lingering[i];
    }
    return undefined;
  }

  function noteEngagedTurn(
    instanceName: string,
    match: (ref: TurnRef) => boolean,
  ) {
    const engaged = findTurnRef(instanceName, match);
    if (engaged) lastTurn.set(instanceName, engaged);
  }

  const userCache = new Map<
    string,
    { user: SlackUserInfo | null; expiresAt: number }
  >();

  function cacheUser(id: string, user: SlackUserInfo | null) {
    const now = Date.now();
    if (userCache.size > 500) {
      for (const [key, entry] of userCache) {
        if (entry.expiresAt <= now) userCache.delete(key);
      }
    }
    userCache.set(id, { user, expiresAt: now + USER_CACHE_TTL_MS });
  }

  const AMBIGUOUS_THREAD_ERROR =
    "This agent is handling more than one Slack thread right now — pass the " +
    'threadTs shown in your turn instructions (reply threadTs="…", react ' +
    'messageTs="…") so this lands in the thread you are answering.';

  const AMBIGUOUS_MESSAGE_ERROR =
    "This agent is handling more than one Slack thread right now — pass the " +
    "messageTs shown in your turn instructions so this inspects the message " +
    "you mean.";

  async function resolveAgentFooter(
    instanceName: string,
    sessionId?: string,
  ): Promise<AgentFooter> {
    let agentName = instanceName;
    try {
      const agent = await agents().get(instanceName);
      if (agent?.name) agentName = agent.name;
    } catch {}
    return {
      uiBaseUrl,
      agentId: instanceName,
      agentName,
      ...(sessionId ? { sessionId } : {}),
    };
  }

  async function ephemeral(
    channel: string,
    user: string,
    threadTs: string | undefined,
    text: string,
  ) {
    if (!gateway) {
      process.stderr.write(
        `[slack] ephemeral skipped (app not started): ${text}\n`,
      );
      return;
    }
    try {
      await gateway.postEphemeral({ channel, user, threadTs, text });
    } catch (err) {
      process.stderr.write(
        `[slack] postEphemeral failed: ${formatError(err)}\n`,
      );
    }
  }

  async function findThreadSession(
    acp: AcpClient,
    threadKey: string,
    legacyKey?: string,
  ) {
    const sessions = await acp.listSessions().catch((err) => {
      process.stderr.write(
        `[slack] listSessions failed: ${formatError(err)}\n`,
      );
      return [];
    });
    return (
      sessions.find((s) => s.platform?.threadTs === threadKey) ??
      (legacyKey
        ? (sessions.find((s) => s.platform?.threadTs === legacyKey) ?? null)
        : null)
    );
  }

  const sessionTurnLocks = new Map<string, Promise<void>>();

  async function withSessionTurnLock<T>(
    instanceName: string,
    threadKey: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = `${instanceName} ${threadKey}`;
    const prev = sessionTurnLocks.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    sessionTurnLocks.set(key, tail);
    void tail.then(() => {
      if (sessionTurnLocks.get(key) === tail) sessionTurnLocks.delete(key);
    });
    return run;
  }

  async function runSessionTurn(args: {
    instanceName: string;
    threadKey: string;
    resumePrompt: string | ContentBlock[];
    buildFreshPrompt: () => Promise<string | ContentBlock[]>;
    onWaking?: () => void;
    onImagesDropped?: () => void;
    onUpdate?: (update: PromptUpdate) => void;
    onSession?: (sessionId: string) => void;
    onGhostTurn?: () => void;
    legacyThreadKey?: string;
  }): Promise<string> {
    const platformMeta = {
      type: SessionType.ChannelSlack,
      threadTs: args.threadKey,
    };
    return withSessionTurnLock(args.instanceName, args.threadKey, async () => {
      await agents().ensureReady(args.instanceName, {
        onWaking: args.onWaking,
      });
      const acp = makeAcpClient(args.instanceName);
      const existing = await findThreadSession(
        acp,
        args.threadKey,
        args.legacyThreadKey,
      );
      const sendOpts = {
        onImagesDropped: args.onImagesDropped,
        onUpdate: args.onUpdate,
        onSession: args.onSession,
      };
      if (existing) {
        try {
          return await acp.sendPrompt(args.resumePrompt, {
            resumeSessionId: existing.sessionId,
            ...sendOpts,
          });
        } catch {
          args.onGhostTurn?.();
          return acp.sendPrompt(await args.buildFreshPrompt(), {
            platformMeta,
            ...sendOpts,
          });
        }
      }
      return acp.sendPrompt(await args.buildFreshPrompt(), {
        platformMeta,
        ...sendOpts,
      });
    });
  }

  async function relayOwnerTurn(ctx: {
    instanceName: string;
    channel: string;
    threadTs: string;
    eventTs: string;
    text: string;
    hasThread: boolean;
    actorSub: string | null;
    externalActorId?: string;
    slackUserId: string;
    teamId?: string;
    images: FetchedImage[];
  }) {
    if (!gateway) return;
    const gw = gateway;
    const { instanceName } = ctx;

    const turnRef: TurnRef = {
      channel: ctx.channel,
      threadTs: ctx.threadTs,
      eventTs: ctx.eventTs,
    };

    const presenter = createTurnPresenter(gw, {
      channel: ctx.channel,
      threadTs: ctx.threadTs,
      instanceName,
    });
    presenter.setThinking();

    const contract = slackTurnContract({
      replyThreadTs: ctx.threadTs,
      eventTs: ctx.eventTs,
      brand,
      isDirectMessage: isDirectMessageId(ctx.channel),
      ...(await turnContractContext(gw, ctx.channel, ctx.eventTs)),
    });

    let outcome: TurnOutcome = "failure";
    let failureReason: string | undefined;
    const onImagesDropped = () =>
      ephemeral(
        ctx.channel,
        ctx.slackUserId,
        ctx.hasThread ? ctx.threadTs : undefined,
        "This agent can't process images yet — answering text only.",
      );

    let coldNoticePosted = false;
    const onWaking = () => {
      presenter.setWaking();
      if (coldNoticePosted) return;
      coldNoticePosted = true;
      ephemeral(
        ctx.channel,
        ctx.slackUserId,
        ctx.hasThread ? ctx.threadTs : undefined,
        "Waking the agent — this can take a minute or two.",
      );
    };

    let ghostTurn = false;
    const runTurn = async () => {
      const resumePrompt = framePrompt({
        contract,
        text: ctx.text,
        images: ctx.images,
      });
      await runSessionTurn({
        instanceName,
        threadKey: slackThreadKey(ctx.channel, ctx.threadTs),
        legacyThreadKey: ctx.threadTs,
        resumePrompt,
        buildFreshPrompt: () => buildThreadPrompt(gw, ctx, contract),
        onWaking,
        onImagesDropped,
        onUpdate: presenter.onUpdate,
        onSession: (sessionId) => {
          turnRef.sessionId = sessionId;
        },
        onGhostTurn: () => {
          ghostTurn = true;
        },
      });
      outcome = "success";
    };

    const postFailure = async (err: unknown) => {
      failureReason = isAgentStoppedError(err)
        ? "agent-stopped"
        : isAgentWakeTimeoutError(err)
          ? wakeFailureReasonToken(err.failure)
          : "acp-error";
      getLogger().warn(
        {
          agentId: instanceName,
          reason: failureReason,
          error: formatError(err),
        },
        "slack.turn.failed",
      );
      const text = isAgentStoppedError(err)
        ? `This agent was stopped by its owner — it stays stopped until the owner wakes it (or its next schedule fires).${renderTurnFiles(ctx.images)}`
        : isAgentWakeTimeoutError(err)
          ? `${wakeFailureUserCopy(err.failure)}${renderTurnFiles(ctx.images)}`
          : `Error: ${formatError(err)}.${renderTurnFiles(ctx.images)}`;
      await gw.postMessage({
        channel: ctx.channel,
        threadTs: ctx.threadTs,
        text,
      });
    };

    try {
      beginTurn(instanceName, turnRef);
      try {
        await runTurn();
      } catch (err) {
        if (
          !isAgentWakeTimeoutError(err) ||
          !isTransientWakeFailure(err.failure)
        ) {
          throw err;
        }
        await gw.postMessage({
          channel: ctx.channel,
          threadTs: ctx.threadTs,
          text: "The agent is still starting — hang on, answering as soon as it's up…",
        });
        await runTurn();
      }
    } catch (err) {
      await postFailure(err);
    } finally {
      endTurn(instanceName, turnRef, {
        harnessMayStillRun: ghostTurn || failureReason === "acp-error",
      });
      await presenter.clearStatus();
      emit({
        type: EventType.ChannelTurnRelayed,
        channel: "slack",
        agentId: instanceName,
        actorSub: ctx.actorSub,
        ...(ctx.externalActorId
          ? { externalActorId: ctx.externalActorId }
          : {}),
        outcome,
        ...(failureReason !== undefined ? { reason: failureReason } : {}),
      });
    }
  }

  async function buildThreadPrompt(
    gw: SlackGateway,
    ctx: {
      instanceName: string;
      channel: string;
      threadTs: string;
      eventTs: string;
      text: string;
      hasThread: boolean;
      images: FetchedImage[];
    },
    contract: string,
    guidance?: string,
  ): Promise<string | ContentBlock[]> {
    const { lines, hasAgentAuthored } = await getContextMessages(
      gw,
      ctx.channel,
      ctx.eventTs,
      ctx.instanceName,
      ctx.hasThread ? ctx.threadTs : undefined,
    );
    return framePrompt({
      contract,
      guidance,
      context: lines,
      contextLegend: hasAgentAuthored
        ? historyLegend(await canLookupUsers(gw))
        : undefined,
      text: ctx.text,
      images: ctx.images,
    });
  }

  async function handleCommand(command: SlackSlashCommand, ack: SlackAck) {
    const subcommand = command.text.trim().toLowerCase();

    await match(subcommand)
      .with("login", async () => {
        const existing = await identityLinks.resolve("slack", command.userId);
        if (existing) {
          await ack({
            text: `You are already linked. Use \`/${brandShort} logout\` to unlink first.`,
          });
          return;
        }

        const { state, codeVerifier, codeChallenge } = generatePkce();
        await pendingOAuthFlows.set(state, {
          slackUserId: command.userId,
          channelId: command.channelId,
          codeVerifier,
          intent: "login",
          createdAt: Date.now(),
        });

        const loginUrl = buildAuthorizeUrl(oauthConfig, state, codeChallenge);
        await ack({
          text: `<${loginUrl}|Click here to link your Keycloak account>`,
        });
      })
      .with("logout", async () => {
        const existing = await identityLinks.resolve("slack", command.userId);
        if (!existing) {
          await ack({ text: "You don't have a linked account." });
          return;
        }

        await identityLinks.unlink("slack", command.userId);
        await ack({ text: "Account unlinked." });
      })
      .with("bind", async () => {
        const binding = await channelRegistry.resolveSlackBinding(
          command.channelId,
        );
        if (binding) {
          await ack({
            text: `This channel is already connected to \`${binding.instanceName}\`. The person who connected it, or the agent's owner, must run \`/${brandShort} unbind\` first.`,
          });
          return;
        }

        const { state, codeVerifier, codeChallenge } = generatePkce();
        await pendingOAuthFlows.set(state, {
          slackUserId: command.userId,
          channelId: command.channelId,
          codeVerifier,
          intent: "bind",
          createdAt: Date.now(),
        });

        const bindUrl = buildAuthorizeUrl(oauthConfig, state, codeChallenge);
        await ack({
          text: isDirectMessageId(command.channelId)
            ? `<${bindUrl}|Connect one of your agents to this DM>. You'll talk to it here privately, under the agent's own connected accounts and API tokens.`
            : `<${bindUrl}|Connect an agent to this channel>. Everyone here will be able to drive it under the agent's own connected accounts and API tokens.`,
        });
      })
      .with("unbind", async () => {
        const binding = await channelRegistry.resolveSlackBinding(
          command.channelId,
        );
        if (!binding) {
          await ack({ text: "This channel isn't connected to an agent." });
          return;
        }

        const invoker = await identityLinks.resolve("slack", command.userId);
        if (!invoker) {
          securityLog("warn", "channel.authz_deny", {
            category: "channel",
            actor: null,
            actorKind: "external",
            surface: "slack",
            agentId: binding.instanceName,
            decision: "deny",
            reason: "unlinked",
            detail: {
              slackUserId: command.userId,
              channelId: command.channelId,
            },
          });
          await ack({
            text: `Link your account first — run \`/${brandShort} login\`, then \`/${brandShort} unbind\` again.`,
          });
          return;
        }

        const agentOwner = await getInstanceOwner(binding.instanceName);
        const allowed = invoker === binding.owner || invoker === agentOwner;
        if (!allowed) {
          securityLog("warn", "channel.authz_deny", {
            category: "channel",
            actor: invoker,
            actorKind: "user",
            surface: "slack",
            agentId: binding.instanceName,
            decision: "deny",
            reason: "not-binder-or-owner",
            detail: {
              slackUserId: command.userId,
              channelId: command.channelId,
            },
          });
          await ack({
            text: "Only the person who connected this channel, or the agent's owner, can disconnect it.",
          });
          return;
        }

        await unbindSlackChannel(command.channelId);
        securityLog("info", "channel.chat_unbound", {
          category: "authz-list",
          actor: invoker,
          actorKind: "user",
          surface: "slack",
          agentId: binding.instanceName,
          result: "success",
          detail: { slackUserId: command.userId, channelId: command.channelId },
        });
        emit({
          type: EventType.SlackDisconnected,
          agentId: binding.instanceName,
        });
        await ack({
          text: `Channel disconnected. Run \`/${brandShort} bind\` to connect an agent again.`,
        });
      })
      .with(P.union("ambient", "ambient on", "ambient off"), async (cmd) => {
        await handleAmbientCommand(cmd, command, ack);
      })
      .with(P.string, async () => {
        await ack({
          text: `Usage: \`/${brandShort} bind\`, \`/${brandShort} unbind\`, or \`/${brandShort} ambient on|off\``,
        });
      })
      .exhaustive();
  }

  async function handleAmbientCommand(
    subcommand: "ambient" | "ambient on" | "ambient off",
    command: SlackSlashCommand,
    ack: SlackAck,
  ) {
    const binding = await channelRegistry.resolveSlackBinding(
      command.channelId,
    );
    if (!binding) {
      await ack({ text: "This channel isn't connected to an agent." });
      return;
    }
    const isAmbient = binding.ambient === true;
    if (subcommand === "ambient") {
      await ack({
        text: `Ambient mode is ${
          isAmbient
            ? "on — the agent reads along and may chime in without being mentioned"
            : "off — the agent only responds to mentions"
        }. Use \`/${brandShort} ambient on\` or \`/${brandShort} ambient off\` to change it.`,
      });
      return;
    }
    const enable = subcommand === "ambient on";

    const invoker = await identityLinks.resolve("slack", command.userId);
    if (!invoker) {
      securityLog("warn", "channel.authz_deny", {
        category: "channel",
        actor: null,
        actorKind: "external",
        surface: "slack",
        agentId: binding.instanceName,
        decision: "deny",
        reason: "unlinked",
        detail: {
          slackUserId: command.userId,
          channelId: command.channelId,
        },
      });
      await ack({
        text: `Link your account first — run \`/${brandShort} login\`, then \`/${brandShort} ${subcommand}\` again.`,
      });
      return;
    }

    const agentOwner = await getInstanceOwner(binding.instanceName);
    const allowed = invoker === binding.owner || invoker === agentOwner;
    if (!allowed) {
      securityLog("warn", "channel.authz_deny", {
        category: "channel",
        actor: invoker,
        actorKind: "user",
        surface: "slack",
        agentId: binding.instanceName,
        decision: "deny",
        reason: "not-binder-or-owner",
        detail: {
          slackUserId: command.userId,
          channelId: command.channelId,
        },
      });
      await ack({
        text: "Only the person who connected this channel, or the agent's owner, can change ambient mode.",
      });
      return;
    }

    if (enable === isAmbient) {
      await ack({ text: `Ambient mode is already ${enable ? "on" : "off"}.` });
      return;
    }

    await setSlackChannelAmbient(command.channelId, enable);
    securityLog("info", "channel.ambient_toggled", {
      category: "authz-list",
      actor: invoker,
      actorKind: "user",
      surface: "slack",
      agentId: binding.instanceName,
      result: "success",
      detail: {
        slackUserId: command.userId,
        channelId: command.channelId,
        ambient: enable,
      },
    });

    const termsPending =
      enable && !(await isTermsAccepted(binding.owner))
        ? ` Heads-up: the person who connected this channel hasn't accepted the Terms of Use at ${uiBaseUrl} yet, so the agent stays silent until they do.`
        : "";
    await ack({
      text: enable
        ? `Ambient mode turned on — \`${binding.instanceName}\` now reads along in this channel and may chime in without being mentioned when it can clearly help. It still answers mentions as usual; run \`/${brandShort} ambient off\` to make it mentions-only again.${termsPending}`
        : `Ambient mode turned off — \`${binding.instanceName}\` now only responds when mentioned.`,
    });
  }

  async function fetchTurnImages(
    event: SlackMentionEvent,
    slackUserId: string,
  ): Promise<TurnImages | null> {
    if (!gateway) return null;
    const fetchResult = await fetchSlackImages(gateway, event.files);
    if (fetchResult.kind === "cap_exceeded") {
      const mb = (fetchResult.totalBytes / 1_000_000).toFixed(1);
      const capMb = (TOTAL_IMAGE_BYTES_CAP / 1_000_000).toFixed(0);
      await ephemeral(
        event.channel,
        slackUserId,
        event.threadTs,
        `Attached images total ${mb} MB, over the ${capMb} MB per-message cap. Send smaller images or fewer at once.`,
      );
      return null;
    }
    const { images, failures } = fetchResult;
    for (const f of failures) {
      await ephemeral(
        event.channel,
        slackUserId,
        event.threadTs,
        `Couldn't use attached image '${f.name}': ${f.reason}`,
      );
    }
    return { images, withheldNote: renderWithheldNote(failures) };
  }

  function unboundConversationCopy(
    event: SlackMentionEvent,
    directMessage: boolean,
  ): string {
    if (directMessage || isDirectMessageId(event.channel)) {
      return `This conversation isn't connected to an agent yet. Run \`/${brandShort} bind\` to connect one of your agents, then message it here.`;
    }
    if (event.channelType === "mpim") {
      return `No agent is connected to this group yet. Run \`/${brandShort} bind\` to connect one of your agents, then @-mention it here.`;
    }
    return "No instance connected to this channel.";
  }

  async function handleInbound(
    event: SlackMentionEvent,
    opts: { directMessage: boolean },
  ) {
    if (!gateway) return;

    const slackUserId = event.user;
    if (!slackUserId) return;

    const threadTs = event.threadTs ?? event.ts;
    const binding = await channelRegistry.resolveSlackBinding(event.channel);
    if (!binding) {
      await gateway.postEphemeral({
        channel: event.channel,
        user: slackUserId,
        text: unboundConversationCopy(event, opts.directMessage),
      });
      return;
    }

    const fetched = await fetchTurnImages(event, slackUserId);
    if (fetched === null) return;
    await relaySharedTurn({
      channel: event.channel,
      threadTs,
      eventTs: event.ts,
      text: event.text + fetched.withheldNote,
      hasThread: !!event.threadTs,
      slackUserId,
      instanceName: binding.instanceName,
      owner: binding.owner,
      teamId: event.teamId,
      images: fetched.images,
      speakerLabel: !opts.directMessage,
    });
  }

  const handleAppMention = (event: SlackMentionEvent) =>
    isDirectMessageId(event.channel)
      ? Promise.resolve()
      : handleInbound(event, { directMessage: false });

  const handleDirectMessage = (event: SlackMentionEvent) =>
    handleInbound(event, { directMessage: true });

  async function relaySharedTurn(args: {
    channel: string;
    threadTs: string;
    eventTs: string;
    text: string;
    hasThread: boolean;
    slackUserId: string;
    instanceName: string;
    owner: string;
    teamId?: string;
    images: FetchedImage[];
    speakerLabel?: boolean;
  }) {
    if (!gateway) return;

    securityLog("info", "channel.authz", {
      category: "channel",
      actor: null,
      actorKind: "external",
      surface: "slack",
      agentId: args.instanceName,
      decision: "allow",
      detail: {
        basis: "place",
        slackUserId: args.slackUserId,
        channelId: args.channel,
      },
    });

    if (!(await isTermsAccepted(args.owner))) {
      await gateway.postEphemeral({
        channel: args.channel,
        user: args.slackUserId,
        text: `This agent can't reply yet — its owner must accept the Terms of Use at ${uiBaseUrl}.`,
      });
      return;
    }

    await relayOwnerTurn({
      instanceName: args.instanceName,
      channel: args.channel,
      threadTs: args.threadTs,
      eventTs: args.eventTs,
      text:
        args.speakerLabel === false
          ? args.text
          : `<@${args.slackUserId}>: ${args.text}`,
      hasThread: args.hasThread,
      actorSub: null,
      externalActorId: args.slackUserId,
      slackUserId: args.slackUserId,
      teamId: args.teamId,
      images: args.images,
    });
  }

  async function relayAmbientTurn(args: {
    instanceName: string;
    channel: string;
    threadKey: string;
    legacyThreadKey?: string;
    replyThreadTs: string;
    eventTs: string;
    hasThread: boolean;
    messages: Array<{ text: string; eventTs: string }>;
    images: FetchedImage[];
    externalActorId: string;
  }) {
    if (!gateway) return;
    const gw = gateway;

    const multi = args.messages.length > 1;
    const turnRefs: TurnRef[] = args.messages.map((m) => ({
      channel: args.channel,
      threadTs: args.hasThread ? args.replyThreadTs : m.eventTs,
      eventTs: m.eventTs,
    }));
    const text = multi
      ? args.messages.map((m) => `[ts ${m.eventTs}] ${m.text}`).join("\n")
      : args.messages[0]!.text;

    let outcome: TurnOutcome = "failure";
    let failureReason: string | undefined;
    const contract = slackTurnContract({
      replyThreadTs: args.replyThreadTs,
      eventTs: args.eventTs,
      brand,
      batch: { count: args.messages.length, inThread: args.hasThread },
      isDirectMessage: isDirectMessageId(args.channel),
      ...(await turnContractContext(gw, args.channel, args.eventTs, {
        batched: args.messages.length > 1,
      })),
    });
    const guidance = ambientGuidance(brand);
    const resumePrompt = framePrompt({
      contract,
      guidance,
      text,
      images: args.images,
    });

    let ghostTurn = false;
    const runTurn = () =>
      runSessionTurn({
        instanceName: args.instanceName,
        threadKey: args.threadKey,
        ...(args.legacyThreadKey
          ? { legacyThreadKey: args.legacyThreadKey }
          : {}),
        resumePrompt,
        buildFreshPrompt: () =>
          buildThreadPrompt(
            gw,
            {
              instanceName: args.instanceName,
              channel: args.channel,
              threadTs: args.replyThreadTs,
              eventTs: args.eventTs,
              text,
              hasThread: args.hasThread,
              images: args.images,
            },
            contract,
            guidance,
          ),
        onSession: (sessionId) => {
          for (const ref of turnRefs) ref.sessionId = sessionId;
        },
        onGhostTurn: () => {
          ghostTurn = true;
        },
      });

    try {
      for (const ref of turnRefs) {
        beginTurn(args.instanceName, ref, { advanceLastTurn: false });
      }
      try {
        await runTurn();
      } catch (err) {
        if (
          !isAgentWakeTimeoutError(err) ||
          !isTransientWakeFailure(err.failure)
        ) {
          throw err;
        }
        await runTurn();
      }
      outcome = "success";
    } catch (err) {
      failureReason = isAgentStoppedError(err)
        ? "agent-stopped"
        : isAgentWakeTimeoutError(err)
          ? wakeFailureReasonToken(err.failure)
          : "acp-error";
      getLogger().warn(
        {
          agentId: args.instanceName,
          reason: failureReason,
          error: formatError(err),
        },
        "slack.ambient_turn.failed",
      );
    } finally {
      for (const ref of turnRefs) {
        endTurn(args.instanceName, ref, {
          harnessMayStillRun: ghostTurn || failureReason === "acp-error",
        });
      }
      emit({
        type: EventType.ChannelTurnRelayed,
        channel: "slack",
        agentId: args.instanceName,
        actorSub: null,
        externalActorId: args.externalActorId,
        outcome,
        ...(failureReason !== undefined ? { reason: failureReason } : {}),
      });
    }
  }

  type AmbientPendingMessage = {
    text: string;
    eventTs: string;
    slackUserId: string;
    images: FetchedImage[];
  };

  type AmbientQueue = {
    channelId: string;
    threadTs: string | null;
    pending: AmbientPendingMessage[];
    draining: boolean;
  };
  const ambientQueues = new Map<string, AmbientQueue>();

  function ambientQueueKey(channelId: string, threadTs: string | null): string {
    return threadTs === null
      ? `top:${channelId}`
      : `thread:${channelId}:${threadTs}`;
  }

  function enqueueAmbient(
    channelId: string,
    threadTs: string | null,
    msg: AmbientPendingMessage,
  ) {
    const key = ambientQueueKey(channelId, threadTs);
    let queue = ambientQueues.get(key);
    if (!queue) {
      queue = { channelId, threadTs, pending: [], draining: false };
      ambientQueues.set(key, queue);
    }
    queue.pending.push(msg);
    if (!queue.draining) void drainAmbientQueue(key, queue);
  }

  async function drainAmbientQueue(key: string, queue: AmbientQueue) {
    queue.draining = true;
    try {
      while (queue.pending.length > 0) {
        const batch = queue.pending.splice(0);
        const last = batch.at(-1);
        if (!last) continue;
        const binding = await channelRegistry.resolveSlackBinding(
          queue.channelId,
        );
        if (!binding || !binding.ambient) {
          continue;
        }
        if (!(await isTermsAccepted(binding.owner))) {
          getLogger().debug(
            { agentId: binding.instanceName, channelId: queue.channelId },
            "slack.ambient_turn.skipped_terms",
          );
          continue;
        }
        const inThread = queue.threadTs !== null;
        await relayAmbientTurn({
          instanceName: binding.instanceName,
          channel: queue.channelId,
          threadKey: inThread
            ? slackThreadKey(queue.channelId, queue.threadTs!)
            : ambientThreadKey(queue.channelId),
          ...(inThread ? { legacyThreadKey: queue.threadTs! } : {}),
          replyThreadTs: inThread ? queue.threadTs! : last.eventTs,
          eventTs: last.eventTs,
          hasThread: inThread,
          messages: batch.map(({ text, eventTs }) => ({ text, eventTs })),
          images: batch.flatMap((m) => m.images),
          externalActorId: last.slackUserId,
        });
      }
    } catch (err) {
      getLogger().warn(
        { channelId: queue.channelId, error: formatError(err) },
        "slack.ambient_drain.failed",
      );
    } finally {
      queue.draining = false;
      if (queue.pending.length === 0) ambientQueues.delete(key);
    }
  }

  async function handleChannelMessage(event: SlackChannelMessageEvent) {
    if (!gateway) return;
    const slackUserId = event.user;
    if (!slackUserId) return;

    const binding = await channelRegistry.resolveSlackBinding(event.channel);
    if (!binding || !binding.ambient) return;

    if (!(await isTermsAccepted(binding.owner))) {
      getLogger().debug(
        { agentId: binding.instanceName, channelId: event.channel },
        "slack.ambient_turn.skipped_terms",
      );
      return;
    }

    const fetchResult = await fetchSlackImages(gateway, event.files);
    const images = fetchResult.kind === "ok" ? fetchResult.images : [];
    const withheldNote =
      fetchResult.kind === "ok" ? renderWithheldNote(fetchResult.failures) : "";

    securityLog("info", "channel.authz", {
      category: "channel",
      actor: null,
      actorKind: "external",
      surface: "slack",
      agentId: binding.instanceName,
      decision: "allow",
      detail: {
        basis: "place",
        trigger: "ambient",
        slackUserId,
        channelId: event.channel,
      },
    });

    const text = `<@${slackUserId}>: ${event.text}${withheldNote}`;
    enqueueAmbient(event.channel, event.threadTs ?? null, {
      text,
      eventTs: event.ts,
      slackUserId,
      images,
    });
  }

  let gatewayFailed = false;
  let gatewayStarting: Promise<SlackGateway | null> | null = null;

  async function ensureGateway(): Promise<SlackGateway | null> {
    if (gateway) return gateway;
    if (gatewayFailed) return null;
    gatewayStarting ??= startGateway();
    return gatewayStarting;
  }

  async function startGateway(): Promise<SlackGateway | null> {
    try {
      const gw = createGateway();
      const connected = await gw.start({
        onMention: handleAppMention,
        onCommand: handleCommand,
        onMessage: handleChannelMessage,
        onDirectMessage: handleDirectMessage,
      });
      if (!connected) {
        gatewayFailed = true;
        process.stderr.write("[slack] Slack bot not connected\n");
        return null;
      }

      gateway = gw;
      process.stderr.write("Slack bot started (single app)\n");
      await reportMissingPermissions(gw);
      return gateway;
    } finally {
      gatewayStarting = null;
    }
  }

  return {
    type: ChannelType.Slack,

    async connect() {
      await ensureGateway();
    },

    async start(instanceName: string, _channel: StoredChannelConfig) {
      const started = await ensureGateway();
      if (!started) {
        process.stderr.write(
          `Slack: skipping ${instanceName} — bot not connected\n`,
        );
        return;
      }
      process.stderr.write(`Slack: registered ${instanceName}\n`);
    },

    async stop(instanceName: string) {
      process.stderr.write(`Slack: unregistered ${instanceName}\n`);
    },

    async stopAll() {
      if (gateway) {
        await gateway.stop();
        gateway = null;
      }
    },

    async listConversations(instanceName: string) {
      const boundChannelIds =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (boundChannelIds.length === 0) return [];

      let botChannels: SlackChannelInfo[] = [];
      const gw = await ensureGateway();
      if (gw) {
        try {
          botChannels = await gw.listBotChannels();
        } catch (err) {
          process.stderr.write(
            `[slack] listBotChannels failed: ${formatError(err)}\n`,
          );
        }
      }
      const bound = boundChannelIds.map((id) => {
        const info = botChannels.find((c) => c.id === id);
        return {
          id,
          title: info
            ? `#${info.name}`
            : isDirectMessageId(id)
              ? "Direct message"
              : id,
        };
      });
      const others = botChannels
        .filter((c) => !boundChannelIds.includes(c.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ id: c.id, title: `#${c.name}` }));
      return [...bound, ...others];
    },

    async postMessage(
      instanceName: string,
      text: string,
      options?: PostMessageOptions,
    ) {
      const boundChannelIds =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (boundChannelIds.length === 0) {
        return { error: "no channel connected" };
      }

      const gw = await ensureGateway();
      if (!gw) {
        return { error: "slack bot not running" };
      }

      const { conversationId, attachment } = options ?? {};
      if (!text && !attachment) {
        return { error: "nothing to send — pass text or an attachment" };
      }
      const target = await resolveOutboundTarget(
        gw,
        boundChannelIds,
        conversationId,
      );
      if ("error" in target) {
        return target;
      }

      const footer = await resolveAgentFooter(instanceName);
      const contextBlock = agentContextBlock(footer);

      try {
        if (text) {
          await gw.postMessage({
            channel: target.id,
            text,
            blocks: [{ type: "markdown", text }, contextBlock],
          });
        }
        if (attachment) {
          try {
            await gw.uploadFile({
              channelId: target.id,
              file: attachment.data,
              filename: attachment.filename,
              title: attachment.title,
              initialComment: text ? undefined : agentFooterMrkdwn(footer),
            });
          } catch (err) {
            return {
              error: text
                ? `message posted, but the attachment upload failed: ${formatError(err)}`
                : formatError(err),
            };
          }
        }
        return { ok: true as const };
      } catch (err) {
        return { error: formatError(err) };
      }
    },

    async reply(instanceName: string, args: ChannelReply) {
      const boundChannelIds =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (boundChannelIds.length === 0)
        return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };
      if (!args.text) return { error: "nothing to send — reply needs text" };

      let threadTs = args.threadTs;
      let turn: TurnRef | undefined;
      if (!threadTs) {
        const resolved = resolveTurn(instanceName, "reply");
        if ("ambiguous" in resolved) return { error: AMBIGUOUS_THREAD_ERROR };
        if ("none" in resolved) {
          return {
            error:
              "no active thread to reply to — use send_channel_message for a top-level post",
          };
        }
        threadTs = resolved.ref.threadTs;
        turn = resolved.ref;
      } else {
        const id = threadTs;
        turn = findTurnRef(instanceName, (ref) => ref.threadTs === id);
      }
      const target = await resolveOutboundTarget(
        gw,
        boundChannelIds,
        args.conversationId ?? turn?.channel,
      );
      if ("error" in target) return target;

      const footer = await resolveAgentFooter(instanceName, turn?.sessionId);
      try {
        await gw.postMessage({
          channel: target.id,
          threadTs,
          text: args.text,
          blocks: renderAssistantBlocks(footer, args.text),
          ...(args.alsoSendToChannel ? { replyBroadcast: true } : {}),
        });
        noteEngagedTurn(
          instanceName,
          (ref) => ref.threadTs === threadTs && ref.channel === target.id,
        );
        return { ok: true as const };
      } catch (err) {
        return { error: formatError(err) };
      }
    },

    async react(instanceName: string, args: ChannelReaction) {
      const boundChannelIds =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (boundChannelIds.length === 0)
        return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };

      let messageTs = args.messageTs;
      let turnChannel: string | undefined;
      if (!messageTs) {
        const turn = resolveTurn(instanceName, "react");
        if ("ambiguous" in turn) return { error: AMBIGUOUS_THREAD_ERROR };
        if ("none" in turn) return { error: "no message to react to" };
        messageTs = turn.ref.eventTs;
        turnChannel = turn.ref.channel;
      } else {
        const id = messageTs;
        turnChannel = findTurnRef(
          instanceName,
          (ref) => ref.eventTs === id,
        )?.channel;
      }
      const name = args.emoji.trim().replace(/^:+|:+$/g, "");
      if (!name) {
        return { error: 'emoji is required (a Slack short name like "eyes")' };
      }
      const target = await resolveOutboundTarget(
        gw,
        boundChannelIds,
        args.conversationId ?? turnChannel,
      );
      if ("error" in target) return target;

      try {
        await gw.addReaction({ channel: target.id, ts: messageTs, name });
        noteEngagedTurn(
          instanceName,
          (ref) => ref.eventTs === messageTs && ref.channel === target.id,
        );
        return { ok: true as const };
      } catch (err) {
        return { error: formatError(err) };
      }
    },

    async describeUsers(instanceName: string, userIds: string[]) {
      const boundChannelIds =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (boundChannelIds.length === 0)
        return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };

      const seen = new Set<string>();
      const requested: { raw: string; id: string | null }[] = [];
      for (const raw of userIds) {
        const id = normalizeSlackUserId(raw);
        if (id) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        requested.push({ raw, id });
      }

      const users = await Promise.all(
        requested.map(async ({ raw, id }): Promise<ChannelUser> => {
          if (!id) {
            return {
              id: raw,
              error:
                "not a Slack user id — pass the U… id as it appears in the conversation",
            };
          }
          const notFound = { id, error: "no such user in this workspace" };
          const cached = userCache.get(id);
          if (cached && cached.expiresAt > Date.now()) {
            return cached.user ? { ...cached.user } : notFound;
          }
          const release = await userLookupSemaphore.acquire();
          let info: SlackUserInfo | null;
          try {
            info = await gw.getUserInfo(id);
          } catch (err) {
            return { id, error: formatError(err) };
          } finally {
            release();
          }
          cacheUser(id, info);
          return info ? { ...info } : notFound;
        }),
      );
      return { users };
    },

    async supportsUserLookup() {
      const gw = await ensureGateway();
      return gw ? canLookupUsers(gw) : true;
    },

    async describeMessageReactions(
      instanceName: string,
      query: ReactionsQuery,
    ) {
      const boundChannelIds =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (boundChannelIds.length === 0)
        return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };

      let messageTs = query.messageTs;
      let turnChannel: string | undefined;
      if (!messageTs) {
        const turn = resolveTurn(instanceName, "react");
        if ("ambiguous" in turn) return { error: AMBIGUOUS_MESSAGE_ERROR };
        if ("none" in turn) {
          return {
            error: "no message to inspect — pass messageTs",
          };
        }
        messageTs = turn.ref.eventTs;
        turnChannel = turn.ref.channel;
      } else {
        const id = messageTs;
        turnChannel = findTurnRef(
          instanceName,
          (ref) => ref.eventTs === id,
        )?.channel;
      }
      const target = await resolveOutboundTarget(
        gw,
        boundChannelIds,
        query.conversationId ?? turnChannel,
      );
      if ("error" in target) return target;

      try {
        const reactions = await gw.getMessageReactions(target.id, messageTs);
        if (!reactions) return { error: "message not found" };
        return { reactions, conversationId: target.id, messageTs };
      } catch (err) {
        return { error: formatError(err) };
      }
    },

    async supportsMessageReactions() {
      const gw = await ensureGateway();
      return gw ? canReadReactions(gw) : true;
    },
  };
}
