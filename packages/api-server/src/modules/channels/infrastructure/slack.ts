import { filter, merge, take, timeout } from "rxjs";
import { match, P } from "ts-pattern";
import {
  ambientThreadKey,
  ChannelType,
  SessionType,
  type AgentsService,
} from "api-server-api";
import type { StoredChannelConfig } from "../stored-channel.js";
import type {
  ChannelReaction,
  ChannelReply,
  PostMessageOptions,
} from "../services/channel-manager.js";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import {
  type AcpClient,
  type AcpClientFactory,
  type ForkAcpClientFactory,
  type PromptUpdate,
} from "../../../core/acp-client.js";
import {
  EventType,
  emit as defaultEmit,
  events$,
  ofType,
  type DomainEvent,
  type ForkFailed,
  type ForkReady,
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
  SlackSlashCommand,
} from "./slack-gateway.js";
import {
  createTurnPresenter,
  renderAssistantBlocks,
  type TurnPresenter,
} from "./slack-turn-presenter.js";
import {
  agentContextBlock,
  agentFooterMrkdwn,
  HISTORY_LEGEND,
  labelHistoryMessage,
  parseAgentFooter,
  type AgentFooter,
} from "./agent-footer.js";

const FORK_OUTCOME_TIMEOUT_MS = 2 * 60_000;

/** Per-turn contract prepended to every relayed Slack message. Plain assistant
 *  text is never delivered — the agent reaches the channel only by calling a
 *  tool. The concrete thread/message ids are injected so the agent can echo
 *  them back; the tools also fall back to the turn's most-recent ids when they
 *  are omitted. Re-stated every turn because mention, fork, and ambient turns
 *  interleave in the same sessions — the contract can't live in a session
 *  alone. The install's bot identity comes from the brand config; the agent's
 *  own name belongs to its workspace setup and is deliberately not injected. */
function slackTurnContract(ctx: {
  replyThreadTs: string;
  eventTs: string;
  brand: { name: string; short: string };
}): string {
  return [
    "<how-to-respond>",
    `You appear in this Slack workspace as the bot "${ctx.brand.name}" ` +
      `(mentioned as @${ctx.brand.short}). Nothing you write as plain text ` +
      "is delivered to Slack — only tool calls reach the channel. To " +
      "respond, call one of:",
    `• reply — post a message into this thread (threadTs="${ctx.replyThreadTs}").`,
    "• react — add a fitting emoji reaction to the message you're answering: a " +
      "quiet acknowledgement that notifies no one — pick an emoji that suits " +
      "the message (e.g. eyes on a bug report, tada on good news) " +
      `(messageTs="${ctx.eventTs}"). Pass the Slack emoji short name, no colons.`,
    "• no_reply_needed — end your turn without posting anything, when the " +
      "message doesn't call for a response.",
    "If a tool is deferred, load it via ToolSearch first.",
    "</how-to-respond>",
  ].join("\n");
}

/** Extra framing for ambient (read-along) turns: nobody @-mentioned the agent,
 *  so it chimes in only when it can clearly help and otherwise stays silent via
 *  `no_reply_needed`. When it does engage, it opens with a fitting reaction —
 *  the light-touch, in-channel signal that replaces the old automatic ack. */
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

/** Assemble the framed prompt for a turn: the contract first, then optional
 *  ambient guidance, then injected thread history (fresh sessions only), then
 *  the user's message — carrying any images as content blocks. */
function framePrompt(opts: {
  contract: string;
  guidance?: string;
  context?: string[];
  /** Explains the history attribution prefixes; emitted right before the
   *  `<context>` block when that history contains agent-authored lines. */
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

/** A 1:1 DM conversation (Slack `im`) always has an id starting with "D". Used
 *  to tailor DM-specific copy where the event's `channelType` isn't carried
 *  (e.g. some `app_mention` payloads) and to label a DM-bound conversation. */
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

async function fetchSlackImages(
  gateway: SlackGateway,
  files: SlackImageFile[] | undefined,
): Promise<FetchImagesResult> {
  const imageFiles = (files ?? []).filter((f) =>
    f.mimetype?.startsWith("image/"),
  );
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
        const buf = await gateway.downloadFile(f.url_private);
        const data = Buffer.from(buf).toString("base64");
        images.push({
          block: { type: "image", data, mimeType: f.mimetype },
          meta: { name: f.name, size: f.size },
        });
      } catch (err) {
        failures.push({ name: f.name, reason: formatError(err) });
      }
    }
    return { kind: "ok", images, failures };
  } finally {
    release();
  }
}

function renderTurnFiles(images: FetchedImage[]): string {
  if (images.length === 0) return "";
  const list = images
    .map((i) => `${i.meta.name} (${(i.meta.size / 1_000_000).toFixed(1)} MB)`)
    .join(", ");
  return `\nTurn included: ${list}.`;
}

/** Injected history for a fresh session, with each line attributed. Because one
 *  install-wide bot posts for every agent, a bot message's author is recovered
 *  from its footer, not its Slack user id: the reading agent's own posts become
 *  "you (this agent)", other agents are named, humans keep their id.
 *  `hasAgentAuthored` tells the caller whether to inject the explaining legend. */
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
  /** The binding (if any) for a Slack channel: agent, binding owner, the
   *  access mode (absent = person-scoped), and whether ambient mode is on
   *  (shared bindings only; absent = off). */
  resolveSlackBinding(slackChannelId: string): Promise<{
    instanceName: string;
    owner: string;
    mode?: "shared" | "person-scoped";
    ambient?: boolean;
  } | null>;
  resolveSlackChannelByInstance(agentId: string): Promise<string | null>;
}

export interface SlackWorker {
  type: ChannelType.Slack;
  /** Open the workspace socket-mode connection at startup, before any binding
   *  exists — inbound slash commands (`/<brand> login`), mentions and DMs must
   *  reach the bot in chats that have no binding yet, mirroring the Telegram
   *  bot. Idempotent and single-flight with the other gateway starters. */
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
}

export interface SlackOAuthPending {
  slackUserId: string;
  channelId: string;
  codeVerifier: string;
  /** Whether the callback just links identity (`login`) or also mints a bind
   *  flow and hands off to the agent picker (`bind`). */
  intent: "login" | "bind";
  createdAt: number;
}

/** Resolve an outbound conversationId to the Slack conversation to post into.
 *  The bound channel passes untouched; a user id opens a DM; any other
 *  channel must have the bot as a member. The one workspace bot is shared by
 *  all Agents, so its membership — governed Slack-side via /invite — is the
 *  reach boundary. */
async function resolveOutboundTarget(
  gateway: SlackGateway,
  boundChannelId: string,
  conversationId: string | undefined,
): Promise<{ id: string } | { error: string }> {
  if (!conversationId || conversationId === boundChannelId) {
    return { id: boundChannelId };
  }
  // Exactly one well-formed user id — conversations.open would accept a
  // comma-separated list and mint a group DM, which is not on offer here.
  if (/^[UW][A-Z0-9]+$/.test(conversationId)) {
    try {
      return { id: await gateway.openDirectMessage(conversationId) };
    } catch (err) {
      return {
        error: `could not open a direct message with ${conversationId}: ${formatError(err)}`,
      };
    }
  }
  // An existing DM conversation — Slack itself rejects DMs the bot is not
  // party to, and conversations.info carries no membership flag for them.
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
    // Private channels are invisible to the bot until it is invited, so
    // they surface here rather than on the membership branch below.
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

export function createSlackWorker(
  makeAcpClient: AcpClientFactory,
  createGateway: () => SlackGateway,
  agents: () => AgentsService,
  identityLinks: IdentityLinkService,
  oauthConfig: KeycloakOAuthConfig,
  pendingOAuthFlows: Map<string, SlackOAuthPending>,
  getInstanceOwner: (agentId: string) => Promise<string | null>,
  channelRegistry: ChannelRegistry,
  /** Delete the shared binding for a Slack channel, owner-agnostic. The in-chat
   *  unbind command authorizes the caller (binder or agent owner) before
   *  calling this; unlike the owner-scoped platform disconnect it runs
   *  system-side. */
  unbindSlackChannel: (slackChannelId: string) => Promise<void>,
  /** Flip ambient mode on a Slack binding, owner-agnostic. Same authorization
   *  story as `unbindSlackChannel`: the in-chat ambient command checks the
   *  caller (binder or agent owner) itself and runs system-side. */
  setSlackChannelAmbient: (
    slackChannelId: string,
    ambient: boolean,
  ) => Promise<void>,
  /** Install brand identity: `short` is the lowercase slash-command name
   *  (e.g. short="name" → /name login), `name` the bot display name the
   *  ambient frame announces. Sourced from BRAND_NAME / BRAND_SHORT env. */
  brand: { name: string; short: string },
  isTermsAccepted: (sub: string) => Promise<boolean>,
  uiBaseUrl: string,
  makeForkAcpClient: ForkAcpClientFactory,
  emit: (event: DomainEvent) => void = defaultEmit,
): SlackWorker {
  const brandShort = brand.short;
  let gateway: SlackGateway | null = null;

  /** A turn the `reply`/`react` tools can target when the agent doesn't echo
   *  ids: the thread to reply into and the message to react to. */
  type TurnRef = { channel: string; threadTs: string; eventTs: string };

  /** Turns currently driving the harness per agent. A single agent pod
   *  multiplexes every thread over one harness process and one MCP identity,
   *  so the outbound `reply`/`react` call carries no turn id — only the
   *  prompt-injected `threadTs` argument distinguishes them. This set is the
   *  fallback for when the agent omits it: with exactly one live turn the
   *  target is unambiguous; with several, guessing would post one thread's
   *  reply into another (#2952), so the tools refuse and ask for the id the
   *  prompt already gave. A turn joins when it starts driving the harness and
   *  leaves when its prompt settles; a wedged turn lingers until the ACP turn
   *  ceiling, which only forces id-less calls onto the injected id — never a
   *  mis-route. */
  const inFlightTurns = new Map<string, Set<TurnRef>>();

  /** The most recent turn per agent, never cleared — the last-active-thread
   *  fallback for a proactive `reply`/`react` made outside any live turn (e.g.
   *  from a scheduled session), mirroring Telegram. Consulted only when no turn
   *  is in flight. */
  const lastTurn = new Map<string, TurnRef>();

  function beginTurn(instanceName: string, ref: TurnRef) {
    lastTurn.set(instanceName, ref);
    let live = inFlightTurns.get(instanceName);
    if (!live) {
      live = new Set();
      inFlightTurns.set(instanceName, live);
    }
    live.add(ref);
  }

  function endTurn(instanceName: string, ref: TurnRef) {
    const live = inFlightTurns.get(instanceName);
    if (!live) return;
    live.delete(ref);
    if (live.size === 0) inFlightTurns.delete(instanceName);
  }

  /** Resolve the turn a reply/react targets when the agent passed no ids:
   *  the sole live turn, else the last-active-thread fallback, else `ambiguous`
   *  when several turns are live at once (the agent must name the thread). */
  function resolveTurn(
    instanceName: string,
  ): { ref: TurnRef } | { ambiguous: true } | { none: true } {
    const live = inFlightTurns.get(instanceName);
    if (live && live.size === 1) return { ref: [...live][0]! };
    if (live && live.size > 1) return { ambiguous: true };
    const last = lastTurn.get(instanceName);
    return last ? { ref: last } : { none: true };
  }

  const AMBIGUOUS_THREAD_ERROR =
    "This agent is handling more than one Slack thread right now — pass the " +
    'threadTs shown in your turn instructions (reply threadTs="…", react ' +
    'messageTs="…") so this lands in the thread you are answering.';

  /** Attribution footer for a post by `instanceName`: the agent's name linked to
   *  its UI page, with the id carried in the URL so the author can be recovered
   *  from injected history. The name lookup is best-effort — a lookup failure or
   *  a nameless agent degrades to the id as the (still clickable) link label. */
  async function resolveAgentFooter(
    instanceName: string,
  ): Promise<AgentFooter> {
    let agentName = instanceName;
    try {
      const agent = await agents().get(instanceName);
      if (agent?.name) agentName = agent.name;
    } catch {
      // best-effort — fall back to the id as the link label
    }
    return { uiBaseUrl, agentId: instanceName, agentName };
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

  async function findThreadSession(acp: AcpClient, threadTs: string) {
    const sessions = await acp.listSessions().catch((err) => {
      process.stderr.write(
        `[slack] listSessions failed: ${formatError(err)}\n`,
      );
      return [];
    });
    return sessions.find((s) => s.platform?.threadTs === threadTs) ?? null;
  }

  /** One ACP turn against the session keyed by `threadKey`
   *  (`_meta.platform.threadTs`): wake the pod, resume the matching session
   *  (falling back to a fresh context-injected one when resume fails), or
   *  create it. Returns the assistant response; posting is the caller's. */
  async function runSessionTurn(args: {
    instanceName: string;
    threadKey: string;
    resumePrompt: string | ContentBlock[];
    buildFreshPrompt: () => Promise<string | ContentBlock[]>;
    onWaking?: () => void;
    onImagesDropped?: () => void;
    /** Live per-update stream for the turn (omitted → no status presentation). */
    onUpdate?: (update: PromptUpdate) => void;
  }): Promise<string> {
    await agents().ensureReady(args.instanceName, { onWaking: args.onWaking });
    const acp = makeAcpClient(args.instanceName);
    const platformMeta = {
      type: SessionType.ChannelSlack,
      threadTs: args.threadKey,
    };
    const existing = await findThreadSession(acp, args.threadKey);
    if (existing) {
      try {
        return await acp.sendPrompt(args.resumePrompt, {
          resumeSessionId: existing.sessionId,
          onImagesDropped: args.onImagesDropped,
          onUpdate: args.onUpdate,
        });
      } catch {
        return acp.sendPrompt(await args.buildFreshPrompt(), {
          platformMeta,
          onImagesDropped: args.onImagesDropped,
          onUpdate: args.onUpdate,
        });
      }
    }
    return acp.sendPrompt(await args.buildFreshPrompt(), {
      platformMeta,
      onImagesDropped: args.onImagesDropped,
      onUpdate: args.onUpdate,
    });
  }

  async function relayOwnerTurn(ctx: {
    instanceName: string;
    channel: string;
    threadTs: string;
    eventTs: string;
    text: string;
    hasThread: boolean;
    /** Null on shared-mode relays; the Keycloak sub on person-scoped ones. */
    actorSub: string | null;
    externalActorId?: string;
    slackUserId: string;
    teamId?: string;
    images: FetchedImage[];
  }) {
    if (!gateway) return;
    const gw = gateway;
    const { instanceName } = ctx;

    // The thread/message the reply/react tools target when the agent doesn't
    // echo ids back. Registered inside the turn's `try` below (not here) so a
    // throw during turn setup can never leak an in-flight entry.
    const turnRef: TurnRef = {
      channel: ctx.channel,
      threadTs: ctx.threadTs,
      eventTs: ctx.eventTs,
    };

    // A running "working…" status is all the platform presents on the agent's
    // behalf — the reply itself only ever lands when the agent calls `reply`.
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

    // Requester-only heads-up on a cold start; suppressed on the retry
    // pass so a second window doesn't re-announce the same wake.
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

    const runTurn = async () => {
      const resumePrompt = framePrompt({
        contract,
        text: ctx.text,
        images: ctx.images,
      });
      // The response is not posted — the agent replies via the `reply` tool
      // during the turn. We only need to know the turn completed.
      await runSessionTurn({
        instanceName,
        threadKey: ctx.threadTs,
        resumePrompt,
        buildFreshPrompt: () => buildThreadPrompt(gw, ctx, contract),
        onWaking,
        onImagesDropped,
        onUpdate: presenter.onUpdate,
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
      // Wake timeouts get human copy mapped from the classified cause;
      // everything else keeps the raw path (out of scope here).
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
        // A transient timeout means the pods are progressing (e.g. a slow
        // image pull that legitimately outruns one window) — tell the
        // thread and wait one more window instead of losing the turn.
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
      endTurn(instanceName, turnRef);
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

  async function beginForeignTurn(args: {
    channel: string;
    threadTs: string;
    eventTs: string;
    slackUserId: string;
    keycloakSub: string;
    instanceName: string;
    text: string;
    hasThread: boolean;
    teamId?: string;
    images: FetchedImage[];
  }) {
    if (!gateway) return;
    const gw = gateway;

    // The fork's turn is registered in `handleForkOutcome`, once the fork pod is
    // ready and actually driving the harness — that is when its `reply`/`react`
    // calls arrive. Registering here would make this thread a spurious reply
    // target while the fork is still provisioning.

    // A running "working…" status while the fork provisions and runs; the fork
    // posts its own reply through the `reply` tool once it answers.
    const presenter = createTurnPresenter(gw, {
      channel: args.channel,
      threadTs: args.threadTs,
      instanceName: args.instanceName,
    });
    presenter.setThinking();

    const prompt = await buildThreadPrompt(
      gw,
      {
        instanceName: args.instanceName,
        channel: args.channel,
        threadTs: args.threadTs,
        eventTs: args.eventTs,
        text: args.text,
        hasThread: args.hasThread,
        images: args.images,
      },
      slackTurnContract({
        replyThreadTs: args.threadTs,
        eventTs: args.eventTs,
        brand,
      }),
    );
    const replyId = args.eventTs;

    const ready$ = events$().pipe(
      ofType<ForkReady>(EventType.ForkReady),
      filter((e) => e.replyId === replyId),
    );
    const failed$ = events$().pipe(
      ofType<ForkFailed>(EventType.ForkFailed),
      filter((e) => e.replyId === replyId),
    );
    merge(ready$, failed$)
      .pipe(take(1), timeout({ first: FORK_OUTCOME_TIMEOUT_MS }))
      .subscribe({
        next: (outcome) => {
          handleForkOutcome(outcome, {
            channel: args.channel,
            threadTs: args.threadTs,
            eventTs: args.eventTs,
            hasThread: args.hasThread,
            instanceName: args.instanceName,
            slackUserId: args.slackUserId,
            actorSub: args.keycloakSub,
            prompt,
            images: args.images,
            presenter,
          }).catch((err) => {
            process.stderr.write(
              `[slack/fork] outcome handler error: ${formatError(err)}\n`,
            );
          });
        },
        error: (err) => {
          process.stderr.write(
            `[slack/fork] fork outcome timeout for reply ${replyId}: ${formatError(err)}\n`,
          );
          void presenter.clearStatus();
          gw.postEphemeral({
            channel: args.channel,
            user: args.slackUserId,
            text: "Could not run turn as you: fork provisioning timed out. Try again or contact the instance owner.",
          }).catch((postErr) => {
            process.stderr.write(
              `[slack/fork] postEphemeral after timeout failed: ${formatError(postErr)}\n`,
            );
          });
        },
      });

    emit({
      type: EventType.ForeignReplyReceived,
      replyId,
      agentId: args.instanceName,
      foreignSub: args.keycloakSub,
      threadTs: args.threadTs,
      prompt,
      slackContext: {
        channelId: args.channel,
        userSlackId: args.slackUserId,
      },
    });
  }

  async function handleForkOutcome(
    outcome: ForkReady | ForkFailed,
    ctx: {
      channel: string;
      threadTs: string;
      eventTs: string;
      hasThread: boolean;
      instanceName: string;
      slackUserId: string;
      actorSub: string;
      prompt: string | ContentBlock[];
      images: FetchedImage[];
      presenter: TurnPresenter;
    },
  ) {
    if (!gateway) return;
    const gw = gateway;

    await match(outcome)
      .with({ type: EventType.ForkReady }, async (event) => {
        let turnOutcome: TurnOutcome = "failure";
        // The fork drives the harness from here; register its turn so its
        // `reply`/`react` calls resolve to this thread (and stay distinct from
        // any concurrent turn on the same agent).
        const turnRef: TurnRef = {
          channel: ctx.channel,
          threadTs: ctx.threadTs,
          eventTs: ctx.eventTs,
        };
        beginTurn(ctx.instanceName, turnRef);
        const onImagesDropped = () =>
          ephemeral(
            ctx.channel,
            ctx.slackUserId,
            ctx.hasThread ? ctx.threadTs : undefined,
            "This agent can't process images yet — answering text only.",
          );
        try {
          const acp = makeForkAcpClient(event.podIP);
          const existing = await findThreadSession(acp, ctx.threadTs);
          // The fork replies via the `reply` tool during its turn; the response
          // text is not posted here.
          if (existing) {
            await acp.sendPrompt(ctx.prompt, {
              resumeSessionId: existing.sessionId,
              onImagesDropped,
              onUpdate: ctx.presenter.onUpdate,
            });
          } else {
            await acp.sendPrompt(ctx.prompt, {
              platformMeta: {
                type: SessionType.ChannelSlack,
                threadTs: ctx.threadTs,
              },
              onImagesDropped,
              onUpdate: ctx.presenter.onUpdate,
            });
          }
          turnOutcome = "success";
        } catch (err) {
          process.stderr.write(
            `[slack/fork ${event.forkId}] ACP error: ${formatError(err)}\n`,
          );
          await gw.postMessage({
            channel: ctx.channel,
            threadTs: ctx.threadTs,
            text: `Error: ${formatError(err)}.${renderTurnFiles(ctx.images)}`,
          });
        } finally {
          endTurn(ctx.instanceName, turnRef);
          await ctx.presenter.clearStatus();
          emit({
            type: EventType.ChannelTurnRelayed,
            channel: "slack",
            agentId: ctx.instanceName,
            actorSub: ctx.actorSub,
            outcome: turnOutcome,
            forkId: event.forkId,
            ...(turnOutcome === "failure" ? { reason: "acp-error" } : {}),
          });
        }
      })
      .with({ type: EventType.ForkFailed }, async (event) => {
        await ctx.presenter.clearStatus();
        const detail = event.detail ? ` (${event.detail})` : "";
        try {
          await gw.postEphemeral({
            channel: ctx.channel,
            user: ctx.slackUserId,
            text: `Could not run turn as you: ${event.reason}${detail}.`,
          });
        } catch (err) {
          process.stderr.write(
            `[slack/fork] failed to notify ${ctx.slackUserId} of fork failure "${event.reason}": ${formatError(err)}\n`,
          );
        }
        // Emit with forkId so the on-channel-turn-relayed saga calls
        // closeFork — without this the failed fork orphans its k8s state.
        emit({
          type: EventType.ChannelTurnRelayed,
          channel: "slack",
          agentId: ctx.instanceName,
          actorSub: ctx.actorSub,
          outcome: "failure",
          forkId: event.forkId,
          reason: `fork-failed:${event.reason}`,
        });
      })
      .exhaustive();
  }

  /** The fresh-session prompt: the per-turn contract, optional ambient
   *  guidance, injected thread history, then the user's message. */
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
      contextLegend: hasAgentAuthored ? HISTORY_LEGEND : undefined,
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
        pendingOAuthFlows.set(state, {
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
        // Anyone in the channel may start a bind (no admin gate) — but the
        // agent picker that follows only lists the signed-in user's own
        // agents, so a channel only ever runs under an agent its binder owns.
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
        pendingOAuthFlows.set(state, {
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
          text: `Usage: \`/${brandShort} bind\`, \`/${brandShort} unbind\`, \`/${brandShort} ambient on|off\`, \`/${brandShort} login\`, or \`/${brandShort} logout\``,
        });
      })
      .exhaustive();
  }

  // The in-chat dial for ambient mode: `ambient` reports the state, `ambient
  // on|off` flips it — allowed for the binder or the agent's owner, same
  // authorization as unbind. The flip is confirmed to the invoker alone via
  // the ephemeral slash-command reply; it is audited but deliberately not
  // announced into the channel.
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
    if (binding.mode !== "shared") {
      await ack({
        text: "Ambient mode needs a shared connection — this channel is person-scoped. Disconnect the channel and reconnect it in shared mode first.",
      });
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

    // Confirm to the invoker only — no channel-visible announcement. The
    // ephemeral reply carries the full description the channel post used to.
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
  ): Promise<FetchedImage[] | null> {
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
        `Couldn't fetch attached image '${f.name}': ${f.reason}. Try resending.`,
      );
    }
    return images;
  }

  /** Copy for an inbound message that hit an unbound conversation. Channels
   *  keep the historical wording; DMs and group DMs instead point at the
   *  in-chat bind command — the only way to connect those surfaces. */
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

  /** Shared intake for an addressed turn: a channel/group-DM `@mention` or a
   *  plain message in a bound 1:1 DM. The only differences are the unbound copy
   *  and that a 1:1 DM's single-speaker prompt isn't speaker-labelled. */
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

    if (binding.mode === "shared") {
      const images = await fetchTurnImages(event, slackUserId);
      if (images === null) return;
      await relaySharedTurn({
        channel: event.channel,
        threadTs,
        eventTs: event.ts,
        text: event.text,
        hasThread: !!event.threadTs,
        slackUserId,
        instanceName: binding.instanceName,
        owner: binding.owner,
        teamId: event.teamId,
        images,
        // A 1:1 DM has exactly one human speaker, so labelling the prompt with
        // their Slack mention is redundant — keep the private DM prompt clean.
        speakerLabel: !opts.directMessage,
      });
      return;
    }

    const keycloakSub = await identityLinks.resolve("slack", slackUserId);
    if (!keycloakSub) {
      // An unlinked (unauthenticated) Slack user probing to drive an agent.
      securityLog("warn", "channel.authz_deny", {
        category: "channel",
        actor: null,
        actorKind: "external",
        surface: "slack",
        decision: "deny",
        reason: "unlinked",
        detail: { slackUserId, channelId: event.channel },
      });
      await gateway.postEphemeral({
        channel: event.channel,
        user: slackUserId,
        text: `You need to link your account first. Use \`/${brandShort} login\` to get started.`,
      });
      return;
    }

    const images = await fetchTurnImages(event, slackUserId);
    if (images === null) return;

    await routeReply({
      channel: event.channel,
      threadTs,
      eventTs: event.ts,
      text: event.text,
      hasThread: !!event.threadTs,
      slackUserId,
      keycloakSub,
      instanceName: binding.instanceName,
      teamId: event.teamId,
      images,
    });
  }

  // A channel or group-DM `@mention` (`app_mention`). A 1:1 DM's messages
  // arrive reliably via message.im (→ handleDirectMessage), so an app_mention
  // for the same DM — if Slack fires one at all — is a duplicate; drop it so
  // the turn isn't processed twice.
  const handleAppMention = (event: SlackMentionEvent) =>
    isDirectMessageId(event.channel)
      ? Promise.resolve()
      : handleInbound(event, { directMessage: false });

  // A plain message in a 1:1 DM (`message.im`): every DM message is addressed
  // to the bot, so a bound DM relays it without an @mention.
  const handleDirectMessage = (event: SlackMentionEvent) =>
    handleInbound(event, { directMessage: true });

  // Shared mode: the binding is the authorization — anyone Slack
  // admits to the channel drives the agent under the agent's credentials.
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
    /** Prefix the prompt with the speaker's Slack mention (multi-speaker
     *  channels/group DMs). Defaults to true; a 1:1 DM passes false. */
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

    // The binding owner lends the credentials, so their ToU acceptance gates
    // every shared turn — mirrors Telegram's binding.authorizedBy gate.
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
      // Shared channels/group DMs are multi-speaker: label who is talking. A
      // 1:1 DM has a single human, so its prompt goes through unlabelled.
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

  // Ambient turns stay out of the channel's way: no reaction, no wake
  // notices, and failures are logged, never posted — nobody summoned the
  // agent, so there is nothing to apologize for in-channel.
  async function relayAmbientTurn(args: {
    instanceName: string;
    channel: string;
    /** `_meta.platform.threadTs` session key: the real thread_ts for thread
     *  replies, the synthetic ambient key for top-level channel flow. */
    threadKey: string;
    /** Where a reply (if the agent chimes in) is threaded. */
    replyThreadTs: string;
    /** The triggering message ts, excluded from injected context. */
    eventTs: string;
    hasThread: boolean;
    /** Speaker-labelled; multi-line when messages were coalesced. */
    text: string;
    images: FetchedImage[];
    externalActorId: string;
  }) {
    if (!gateway) return;
    const gw = gateway;

    // A reply (if the agent chimes in) threads under the triggering message; a
    // react targets that message. No 👀 ack and no status — ambient stays out
    // of the channel's way until the agent decides to speak.
    const turnRef: TurnRef = {
      channel: args.channel,
      threadTs: args.replyThreadTs,
      eventTs: args.eventTs,
    };
    beginTurn(args.instanceName, turnRef);

    let outcome: TurnOutcome = "failure";
    let failureReason: string | undefined;
    const contract = slackTurnContract({
      replyThreadTs: args.replyThreadTs,
      eventTs: args.eventTs,
      brand,
    });
    const guidance = ambientGuidance(brand);
    const resumePrompt = framePrompt({
      contract,
      guidance,
      text: args.text,
      images: args.images,
    });

    const runTurn = () =>
      runSessionTurn({
        instanceName: args.instanceName,
        threadKey: args.threadKey,
        resumePrompt,
        buildFreshPrompt: () =>
          buildThreadPrompt(
            gw,
            {
              instanceName: args.instanceName,
              channel: args.channel,
              threadTs: args.threadKey,
              eventTs: args.eventTs,
              text: args.text,
              hasThread: args.hasThread,
              images: args.images,
            },
            contract,
            guidance,
          ),
      });

    try {
      // The response is not posted — the agent chimes in via the `reply`/`react`
      // tools, or stays silent via `no_reply_needed`.
      try {
        await runTurn();
      } catch (err) {
        if (
          !isAgentWakeTimeoutError(err) ||
          !isTransientWakeFailure(err.failure)
        ) {
          throw err;
        }
        // Transient wake overrun: retry silently — no still-starting note.
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
      endTurn(args.instanceName, turnRef);
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
    /** Speaker-labelled message text. */
    text: string;
    eventTs: string;
    slackUserId: string;
    images: FetchedImage[];
  };

  // Ambient traffic is serialized per session and coalesced: messages that
  // arrive while a turn is in flight flush as one multi-message prompt, so a
  // burst never races concurrent prompts into the same read-along session. The
  // queue key is per-channel for top-level flow (the channel's synthetic
  // ambient session) and per-thread for a thread's read-along (its own
  // session); `threadTs === null` selects which. Both must coalesce — several
  // concurrent turns on one thread session let the runtime's per-session prompt
  // queue silently drop the losers when their short-lived connections tear
  // down, so read-along messages vanished with no trace.
  type AmbientQueue = {
    channelId: string;
    /** The thread's real `thread_ts` for a thread's read-along session, or
     *  `null` for the channel's synthetic top-level ambient session. */
    threadTs: string | null;
    pending: AmbientPendingMessage[];
    draining: boolean;
  };
  const ambientQueues = new Map<string, AmbientQueue>();

  /** One queue per ambient session: the channel's top-level flow and each of
   *  its threads drain independently (different sessions run concurrently), but
   *  every message within a session is serialized and coalesced. */
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
        // Re-resolve: the binding may have been unbound, dialed back to
        // mentions-only, or rebound to a different owner while the batch
        // waited — the ToU gate must hold against the owner whose
        // credentials actually run the turn, so it is re-checked here too.
        const binding = await channelRegistry.resolveSlackBinding(
          queue.channelId,
        );
        if (!binding || binding.mode !== "shared" || !binding.ambient) {
          continue;
        }
        if (!(await isTermsAccepted(binding.owner))) {
          getLogger().debug(
            { agentId: binding.instanceName, channelId: queue.channelId },
            "slack.ambient_turn.skipped_terms",
          );
          continue;
        }
        // A thread's read-along resumes the thread's own session (the same key
        // a mention there resumes) and threads its reply back into the thread;
        // top-level flow uses the channel's rolling ambient session and opens a
        // reply thread under the batch's newest message.
        const inThread = queue.threadTs !== null;
        await relayAmbientTurn({
          instanceName: binding.instanceName,
          channel: queue.channelId,
          threadKey: inThread
            ? queue.threadTs!
            : ambientThreadKey(queue.channelId),
          replyThreadTs: inThread ? queue.threadTs! : last.eventTs,
          eventTs: last.eventTs,
          hasThread: inThread,
          text: batch.map((m) => m.text).join("\n"),
          images: batch.flatMap((m) => m.images),
          externalActorId: last.slackUserId,
        });
      }
    } catch (err) {
      // The drain floats outside any awaited chain — a rejection here (e.g.
      // a transient DB error resolving the binding) must never escape as an
      // unhandled rejection. The dropped batch stays dropped (ambient turns
      // fail silently); the next message re-kicks the drain.
      getLogger().warn(
        { channelId: queue.channelId, error: formatError(err) },
        "slack.ambient_drain.failed",
      );
    } finally {
      // No await between the empty check and this reset, so a message can't
      // slip past both; any later enqueue sees draining=false and re-kicks.
      queue.draining = false;
      // Drop a fully-drained queue so per-thread entries don't accumulate for
      // the channel's lifetime; a later message recreates it. Guarded on empty
      // so a batch the catch above left pending is not discarded.
      if (queue.pending.length === 0) ambientQueues.delete(key);
    }
  }

  // Ambient inbound: a channel message that mentioned nobody. Only shared
  // bindings with ambient on relay it; everything else drops silently — the
  // sender did not address the agent, so there is nothing to explain.
  async function handleChannelMessage(event: SlackChannelMessageEvent) {
    if (!gateway) return;
    const slackUserId = event.user;
    if (!slackUserId) return;

    const binding = await channelRegistry.resolveSlackBinding(event.channel);
    if (!binding || binding.mode !== "shared" || !binding.ambient) return;

    // The binding owner's ToU acceptance gates ambient turns like any shared
    // turn — but silently: an ephemeral would ping people who never asked.
    if (!(await isTermsAccepted(binding.owner))) {
      getLogger().debug(
        { agentId: binding.instanceName, channelId: event.channel },
        "slack.ambient_turn.skipped_terms",
      );
      return;
    }

    // Images ride along when they fit; ambient turns never post error
    // ephemerals, so oversized or unfetchable attachments just drop.
    const fetchResult = await fetchSlackImages(gateway, event.files);
    const images = fetchResult.kind === "ok" ? fetchResult.images : [];

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

    // Both thread and top-level read-along traffic coalesce through the queue,
    // keyed per-session so a burst is serialized into one turn rather than
    // racing concurrent prompts into the shared session. A thread reply keys on
    // its own thread_ts (the same session a mention there resumes); top-level
    // flow keys on the channel's rolling ambient session.
    const text = `<@${slackUserId}>: ${event.text}`;
    enqueueAmbient(event.channel, event.threadTs ?? null, {
      text,
      eventTs: event.ts,
      slackUserId,
      images,
    });
  }

  async function routeReply(args: {
    channel: string;
    threadTs: string;
    eventTs: string;
    text: string;
    hasThread: boolean;
    slackUserId: string;
    keycloakSub: string;
    instanceName: string;
    teamId?: string;
    images: FetchedImage[];
  }) {
    if (!gateway) return;

    const [ownerSub, isAllowed] = await Promise.all([
      getInstanceOwner(args.instanceName),
      agents().isAllowedUser(args.instanceName, args.keycloakSub),
    ]);
    const isOwner = ownerSub !== null && ownerSub === args.keycloakSub;
    if (!isOwner && !isAllowed) {
      // A linked user who is neither owner nor on the allow-list tried to
      // drive the agent.
      securityLog("warn", "channel.authz_deny", {
        category: "channel",
        actor: args.keycloakSub,
        actorKind: "user",
        surface: "slack",
        agentId: args.instanceName,
        decision: "deny",
        reason: "not-allowed",
        detail: { slackUserId: args.slackUserId, channelId: args.channel },
      });
      await gateway.postEphemeral({
        channel: args.channel,
        user: args.slackUserId,
        text: "You don't have access to this instance. Contact the instance owner to be added to the allowed users list.",
      });
      return;
    }
    // Authorized to drive — record who and on what basis.
    securityLog("info", "channel.authz", {
      category: "channel",
      actor: args.keycloakSub,
      actorKind: "user",
      surface: "slack",
      agentId: args.instanceName,
      decision: "allow",
      detail: { basis: isOwner ? "owner" : "allowlist" },
    });

    if (!(await isTermsAccepted(args.keycloakSub))) {
      await gateway.postEphemeral({
        channel: args.channel,
        user: args.slackUserId,
        text: `Open ${uiBaseUrl} to accept the Terms of Use before sending messages.`,
      });
      return;
    }

    if (!isOwner) {
      await beginForeignTurn(args);
      return;
    }

    await relayOwnerTurn({
      instanceName: args.instanceName,
      channel: args.channel,
      threadTs: args.threadTs,
      eventTs: args.eventTs,
      text: args.text,
      hasThread: args.hasThread,
      actorSub: args.keycloakSub,
      slackUserId: args.slackUserId,
      teamId: args.teamId,
      images: args.images,
    });
  }

  let gatewayFailed = false;
  let gatewayStarting: Promise<SlackGateway | null> | null = null;

  // Single-flight: a connect emits SlackConnected (whose handler starts the
  // worker) while the same request may already be posting an announcement —
  // both paths must share one start, never race two socket connections.
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
      const slackChannelId =
        await channelRegistry.resolveSlackChannelByInstance(instanceName);
      if (!slackChannelId) return [];

      // The bound channel leads (agents treat chats[0] as their home
      // surface), then every other channel the bot is a member of.
      // Discovery failure (bot down, missing scopes) degrades to the
      // bound channel alone. ensureGateway: like outbound posts, a
      // describe_channel can arrive before any inbound event started
      // the gateway.
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
      const bound = botChannels.find((c) => c.id === slackChannelId);
      const others = botChannels
        .filter((c) => c.id !== slackChannelId)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ id: c.id, title: `#${c.name}` }));
      return [
        {
          id: slackChannelId,
          title: bound
            ? `#${bound.name}`
            : isDirectMessageId(slackChannelId)
              ? "Direct message"
              : slackChannelId,
        },
        ...others,
      ];
    },

    async postMessage(
      instanceName: string,
      text: string,
      options?: PostMessageOptions,
    ) {
      // The binding is the Agent's membership card into the workspace: no
      // binding, no Slack outbound — even though the workspace bot exists.
      const slackChannelId =
        await channelRegistry.resolveSlackChannelByInstance(instanceName);
      if (!slackChannelId) {
        return { error: "no channel connected" };
      }

      // Outbound may arrive before any inbound event started the gateway —
      // e.g. the announcement posted right after the first-ever connect,
      // which races the SlackConnected handler's fire-and-forget start.
      const gw = await ensureGateway();
      if (!gw) {
        return { error: "slack bot not running" };
      }

      const { conversationId, attachment } = options ?? {};
      // Refuse before resolving: an empty send to a user id would still
      // open a DM conversation as a side effect.
      if (!text && !attachment) {
        return { error: "nothing to send — pass text or an attachment" };
      }
      const target = await resolveOutboundTarget(
        gw,
        slackChannelId,
        conversationId,
      );
      if ("error" in target) {
        return target;
      }

      const footer = await resolveAgentFooter(instanceName);
      const contextBlock = agentContextBlock(footer);

      try {
        // Two-message pattern when there's both text and a file: post the
        // text via postMessage (full markdown rendering) then upload the file
        // as a separate message. uploadFile with blocks gives a narrower
        // mrkdwn subset and was returning internal_error on Slack's side for
        // some block shapes — keeping the upload simple side-steps both issues
        // and gives consistent text formatting in either path.
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
            // The text message (if any) already landed — say so, or the
            // caller (and the audit trail reading its result) would take
            // the whole send for undelivered.
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
      const slackChannelId =
        await channelRegistry.resolveSlackChannelByInstance(instanceName);
      if (!slackChannelId) return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };
      if (!args.text) return { error: "nothing to send — reply needs text" };

      let threadTs = args.threadTs;
      if (!threadTs) {
        const turn = resolveTurn(instanceName);
        if ("ambiguous" in turn) return { error: AMBIGUOUS_THREAD_ERROR };
        if ("none" in turn) {
          return {
            error:
              "no active thread to reply to — use send_channel_message for a top-level post",
          };
        }
        threadTs = turn.ref.threadTs;
      }
      const target = await resolveOutboundTarget(
        gw,
        slackChannelId,
        args.conversationId,
      );
      if ("error" in target) return target;

      const footer = await resolveAgentFooter(instanceName);
      try {
        await gw.postMessage({
          channel: target.id,
          threadTs,
          text: args.text,
          blocks: renderAssistantBlocks(footer, args.text),
        });
        return { ok: true as const };
      } catch (err) {
        return { error: formatError(err) };
      }
    },

    async react(instanceName: string, args: ChannelReaction) {
      const slackChannelId =
        await channelRegistry.resolveSlackChannelByInstance(instanceName);
      if (!slackChannelId) return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };

      let messageTs = args.messageTs;
      if (!messageTs) {
        const turn = resolveTurn(instanceName);
        if ("ambiguous" in turn) return { error: AMBIGUOUS_THREAD_ERROR };
        if ("none" in turn) return { error: "no message to react to" };
        messageTs = turn.ref.eventTs;
      }
      // Slack wants the bare short name; tolerate :colons: or an accidental
      // leading/trailing space.
      const name = args.emoji.trim().replace(/^:+|:+$/g, "");
      if (!name) {
        return { error: 'emoji is required (a Slack short name like "eyes")' };
      }
      const target = await resolveOutboundTarget(
        gw,
        slackChannelId,
        args.conversationId,
      );
      if ("error" in target) return target;

      try {
        await gw.addReaction({ channel: target.id, ts: messageTs, name });
        return { ok: true as const };
      } catch (err) {
        // Bad emoji name, already_reacted, or a missing scope surface to the
        // agent as a tool error rather than aborting its turn.
        return { error: formatError(err) };
      }
    },
  };
}
