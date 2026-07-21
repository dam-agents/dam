import { filter, merge, take, timeout } from "rxjs";
import { match, P } from "ts-pattern";
import { ChannelType, SessionType, type AgentsService } from "api-server-api";
import type { StoredChannelConfig } from "../stored-channel.js";
import type { PostMessageOptions } from "../services/channel-manager.js";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import {
  type AcpClient,
  type AcpClientFactory,
  type ForkAcpClientFactory,
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

const FORK_OUTCOME_TIMEOUT_MS = 2 * 60_000;

/** The exact reply an ambient prompt instructs the agent to give when it has
 *  nothing to add; the worker swallows it instead of posting. */
export const AMBIENT_DECLINE_TOKEN = "NO_RESPONSE";

/** Wrap an ambient message so the agent knows how it appears in the channel
 *  and may decline. The bot identity comes from the install's brand config;
 *  the agent's own name is deliberately NOT injected — that identity belongs
 *  to the agent's workspace setup ("the name you know yourself by" is its
 *  hook). Applied per turn: ambient sessions interleave with mention-driven
 *  turns, so the contract can't live in the session alone. */
function frameAmbientPrompt(
  text: string,
  brand: { name: string; short: string },
): string {
  return [
    "<ambient>",
    "You are reading along in a shared Slack channel, where you appear as " +
      `the bot "${brand.name}" (mentioned as @${brand.short}). The ` +
      "following message(s) were not @-mentions. A message that calls you " +
      `by name — "${brand.name}", or the name you know yourself by — is ` +
      "addressed to you: answer it as you would a mention. Otherwise chime " +
      "in only when you can clearly help — answer a question you know the " +
      "answer to, pick up a task someone described, or flag a clear " +
      "mistake. If in doubt, stay silent: reply with exactly " +
      `${AMBIENT_DECLINE_TOKEN} and nothing else.`,
    "</ambient>",
    "",
    text,
  ].join("\n");
}

function isAmbientDecline(response: string): boolean {
  // Tolerate the token arriving wrapped in whitespace, quotes, or backticks.
  // An empty turn (tool-only, silent stop) is a decline too — the mention
  // path's "(no response)" fallback would be unsolicited noise here.
  const stripped = response.trim().replace(/^[`"']+|[`"'.]+$/g, "");
  return stripped === "" || stripped === AMBIENT_DECLINE_TOKEN;
}

/** Session key for a channel's rolling ambient session: top-level channel
 *  messages share one session (the agent "reads along"), while thread replies
 *  keep their per-thread sessions. Slack thread_ts values are numeric, so the
 *  prefix cannot collide with a real thread key. */
function ambientThreadKey(channelId: string): string {
  return `ambient:${channelId}`;
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

async function getContextMessages(
  gateway: SlackGateway,
  channel: string,
  ts: string,
  threadTs?: string,
): Promise<string[]> {
  if (threadTs) {
    const messages = await gateway.getThreadReplies({
      channel,
      threadTs,
      limit: 50,
    });
    return messages
      .filter((m) => m.ts !== ts)
      .map((m) => `${m.user ?? "unknown"}: ${m.text}`);
  }

  const messages = await gateway.getChannelHistory({ channel, limit: 10 });
  return messages
    .filter((m) => m.ts !== ts)
    .reverse()
    .map((m) => `${m.user ?? "unknown"}: ${m.text}`);
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
        });
      } catch {
        return acp.sendPrompt(await args.buildFreshPrompt(), {
          platformMeta,
          onImagesDropped: args.onImagesDropped,
        });
      }
    }
    return acp.sendPrompt(await args.buildFreshPrompt(), {
      platformMeta,
      onImagesDropped: args.onImagesDropped,
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
    images: FetchedImage[];
  }) {
    if (!gateway) return;
    const gw = gateway;
    const { instanceName } = ctx;

    await gw.addReaction({
      channel: ctx.channel,
      ts: ctx.eventTs,
      name: "eyes",
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
      const resumePrompt: string | ContentBlock[] =
        ctx.images.length === 0
          ? ctx.text
          : [
              { type: "text", text: ctx.text },
              ...ctx.images.map((i) => i.block),
            ];
      const response = await runSessionTurn({
        instanceName,
        threadKey: ctx.threadTs,
        resumePrompt,
        buildFreshPrompt: () => buildThreadPrompt(gw, ctx),
        onWaking,
        onImagesDropped,
      });

      await postAssistantMessage(
        ctx.channel,
        ctx.threadTs,
        instanceName,
        response,
      );
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

  async function postAssistantMessage(
    channel: string,
    threadTs: string,
    instanceName: string,
    response: string,
  ) {
    if (!gateway) return;
    await gateway.postMessage({
      channel,
      threadTs,
      text: response || "(no response)",
      blocks: [
        { type: "markdown", text: response || "(no response)" },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `_${instanceName}_` }],
        },
      ],
    });
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
    images: FetchedImage[];
  }) {
    if (!gateway) return;

    await gateway.addReaction({
      channel: args.channel,
      ts: args.eventTs,
      name: "eyes",
    });

    const prompt = await buildThreadPrompt(gateway, {
      channel: args.channel,
      threadTs: args.threadTs,
      eventTs: args.eventTs,
      text: args.text,
      hasThread: args.hasThread,
      images: args.images,
    });
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
            hasThread: args.hasThread,
            instanceName: args.instanceName,
            slackUserId: args.slackUserId,
            actorSub: args.keycloakSub,
            prompt,
            images: args.images,
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
          const gw = gateway;
          if (!gw) return;
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
      hasThread: boolean;
      instanceName: string;
      slackUserId: string;
      actorSub: string;
      prompt: string | ContentBlock[];
      images: FetchedImage[];
    },
  ) {
    if (!gateway) return;
    const gw = gateway;

    await match(outcome)
      .with({ type: EventType.ForkReady }, async (event) => {
        let turnOutcome: TurnOutcome = "failure";
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
          const response = existing
            ? await acp.sendPrompt(ctx.prompt, {
                resumeSessionId: existing.sessionId,
                onImagesDropped,
              })
            : await acp.sendPrompt(ctx.prompt, {
                platformMeta: {
                  type: SessionType.ChannelSlack,
                  threadTs: ctx.threadTs,
                },
                onImagesDropped,
              });
          await postAssistantMessage(
            ctx.channel,
            ctx.threadTs,
            ctx.instanceName,
            response,
          );
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

  async function buildThreadPrompt(
    gw: SlackGateway,
    ctx: {
      channel: string;
      threadTs: string;
      eventTs: string;
      text: string;
      hasThread: boolean;
      images: FetchedImage[];
    },
  ): Promise<string | ContentBlock[]> {
    const contextMessages = await getContextMessages(
      gw,
      ctx.channel,
      ctx.eventTs,
      ctx.hasThread ? ctx.threadTs : undefined,
    );
    const parts: string[] = [];
    if (contextMessages.length > 0) {
      parts.push(`<context>\n${contextMessages.join("\n")}\n</context>`);
    }
    parts.push(ctx.text);
    const text = parts.join("\n\n");

    if (ctx.images.length === 0) return text;
    return [{ type: "text", text }, ...ctx.images.map((i) => i.block)];
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
          text: `<${bindUrl}|Connect an agent to this channel>. Everyone here will be able to drive it under the agent's own connected accounts and API tokens.`,
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
  // authorization as unbind. The flip is announced channel-visibly: it
  // changes what everyone here should expect, so it is not whispered to the
  // invoker alone.
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

    if (gateway) {
      try {
        await gateway.postMessage({
          channel: command.channelId,
          text: enable
            ? `\`${binding.instanceName}\` is now in ambient mode: it reads along in this channel and may chime in without being mentioned when it can clearly help. It still answers mentions as usual; run \`/${brandShort} ambient off\` to make it mentions-only again.`
            : `\`${binding.instanceName}\` left ambient mode — it now only responds when mentioned.`,
        });
      } catch (err) {
        process.stderr.write(
          `[slack] ambient announcement failed: ${formatError(err)}\n`,
        );
      }
    }

    const termsPending =
      enable && !(await isTermsAccepted(binding.owner))
        ? ` Heads-up: the person who connected this channel hasn't accepted the Terms of Use at ${uiBaseUrl} yet, so the agent stays silent until they do.`
        : "";
    await ack({
      text: `Ambient mode turned ${enable ? "on" : "off"}.${termsPending}`,
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

  async function handleAppMention(event: SlackMentionEvent) {
    if (!gateway) return;

    const slackUserId = event.user;
    if (!slackUserId) return;

    const threadTs = event.threadTs ?? event.ts;
    const binding = await channelRegistry.resolveSlackBinding(event.channel);
    if (!binding) {
      await gateway.postEphemeral({
        channel: event.channel,
        user: slackUserId,
        text: "No instance connected to this channel.",
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
        images,
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
      images,
    });
  }

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
    images: FetchedImage[];
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
      // Shared sessions are multi-speaker: label who is talking.
      text: `<@${args.slackUserId}>: ${args.text}`,
      hasThread: args.hasThread,
      actorSub: null,
      externalActorId: args.slackUserId,
      slackUserId: args.slackUserId,
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

    let outcome: TurnOutcome = "failure";
    let failureReason: string | undefined;
    const framed = frameAmbientPrompt(args.text, brand);
    const resumePrompt: string | ContentBlock[] =
      args.images.length === 0
        ? framed
        : [{ type: "text", text: framed }, ...args.images.map((i) => i.block)];

    const runTurn = () =>
      runSessionTurn({
        instanceName: args.instanceName,
        threadKey: args.threadKey,
        resumePrompt,
        buildFreshPrompt: () =>
          buildThreadPrompt(gw, {
            channel: args.channel,
            threadTs: args.threadKey,
            eventTs: args.eventTs,
            text: framed,
            hasThread: args.hasThread,
            images: args.images,
          }),
      });

    try {
      let response: string;
      try {
        response = await runTurn();
      } catch (err) {
        if (
          !isAgentWakeTimeoutError(err) ||
          !isTransientWakeFailure(err.failure)
        ) {
          throw err;
        }
        // Transient wake overrun: retry silently — no still-starting note.
        response = await runTurn();
      }
      if (!isAmbientDecline(response)) {
        await postAssistantMessage(
          args.channel,
          args.replyThreadTs,
          args.instanceName,
          response,
        );
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

  // Top-level ambient traffic is serialized per channel and coalesced:
  // messages arriving while a turn is in flight flush as one multi-message
  // prompt, so a busy channel never races concurrent prompts into the shared
  // ambient session (thread sessions keep the mention path's no-guard
  // semantics — ambient thread replies are comparatively rare).
  const ambientQueues = new Map<
    string,
    { pending: AmbientPendingMessage[]; draining: boolean }
  >();

  function enqueueAmbient(channelId: string, msg: AmbientPendingMessage) {
    let queue = ambientQueues.get(channelId);
    if (!queue) {
      queue = { pending: [], draining: false };
      ambientQueues.set(channelId, queue);
    }
    queue.pending.push(msg);
    if (!queue.draining) void drainAmbientQueue(channelId, queue);
  }

  async function drainAmbientQueue(
    channelId: string,
    queue: { pending: AmbientPendingMessage[]; draining: boolean },
  ) {
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
        const binding = await channelRegistry.resolveSlackBinding(channelId);
        if (!binding || binding.mode !== "shared" || !binding.ambient) {
          continue;
        }
        if (!(await isTermsAccepted(binding.owner))) {
          getLogger().debug(
            { agentId: binding.instanceName, channelId },
            "slack.ambient_turn.skipped_terms",
          );
          continue;
        }
        await relayAmbientTurn({
          instanceName: binding.instanceName,
          channel: channelId,
          threadKey: ambientThreadKey(channelId),
          replyThreadTs: last.eventTs,
          eventTs: last.eventTs,
          hasThread: false,
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
        { channelId, error: formatError(err) },
        "slack.ambient_drain.failed",
      );
    } finally {
      // No await between the empty check and this reset, so a message can't
      // slip past both; any later enqueue sees draining=false and re-kicks.
      queue.draining = false;
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

    const text = `<@${slackUserId}>: ${event.text}`;
    if (event.threadTs) {
      // Thread replies keep their per-thread session — the same key a
      // mention in that thread would resume.
      await relayAmbientTurn({
        instanceName: binding.instanceName,
        channel: event.channel,
        threadKey: event.threadTs,
        replyThreadTs: event.threadTs,
        eventTs: event.ts,
        hasThread: true,
        text,
        images,
        externalActorId: slackUserId,
      });
      return;
    }
    enqueueAmbient(event.channel, {
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
          title: bound ? `#${bound.name}` : slackChannelId,
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

      const contextBlock = {
        type: "context",
        elements: [{ type: "mrkdwn", text: `_${instanceName}_` }],
      };

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
              initialComment: text ? undefined : `_${instanceName}_`,
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
  };
}
