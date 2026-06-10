import { filter, merge, take, timeout } from "rxjs";
import { match, P } from "ts-pattern";
import { ChannelType, SessionType, type AgentsService } from "api-server-api";
import type { StoredChannelConfig } from "../stored-channel.js";
import type { PostMessageOptions } from "../services/channel-manager.js";
import type { ContentBlock } from "@agentclientprotocol/sdk/dist/schema/types.gen.js";
import {
  createAcpClient,
  createForkAcpClient,
  type AcpClient,
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
import { securityLog } from "../../../core/security-log.js";
import type {
  SlackAck,
  SlackGateway,
  SlackImageFile,
  SlackMentionEvent,
  SlackSlashCommand,
} from "./slack-gateway.js";

const FORK_OUTCOME_TIMEOUT_MS = 2 * 60_000;

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
  resolveInstanceBySlackChannel(slackChannelId: string): Promise<string | null>;
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
  createdAt: number;
}

export function createSlackWorker(
  namespace: string,
  createGateway: () => SlackGateway,
  agents: () => AgentsService,
  identityLinks: IdentityLinkService,
  oauthConfig: KeycloakOAuthConfig,
  pendingOAuthFlows: Map<string, SlackOAuthPending>,
  getInstanceOwner: (agentId: string) => Promise<string | null>,
  channelRegistry: ChannelRegistry,
  /** Lowercase brand identifier used in slash-command help text (e.g.
   *  brandShort="name" → /name login). Sourced from BRAND_SHORT env var. */
  brandShort: string,
  isTermsAccepted: (sub: string) => Promise<boolean>,
  uiBaseUrl: string,
  emit: (event: DomainEvent) => void = defaultEmit,
): SlackWorker {
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

  async function relayOwnerTurn(ctx: {
    instanceName: string;
    channel: string;
    threadTs: string;
    eventTs: string;
    text: string;
    hasThread: boolean;
    actorSub: string;
    slackUserId: string;
    images: FetchedImage[];
  }) {
    if (!gateway) return;
    const { instanceName } = ctx;

    await gateway.addReaction({
      channel: ctx.channel,
      ts: ctx.eventTs,
      name: "eyes",
    });

    let outcome: TurnOutcome = "failure";
    const onImagesDropped = () =>
      ephemeral(
        ctx.channel,
        ctx.slackUserId,
        ctx.hasThread ? ctx.threadTs : undefined,
        "This agent can't process images yet — answering text only.",
      );
    try {
      await agents().ensureReady(instanceName);
      const acp = createAcpClient({ namespace, instanceName });
      const platformMeta = {
        type: SessionType.ChannelSlack,
        threadTs: ctx.threadTs,
      };

      let response: string;
      const existing = await findThreadSession(acp, ctx.threadTs);
      const resumePrompt: string | ContentBlock[] =
        ctx.images.length === 0
          ? ctx.text
          : [
              { type: "text", text: ctx.text },
              ...ctx.images.map((i) => i.block),
            ];

      if (existing) {
        try {
          response = await acp.sendPrompt(resumePrompt, {
            resumeSessionId: existing.sessionId,
            onImagesDropped,
          });
        } catch {
          const prompt = await buildThreadPrompt(gateway, ctx);
          response = await acp.sendPrompt(prompt, {
            platformMeta,
            onImagesDropped,
          });
        }
      } else {
        const prompt = await buildThreadPrompt(gateway, ctx);
        response = await acp.sendPrompt(prompt, {
          platformMeta,
          onImagesDropped,
        });
      }

      await postAssistantMessage(
        ctx.channel,
        ctx.threadTs,
        instanceName,
        response,
      );
      outcome = "success";
    } catch (err) {
      process.stderr.write(
        `[${instanceName}] ACP error: ${formatError(err)}\n`,
      );
      await gateway.postMessage({
        channel: ctx.channel,
        threadTs: ctx.threadTs,
        text: `Error: ${formatError(err)}.${renderTurnFiles(ctx.images)}`,
      });
    } finally {
      emit({
        type: EventType.ChannelTurnRelayed,
        channel: "slack",
        agentId: instanceName,
        actorSub: ctx.actorSub,
        outcome,
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
          const acp = createForkAcpClient({ podIP: event.podIP });
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
      .with(P.string, async () => {
        await ack({
          text: `Usage: \`/${brandShort} login\` or \`/${brandShort} logout\``,
        });
      })
      .exhaustive();
  }

  async function handleAppMention(event: SlackMentionEvent) {
    if (!gateway) return;

    const slackUserId = event.user;
    if (!slackUserId) return;

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

    const threadTs = event.threadTs ?? event.ts;
    const instanceName = await channelRegistry.resolveInstanceBySlackChannel(
      event.channel,
    );
    if (!instanceName) {
      await gateway.postEphemeral({
        channel: event.channel,
        user: slackUserId,
        text: "No instance connected to this channel.",
      });
      return;
    }

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
      return;
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

    await routeReply({
      channel: event.channel,
      threadTs,
      eventTs: event.ts,
      text: event.text,
      hasThread: !!event.threadTs,
      slackUserId,
      keycloakSub,
      instanceName,
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

  async function ensureGateway(): Promise<SlackGateway | null> {
    if (gateway) return gateway;
    if (gatewayFailed) return null;

    const gw = createGateway();
    const connected = await gw.start({
      onMention: handleAppMention,
      onCommand: handleCommand,
    });
    if (!connected) {
      gatewayFailed = true;
      process.stderr.write("[slack] Slack bot not connected\n");
      return null;
    }

    gateway = gw;
    process.stderr.write("Slack bot started (single app)\n");
    return gateway;
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
      return slackChannelId
        ? [{ id: slackChannelId, title: slackChannelId }]
        : [];
    },

    async postMessage(
      instanceName: string,
      text: string,
      options?: PostMessageOptions,
    ) {
      const slackChannelId =
        await channelRegistry.resolveSlackChannelByInstance(instanceName);
      if (!slackChannelId) {
        return { error: "no channel connected" };
      }

      const { conversationId, attachment } = options ?? {};
      if (conversationId && conversationId !== slackChannelId) {
        return {
          error: `conversationId ${conversationId} does not match the channel bound to this instance (${slackChannelId})`,
        };
      }

      if (!gateway) {
        return { error: "slack bot not running" };
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
          await gateway.postMessage({
            channel: slackChannelId,
            text,
            blocks: [{ type: "markdown", text }, contextBlock],
          });
        }
        if (attachment) {
          await gateway.uploadFile({
            channelId: slackChannelId,
            file: attachment.data,
            filename: attachment.filename,
            title: attachment.title,
            initialComment: text ? undefined : `_${instanceName}_`,
          });
        }
        return { ok: true as const };
      } catch (err) {
        return { error: formatError(err) };
      }
    },
  };
}
