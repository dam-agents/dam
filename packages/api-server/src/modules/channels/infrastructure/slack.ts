import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { parseAvatar, SLACK_EMOJI_INDEX } from "api-server-api/avatar/svg";
import type { TtlStore } from "../../../core/ttl-store.js";
import { createTtlMap, type TtlMap } from "../../../core/ttl-map.js";
import {
  annotateSpan,
  inBackgroundSpan,
} from "../../../core/background-span.js";
import type { ChannelTurnAttendance } from "../../../core/turn-attendance.js";
import {
  addressedGuidance,
  ambientGuidance,
  botHistoryLabel,
  slackTurnContract,
  type AmbientPeerReply,
  type SlackTurnRoster,
  type SlackTurnWhisper,
  postDeletedNotice,
  supersededTurnNote,
} from "./slack-turn-copy.js";
import { match, P } from "ts-pattern";
import type { SlackConversationStanding } from "../services/slack-workspace-probe.js";
import {
  pickableSlackChannels,
  type SlackChannelChoices,
  type SlackChannelMembership,
  type SlackWorkspaceReach,
} from "../domain/slack-channel-choices.js";
import {
  ambientThreadKey,
  isAmbientThreadKey,
  slackChannelIdFromThreadKey,
  slackThreadKey,
  ChannelType,
  SessionType,
  type Agent,
  type AgentsService,
  type SlackConversationLabel,
} from "api-server-api";
import {
  classifyInboundAttachment,
  type InboundAttachment,
} from "../inbound-image.js";
import {
  inboundFilePath,
  looksLikeSignInPage,
  promptSafeName,
  wasSentAsImage,
  MAX_FILE_BYTES,
  TOTAL_FILE_BYTES_CAP,
} from "../inbound-file.js";
import {
  createAttachmentBudget,
  encodedFootprint,
  stagedFootprint,
  type AttachmentBudget,
  type AttachmentClaim,
} from "../attachment-budget.js";
import type { AgentWorkspaceFilesFactory } from "./agent-workspace-files.js";
import type {
  AddressedWorker,
  AttachmentQuery,
  ChannelAttachment,
  ChannelCard,
  ChannelHistoryQuery,
  ChannelReaction,
  ChannelReply,
  ChannelSendResult,
  ChannelUser,
  ChannelWorker,
  MessageLinkQuery,
  PostMessageOptions,
  ReactionsQuery,
  ThreadLeave,
  ThreadQuery,
  ThreadStart,
} from "../services/worker-contract.js";
import {
  createMemorySlackOwnedThreads,
  type SlackOwnedThread,
  type SlackOwnedThreads,
} from "./slack-owned-threads-repository.js";
import {
  ownedThreadGuidance,
  ownedThreadMessages,
  type OwnedThreadBatch,
} from "./slack-owned-thread-copy.js";
import type { ContentBlock } from "@agentclientprotocol/sdk";
import {
  AcpModelCallFailedError,
  AcpModelRefusedError,
  AcpSessionLoadError,
  pairFields,
  AcpTurnAbandonedError,
  type AcpClient,
  type AcpClientFactory,
  type AcpSessionInfo,
  type PromptUpdate,
} from "../../../core/acp-client.js";
import type { ChannelPair } from "./channel-profile.js";
import { classifyTurnFailure } from "./turn-failure-copy.js";
import { createTurnRecovery, type WatchedTurnEnd } from "./turn-recovery.js";
import {
  EventType,
  emit as defaultEmit,
  type DomainEvent,
  type TurnOutcome,
} from "../../../events.js";
import type {
  ExternalLink,
  IdentityLinkService,
} from "./../services/identity-link-service.js";
import type { ChannelOwner } from "./owner-copy.js";
import {
  buildAuthorizeUrl,
  generatePkce,
  type KeycloakOAuthConfig,
} from "./identity-oauth.js";
import { formatError } from "../../../core/format-error.js";
import { channelDeny } from "./channel-authz.js";
import type { AgentIconUrl } from "./agent-avatar-icons.js";
import { getLogger } from "../../../core/logger.js";
import { securityLog } from "../../../core/security-log.js";
import {
  isNewOutOfMemoryRestart,
  type PodRestartState,
} from "../../agents/index.js";
import {
  slackResetTime,
  spendHoldUserCopy,
  type ChannelSpendHold,
} from "./spend-hold-copy.js";
import {
  lookUpProviderOutage,
  slackProviderOutageCopy,
  type ChannelProviderOutage,
} from "./provider-outage-copy.js";
import { runWhileAgentStarts, type WakeWaitOptions } from "./wake-wait.js";
import { FileTooLargeError } from "./slack-gateway.js";
import type {
  SlackAck,
  SlackRespond,
  SlackBlock,
  SlackBotJoinedChannelEvent,
  SlackConversationInfo,
  SlackConversationLookup,
  SlackConversationRef,
  SlackEmailUser,
  SlackLabelledConversation,
  SlackWorkspace,
  SlackChannelInfo,
  SlackChannelMessageEvent,
  SlackGateway,
  SlackPostMessage,
  SlackReservedFile,
  SlackFileInfo,
  SlackSessionStoppedEvent,
  SlackImageFile,
  SlackMentionEvent,
  SlackMessage,
  SlackSlashCommand,
  SlackThreadRead,
  SlackUserInfo,
  SlackViewSubmission,
} from "./slack-gateway.js";
import {
  createTurnPresenter,
  renderAssistantBlocks,
  type TurnPresenter,
} from "./slack-turn-presenter.js";
import { escapeMrkdwn, markdownToSections } from "./slack-mrkdwn.js";
import {
  slackCardBlocks,
  slackCardIssues,
  slackCardText,
  slackRefusedBlocks,
} from "./slack-card-blocks.js";
import {
  mentionCommandVerb,
  parseMentionCommand,
  parseSwitchArgs,
} from "./slack-mention-commands.js";
import {
  agentContextBlock,
  agentFooterLabel,
  catchUpLegend,
  historyLegend,
  historyPreamble,
  labelHistoryMessage,
  marksThread,
  footerSessionId,
  threadWindowMarker,
  parseAgentFooter,
  type AgentFooter,
} from "./agent-footer.js";
import {
  DELETE_POST_CONFIRM,
  agentPostMetadata,
  deletePostFileIds,
  deletePostModal,
  parseAgentPostLink,
  parseDeletePostModal,
} from "./slack-post-delete.js";
import {
  aboveBoundary,
  formatChannelHistoryCursor,
  formatThreadCursor,
  isAfterTs,
  lastOwnPostTs,
  laterTs,
  newestTs,
  nextBoundary,
  parseChannelHistoryCursor,
  parseThreadCursor,
  selectUnseen,
  type CatchUpSelection,
} from "../domain/thread-catch-up.js";
import {
  createConversationQueue,
  getOrCreateQueue,
  steerChannelTurn,
  type ConversationQueue,
} from "./conversation-queue.js";
import {
  defaultOf,
  matchRosterName,
  orderAmbientReaders,
  parseWhisperRequest,
  sameAgentName,
  peerTaggedBy,
  routeMention,
  senderReaches,
  sessionTitleOf,
  type RosterEntry,
} from "./slack-routing.js";
import type { SlackSender } from "./slack-sender.js";
import type {
  SlackIgnoredApp,
  SlackIgnoredApps,
} from "./slack-ignored-apps-repository.js";
import type { SlackLoopGuardDropsRepository } from "./slack-loop-guard-drops-repository.js";
import {
  BOT_POST_COOLDOWN_MS,
  BOT_POST_TURNS_PER_WINDOW,
  BOT_POST_WINDOW_MS,
  createBotPostRateLimit,
} from "../domain/bot-post-rate-limit.js";
import {
  createThreadSupersede,
  type HeldTurn,
} from "../domain/thread-supersede.js";
import {
  parseWhisperSession,
  whisperSessionMetadata,
  type WhisperSession,
} from "./slack-whisper.js";

function rosterCopy(
  roster: RosterEntry[] | undefined,
  selfInstanceName: string,
): SlackTurnRoster | undefined {
  if (!roster || roster.length < 2) return undefined;
  return {
    peers: roster
      .filter((entry) => entry.instanceName !== selfInstanceName)
      .map((entry) => ({ name: entry.name, isDefault: entry.isDefault })),
    selfIsDefault:
      roster.find((entry) => entry.instanceName === selfInstanceName)
        ?.isDefault === true,
  };
}

function framePrompt(opts: {
  contract: string;
  guidance?: string;
  context?: string[];
  contextLegend?: string;
  text: string;
  images: FetchedImage[];
  files?: DeliveredFile[];
}): string | ContentBlock[] {
  const parts: string[] = [opts.contract];
  if (opts.guidance) parts.push(opts.guidance);
  if (opts.context && opts.context.length > 0) {
    const legend = opts.contextLegend ? [opts.contextLegend, ""] : [];
    parts.push(
      ["<context>", ...legend, ...opts.context, "</context>"].join("\n"),
    );
  }
  parts.push(opts.text);
  const delivered = opts.files ?? [];
  if (delivered.length > 0) {
    const list = delivered.map((f) => `- ${f.name} → ${f.path}`).join("\n");
    parts.push(
      `<attached-files>\nSaved in your workspace, attached to this message:\n${list}\n</attached-files>`,
    );
  }
  const text = parts.join("\n\n");
  if (opts.images.length === 0 && delivered.length === 0) return text;
  return [
    { type: "text", text },
    ...opts.images.map((i) => i.block),
    ...delivered.map((f): ContentBlock => ({
      type: "resource_link",
      uri: `file://${f.path}`,
      name: f.name,
      size: f.size,
      ...(f.contentType ? { mimeType: f.contentType } : {}),
    })),
  ];
}

function isDirectMessageId(channelId: string): boolean {
  return channelId.startsWith("D");
}

function isGroupDirectMessageName(channelName: string | undefined): boolean {
  return channelName?.startsWith("mpdm-") ?? false;
}

function groupDirectMessageMembers(channelName: string | null): string[] {
  if (!channelName) return [];
  return channelName
    .replace(/^mpdm-/, "")
    .replace(/-\d+$/, "")
    .split("--")
    .filter(Boolean);
}

const MEMBERSHIP_CHECK_BUDGET_MS = 1_500;

const ROSTER_ACK_BUDGET_MS = 2_000;

const ROLE_LINE_MAX = 200;

interface CommandReply {
  ack: SlackAck;
  respond: SlackRespond;
  receivedAt: number;
}

const SILENT_PRESENTER: TurnPresenter = {
  onUpdate() {},
  setThinking() {},
  setWaking() {},
  async clearStatus() {},
};

let whisperSequence = 0;

function whisperTs(): string {
  const now = Date.now();
  const micros = (now % 1000) * 1000 + (whisperSequence++ % 1000);
  return `${Math.floor(now / 1000)}.${String(micros).padStart(6, "0")}`;
}

const WHISPER_ROOT_TTL_MS = 10 * 60_000;

export type FetchedImage = {
  block: ContentBlock;
  meta: { name: string; size: number };
};

export type FetchedFile = {
  name: string;
  bytes: Buffer;
  uploader: string;
  contentType?: string;
};

type DeliveredFile = {
  name: string;
  path: string;
  size: number;
  contentType?: string;
};

type TurnDelivery = { files: DeliveredFile[]; withheldNote: string };

type FetchedFailure = {
  name: string;
  kind: "image" | "file";
  plural?: true;
  reason: string;
};

type FetchAttachmentsResult = {
  images: FetchedImage[];
  files: FetchedFile[];
  failures: FetchedFailure[];
  release: () => void;
};

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

async function withheldCopy(
  gw: SlackGateway,
  teamId: SlackWorkspace,
  attachment: Exclude<InboundAttachment, { kind: "image" }>,
  noun: "image" | "file",
): Promise<string> {
  if (attachment.kind === "unreadable") {
    return attachment.retryable
      ? `it is ${attachment.description}, so the upload arrived incomplete. Try resending.`
      : `it is ${attachment.description}. The agent reads PNG, JPEG, GIF and WebP images.`;
  }
  const scopes = await grantedScopes(gw, teamId);
  return scopes && !scopes.has("files:read")
    ? "Slack returned a web page instead of the file — this install lacks the " +
        "`files:read` permission, so it cannot download attachments. Reinstall " +
        `the app with that scope and send the ${noun} again.`
    : "Slack returned a web page instead of the file, so the agent never saw " +
        `the ${noun}. That usually means the app cannot download attachments in ` +
        "this conversation — check that it is still installed and can read files.";
}

function describeSlackFile(f: SlackImageFile) {
  return { name: f.name, mimeType: f.mimetype };
}

function attachmentName(f: SlackImageFile): string {
  return promptSafeName(f.name || "file");
}

const OVER_HELD_BUDGET =
  "the agent is already holding as many attachments as it can at once. " +
  "Send it again in a moment.";

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

async function fetchSlackAttachments(
  gateway: SlackGateway,
  files: SlackImageFile[] | undefined,
  uploader: string,
  budget: AttachmentBudget,
  teamId: SlackWorkspace,
  pictureDelivery: "shown" | "handed" = "shown",
): Promise<FetchAttachmentsResult> {
  const attachments = files ?? [];
  const shownAsPicture = (f: SlackImageFile) =>
    pictureDelivery === "shown" && wasSentAsImage(describeSlackFile(f));
  const pictures = attachments.filter(shownAsPicture);
  const documents = attachments.filter((f) => !shownAsPicture(f));

  const release = await imageFetchSemaphore.acquire();
  try {
    const images: FetchedImage[] = [];
    const staged: FetchedFile[] = [];
    const failures: FetchedFailure[] = [];
    const claims: AttachmentClaim[] = [];

    const pictureBytes = pictures.reduce((sum, f) => sum + (f.size ?? 0), 0);
    const picturesOverCap = pictureBytes > TOTAL_IMAGE_BYTES_CAP;
    if (picturesOverCap) {
      failures.push({
        name: pictures.map(attachmentName).join(", "),
        kind: "image",
        plural: true,
        reason:
          `they total ${megabytes(pictureBytes)} MB, over the ` +
          `${(TOTAL_IMAGE_BYTES_CAP / 1_000_000).toFixed(0)} MB of images a ` +
          "single message can carry. Send smaller images or fewer at once.",
      });
    }

    let pictureBytesTaken = 0;
    for (const f of picturesOverCap ? [] : pictures) {
      const remaining = TOTAL_IMAGE_BYTES_CAP - pictureBytesTaken;
      const claim = budget.reserve(encodedFootprint(f.size || remaining));
      if (!claim) {
        failures.push({
          name: attachmentName(f),
          kind: "image",
          reason: OVER_HELD_BUDGET,
        });
        continue;
      }
      try {
        const bytes = Buffer.from(
          await gateway.downloadFile(f.url_private, remaining, teamId),
        );
        pictureBytesTaken += bytes.length;
        const attachment = classifyInboundAttachment(bytes);
        if (attachment.kind !== "image") {
          getLogger().warn(
            {
              file: attachmentName(f),
              claimedMimeType: f.mimetype,
              bytes: bytes.length,
              verdict: attachment.kind,
            },
            "slack.image.unreadable",
          );
          claim.release();
          failures.push({
            name: attachmentName(f),
            kind: "image",
            reason: await withheldCopy(gateway, teamId, attachment, "image"),
          });
          continue;
        }
        const data = bytes.toString("base64");
        claim.settle(data.length);
        claims.push(claim);
        images.push({
          block: { type: "image", data, mimeType: attachment.mimeType },
          meta: { name: attachmentName(f), size: f.size ?? bytes.length },
        });
      } catch (err) {
        claim.release();
        failures.push({
          name: attachmentName(f),
          kind: "image",
          reason:
            err instanceof FileTooLargeError
              ? `it is over the ${megabytes(TOTAL_IMAGE_BYTES_CAP)} MB of ` +
                "images a single message can carry."
              : `${formatError(err)}. Try resending.`,
        });
      }
    }

    let stagedBytes = 0;
    const overCap = (size: number): string | null => {
      if (size > MAX_FILE_BYTES) {
        return (
          `it is ${megabytes(size)} MB, over the ` +
          `${megabytes(MAX_FILE_BYTES)} MB limit for a file the agent can be handed.`
        );
      }
      if (stagedBytes + size > TOTAL_FILE_BYTES_CAP) {
        return (
          `the files on this message add up to more than ` +
          `${megabytes(TOTAL_FILE_BYTES_CAP)} MB. Send them a few at a time.`
        );
      }
      return null;
    };

    for (const f of documents) {
      const name = attachmentName(f);
      const declaredTooBig = overCap(f.size ?? 0);
      if (declaredTooBig) {
        failures.push({ name, kind: "file", reason: declaredTooBig });
        continue;
      }
      const claim = budget.reserve(stagedFootprint(f.size || MAX_FILE_BYTES));
      if (!claim) {
        failures.push({ name, kind: "file", reason: OVER_HELD_BUDGET });
        continue;
      }
      try {
        const bytes = Buffer.from(
          await gateway.downloadFile(f.url_private, MAX_FILE_BYTES, teamId),
        );
        const tooBig = overCap(bytes.length);
        if (tooBig) {
          claim.release();
          failures.push({ name, kind: "file", reason: tooBig });
          continue;
        }
        const head = bytes.subarray(0, 8192).toString("latin1");
        const refused =
          looksLikeSignInPage(head) ||
          (classifyInboundAttachment(bytes).kind === "web_page" &&
            !(await hasScope(gateway, teamId, "files:read")));
        if (bytes.length === 0 || refused) {
          getLogger().warn(
            {
              file: name,
              claimedMimeType: f.mimetype,
              bytes: bytes.length,
              verdict: bytes.length === 0 ? "empty" : "refused",
            },
            "slack.file.unreadable",
          );
          claim.release();
          failures.push({
            name,
            kind: "file",
            reason:
              bytes.length === 0
                ? "it arrived empty, so the upload didn't complete. Try resending."
                : await withheldCopy(
                    gateway,
                    teamId,
                    { kind: "web_page" },
                    "file",
                  ),
          });
          continue;
        }
        stagedBytes += bytes.length;
        claim.settle(stagedFootprint(bytes.length));
        claims.push(claim);
        staged.push({
          name,
          bytes,
          uploader,
          ...(f.mimetype ? { contentType: f.mimetype } : {}),
        });
      } catch (err) {
        claim.release();
        failures.push({
          name,
          kind: "file",
          reason:
            err instanceof FileTooLargeError
              ? `it is over the ${megabytes(MAX_FILE_BYTES)} MB limit for a ` +
                "file the agent can be handed."
              : `${formatError(err)}. Try resending.`,
        });
      }
    }
    return {
      images,
      files: staged,
      failures,
      release: () => {
        for (const claim of claims) claim.release();
      },
    };
  } finally {
    release();
  }
}

type TurnAttachments = {
  images: FetchedImage[];
  files: FetchedFile[];
  withheldNote: string;
  release: () => void;
};

function renderWithheldNote(failures: FetchedFailure[]): string {
  if (failures.length === 0) return "";
  const list = failures.map((f) => `${f.name} (${f.reason})`).join("; ");
  return (
    `\n\nAn attachment on this message could not be read and was not ` +
    `included: ${list} Say so plainly if the question depends on seeing it — ` +
    `do not guess at its contents.`
  );
}

function renderTurnFiles(attachments: {
  images: FetchedImage[];
  files: FetchedFile[];
}): string {
  const list = [
    ...attachments.images.map(
      (i) => `${i.meta.name} (${megabytes(i.meta.size)} MB)`,
    ),
    ...attachments.files.map(
      (f) => `${f.name} (${megabytes(f.bytes.length)} MB)`,
    ),
  ];
  if (list.length === 0) return "";
  return `\nTurn included: ${list.join(", ")}.`;
}

const THREAD_LOOKBACK = 50;

const STALE_THREAD_CURSOR =
  "that cursor is not one this thread handed you — a cursor comes back " +
  "from a read of this same thread and reaches only backwards inside it, " +
  "so one from another thread, or naming a point this thread does not " +
  "reach, is refused rather than answered with some other window. Drop it " +
  "and read the thread again from its end.";

const CHANNEL_LOOKBACK = 100;

const STALE_CHANNEL_CURSOR =
  "that cursor is not one a read of this conversation's history handed " +
  "you — a cursor comes back from read_channel_history and reaches only " +
  "backwards inside the conversation it came from. Drop it and read again " +
  "without a cursor.";

const CHANNEL_HISTORY_UNIDENTIFIED =
  "this call could not be tied to the session making it, so the " +
  "conversation it may read is unknown and nothing was read";

function channelTurnReachRefusal(own: string, asked: string): string {
  const where = own
    ? `only that conversation's history, ${own}`
    : "no Slack history, since a Telegram chat has none";
  return (
    `a turn that answers in a messenger conversation reads ${where}; ` +
    `the people there may not be in ${asked}. Your owner can ask you to ` +
    "read it from a web chat."
  );
}

function channelHistoryNotOn(
  asked: string,
  readable: readonly { id: string }[],
): string {
  const where =
    readable.length === 0
      ? "and it is on nowhere for you"
      : `and it is on for you in ${readable.map((c) => c.id).join(", ")}`;
  return (
    `channel history is not on for you in ${asked}. You can read the ` +
    "history only of a conversation where it was turned on for you, " +
    `${where}. A person who may change it there turns it on.`
  );
}

const CHANNEL_CATCH_UP_CAP = 500;

const CATCH_UP_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: A window of a thread as an Agent reads it, shared by
 * the history a first turn in a thread is handed and by `read_thread`, so the
 * two cannot disagree about which window a long thread shows. With no `before`
 * the window is the thread's newest replies, which Slack serves in one read;
 * with one it is the replies just before that ts. The message that opened the
 * thread comes first whatever the window holds. `offsets` places each message
 * inside the window, the opener being 0, and `repliesBefore` counts the replies
 * older than the window; together they give a reply its position counted from
 * the thread's first reply, which does not change as the thread grows, unlike a
 * total. The count is the reply count Slack puts on the opener, less what sits
 * at or after the window, both taken from one Slack response so a reply posted
 * between two reads cannot shift it. Where it disagrees with Slack's own paging signal it
 * is dropped, because a reply number shown wrong misleads more than none. The
 * cursor reads the window just before this one.
 */
interface ThreadWindow {
  messages: SlackMessage[];
  offsets: Map<SlackMessage, number>;
  repliesBefore: number | null;
  hasEarlier: boolean;
  cursor: string | null;
}

const THREAD_COUNT_LIMIT = 1000;

async function countRepliesFrom(
  gateway: SlackGateway,
  args: {
    channel: string;
    threadTs: string;
    teamId: SlackWorkspace;
    from: string;
  },
): Promise<{ newer: number; total: number | undefined } | null> {
  const read = await gateway.getThreadReplies({
    channel: args.channel,
    threadTs: args.threadTs,
    teamId: args.teamId,
    limit: THREAD_COUNT_LIMIT,
    oldest: args.from,
    inclusive: true,
  });
  if (read.hasMore) return null;
  const opener = read.messages.find((message) => message.ts === args.threadTs);
  return {
    newer: read.messages.filter((message) => message !== opener).length,
    total: opener?.replyCount,
  };
}

async function readThreadWindow(
  gateway: SlackGateway,
  args: {
    channel: string;
    threadTs: string;
    teamId: SlackWorkspace;
    before?: string;
  },
): Promise<ThreadWindow> {
  const page = await gateway.getThreadReplies({
    channel: args.channel,
    threadTs: args.threadTs,
    teamId: args.teamId,
    limit: THREAD_LOOKBACK,
    ...(args.before !== undefined ? { latest: args.before } : {}),
  });
  const opener =
    page.messages.find((message) => message.ts === args.threadTs) ?? null;
  const replies = page.messages.filter((message) => message !== opener);
  const offsets = new Map<SlackMessage, number>(
    replies.map((message, i) => [message, i + 1]),
  );
  if (opener !== null) offsets.set(opener, 0);
  const after =
    args.before === undefined
      ? { newer: 0, total: opener?.replyCount }
      : await countRepliesFrom(gateway, { ...args, from: args.before });
  const counted =
    after !== null && after.total !== undefined
      ? after.total - after.newer - replies.length
      : null;
  const earliest = replies[0]?.ts;
  return {
    messages: opener !== null ? [opener, ...replies] : replies,
    offsets,
    repliesBefore:
      counted !== null && counted >= 0 && counted > 0 === page.hasMore
        ? counted
        : null,
    hasEarlier: page.hasMore,
    cursor:
      page.hasMore && earliest !== undefined
        ? formatThreadCursor({ threadTs: args.threadTs, before: earliest })
        : null,
  };
}

function markThreadWindow(
  lines: readonly string[],
  offsets: readonly number[],
  window: {
    threadTs: string;
    repliesBefore: number | null;
    hasEarlier: boolean;
    cursor: string | null;
    alwaysLabel: boolean;
  },
): { lines: string[]; windowed: boolean } {
  const plain = { lines: [...lines], windowed: false };
  const placed = lines.map((line, i) => ({ line, offset: offsets[i] ?? 0 }));
  const opening = placed.filter((p) => p.offset === 0);
  const replies = placed.filter((p) => p.offset > 0);
  const first = replies[0];
  const last = replies[replies.length - 1];
  if (first === undefined || last === undefined) return plain;
  if (!window.hasEarlier && !window.alwaysLabel) return plain;
  const { repliesBefore } = window;
  const marker = threadWindowMarker({
    threadTs: window.threadTs,
    hasEarlier: window.hasEarlier,
    cursor: window.cursor,
    shown:
      repliesBefore === null
        ? null
        : {
            repliesBefore,
            first: repliesBefore + first.offset,
            last: repliesBefore + last.offset,
          },
  });
  if (marker === null) return plain;
  return {
    lines: [
      ...opening.map((p) => p.line),
      marker,
      ...replies.map((p) => p.line),
    ],
    windowed: window.hasEarlier,
  };
}

interface ConversationRead extends SlackThreadRead {
  thread: ThreadWindow | null;
}

async function readConversation(
  gateway: SlackGateway,
  channel: string,
  threadTs: string | undefined,
  since: string | undefined,
  teamId: SlackWorkspace,
): Promise<ConversationRead> {
  if (threadTs !== undefined && since === undefined) {
    const thread = await readThreadWindow(gateway, {
      channel,
      threadTs,
      teamId,
    });
    return { messages: thread.messages, hasMore: false, thread };
  }
  if (threadTs !== undefined) {
    const read = await gateway.getThreadReplies({
      channel,
      threadTs,
      limit: THREAD_LOOKBACK,
      teamId,
      ...(since ? { oldest: since } : {}),
    });
    return { ...read, thread: null };
  }
  const read = await gateway.getChannelHistory({
    channel,
    limit: since === undefined ? CHANNEL_LOOKBACK : CHANNEL_CATCH_UP_CAP,
    teamId,
    ...(since ? { oldest: since } : {}),
  });
  return {
    messages: read.messages.slice().reverse(),
    hasMore: read.hasMore,
    thread: null,
  };
}

const NO_COMMIT = (): void => {};

interface CatchUpFrame {
  frame: { context?: string[]; contextLegend?: string };
  commit: () => void;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: A prompt and the boundary write that only becomes
 * true once the agent has it. The write is deferred rather than done where it is
 * computed, because a boundary that moves before the send would step over
 * messages a failed send never delivered — the loss the boundary exists to
 * prevent.
 */
interface BuiltPrompt {
  prompt: string | ContentBlock[];
  commit: () => void;
}

interface LabelledEntry {
  message: SlackMessage;
  footer: { agentId: string } | null;
}

function labelMessages(
  entries: LabelledEntry[],
  names: Map<string, string>,
  readingAgentId: string,
  bot: { userId: string | null; label: string },
  opts: { showThreadMarkers: boolean; showTs?: boolean },
): string[] {
  return entries.map((e) =>
    labelHistoryMessage(
      e.message,
      e.footer && {
        agentId: e.footer.agentId,
        name: names.get(e.footer.agentId) ?? e.footer.agentId,
      },
      readingAgentId,
      bot,
      opts,
    ),
  );
}

async function resolveAuthorNames(
  entries: LabelledEntry[],
  resolveAgentName: (agentId: string) => Promise<string>,
): Promise<Map<string, string>> {
  const authorIds = [
    ...new Set(entries.flatMap((e) => (e.footer ? [e.footer.agentId] : []))),
  ];
  return new Map(
    await Promise.all(
      authorIds.map(async (id) => [id, await resolveAgentName(id)] as const),
    ),
  );
}

async function getContextMessages(read: {
  gateway: SlackGateway;
  channel: string;
  teamId: SlackWorkspace;
  threadTs: string | undefined;
  readingAgentId: string;
  carried: readonly string[];
  bot: { userId: string | null; label: string };
  resolveAgentName: (agentId: string) => Promise<string>;
  catchUp: CatchUpSelection | null;
}): Promise<{
  lines: string[];
  offeredThreads: string[];
  hasThreadMarker: boolean;
  hasAttachmentMarker: boolean;
  hasAgentAuthored: boolean;
  hasUnattributedBot: boolean;
  readNewestTs: string | null;
  readHasMore: boolean;
  threadWindow: { windowed: boolean; cursor: string | null };
}> {
  const { bot, catchUp, threadTs } = read;
  const conversation = await readConversation(
    read.gateway,
    read.channel,
    threadTs,
    catchUp?.since,
    read.teamId,
  );

  const all = conversation.messages.map((message) => ({
    ts: message.ts,
    authorAgentId: parseAgentFooter(message)?.agentId ?? null,
    message,
  }));
  const carried = new Set(read.carried);
  const selected = catchUp
    ? selectUnseen(all, catchUp)
    : all.filter((e) => e.ts === undefined || !carried.has(e.ts));
  const entries = selected.map((e) => ({
    message: e.message,
    footer: e.authorAgentId ? { agentId: e.authorAgentId } : null,
  }));

  const names = await resolveAuthorNames(entries, read.resolveAgentName);

  const showThreadMarkers = threadTs === undefined;
  const labelled = labelMessages(entries, names, read.readingAgentId, bot, {
    showThreadMarkers,
  });
  const { thread } = conversation;
  const marked =
    thread !== null && threadTs !== undefined
      ? markThreadWindow(
          labelled,
          entries.map((e) => thread.offsets.get(e.message) ?? 0),
          {
            threadTs,
            repliesBefore: thread.repliesBefore,
            hasEarlier: thread.hasEarlier,
            cursor: thread.cursor,
            alwaysLabel: false,
          },
        )
      : { lines: labelled, windowed: false };
  const offered = showThreadMarkers
    ? entries.flatMap((e) =>
        marksThread(e.message) && e.message.ts !== undefined
          ? [e.message.ts]
          : [],
      )
    : [];
  return {
    lines: marked.lines,
    offeredThreads: offered,
    hasThreadMarker: offered.length > 0,
    hasAttachmentMarker: entries.some(
      (e) => (e.message.attachments ?? []).length > 0,
    ),
    hasAgentAuthored: entries.some((e) => e.footer !== null),
    hasUnattributedBot: entries.some(
      (e) => !e.footer && !!bot.userId && e.message.user === bot.userId,
    ),
    readNewestTs: newestTs(all),
    readHasMore: conversation.hasMore,
    threadWindow: {
      windowed: marked.windowed,
      cursor: marked.windowed ? (thread?.cursor ?? null) : null,
    },
  };
}

export interface SlackBoundConversation {
  id: string;
  teamId: SlackWorkspace;
  customEmoji?: string[] | null;
  history?: true;
}

export interface SlackBindingInfo {
  instanceName: string;
  owner: string;
  teamId: SlackWorkspace;
  ambient: boolean;
  history: boolean;
  isDefault: boolean;
}

export interface ChannelRegistry {
  resolveSlackBindings(slackChannelId: string): Promise<SlackBindingInfo[]>;
  resolveSlackChannelsByInstance(
    agentId: string,
  ): Promise<SlackBoundConversation[]>;
}

export interface SlackWorker extends ChannelWorker, AddressedWorker {
  type: ChannelType.Slack;
  connect(): Promise<void>;
  conversationStanding(
    slackChannelId: string,
    teamId: SlackWorkspace,
  ): Promise<SlackConversationStanding>;
  channelChoices(keycloakSub: string): Promise<SlackChannelChoices>;
  channelMembership(
    keycloakSub: string,
    slackChannelId: string,
    teamId: SlackWorkspace,
  ): Promise<SlackChannelMembership>;
  emailUserByEmail(
    email: string,
    teamId: SlackWorkspace,
  ): Promise<SlackEmailUser | null>;
  openDirectMessageWith(
    slackUserId: string,
    teamId: SlackWorkspace,
  ): Promise<SlackConversationLookup & { channelId?: string }>;
  conversationInfoOf(
    channelId: string,
    teamId: SlackWorkspace,
  ): Promise<SlackConversationLookup>;
  grantedScopesOf(teamId: SlackWorkspace): Promise<string[] | null>;
  /** UNIT_BOUNDARY_DESCRIPTION: tell the person who just bound an Agent into a
   *  DM the Bridge released that the DM stays closed. */
  notifyClosedBind(instanceName: string, slackChannelId: string): Promise<void>;
  start(instanceName: string): Promise<void>;
  stop(instanceName: string): Promise<void>;
  resolveConversationLabels(
    refs: SlackConversationRef[],
  ): Promise<SlackLabelledConversation[]>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: What the worker needs to know about the DM Bridge:
 * whether a pairing was revoked, which closes turns and delivery into that DM
 * for that Agent whatever a binding or a link still says, and what an in-chat
 * unbind has to release. An unreadable answer counts as closed.
 */
export type SlackDmReleaseOutcome =
  "none" | "revoked" | "superseded" | "failed";

export interface SlackDmBridgePort {
  blocks(
    agentId: string,
    teamId: SlackWorkspace,
    dmChannelId: string,
  ): Promise<boolean>;
  releaseInChat(args: {
    agentId: string;
    teamId: SlackWorkspace;
    slackChannelId: string;
  }): Promise<SlackDmReleaseOutcome>;
  /** UNIT_BOUNDARY_DESCRIPTION: the records of an Agent in one conversation
   *  that are not active, wherever their workspace, so an ordinary bind into a
   *  DM the Bridge released can tell the person that the DM stays closed. */
  closedFor(
    agentId: string,
    slackChannelId: string,
  ): Promise<{ teamId: string; dmChannelId: string }[]>;
  /** UNIT_BOUNDARY_DESCRIPTION: the DMs this Bridge recorded in one workspace
   *  that are not finished, so an in-chat unbind can resolve and authorize a
   *  revoke whose binding is already gone. */
  pendingInChat(args: {
    teamId: SlackWorkspace;
    slackChannelId: string;
  }): Promise<
    { agentId: string; ownerSub: string; state: "active" | "revoking" }[]
  >;
}

export interface SlackOAuthPending {
  slackUserId: string;
  channelId: string;
  teamId: string;
  codeVerifier: string;
  intent: "login" | "bind";
  createdAt: number;
}

type TurnWorkspace = (conversationId?: string) => SlackWorkspace | undefined;

function workspaceOf(
  bound: SlackBoundConversation[],
  conversationId: string | undefined,
  turnWorkspace: TurnWorkspace,
): SlackWorkspace | undefined {
  const workspaces = new Set(bound.map((c) => c.teamId));
  if (workspaces.size === 1) return [...workspaces][0];
  if (!conversationId) return turnWorkspace();
  return (
    bound.find((c) => c.id === conversationId)?.teamId ??
    turnWorkspace(conversationId)
  );
}

type RefuseOutsideReach = (
  conversationId: string,
  teamId: SlackWorkspace,
  directMessage?: { user: string | null },
) => Promise<{ error: string } | null>;

type AdmitTarget = (
  teamId: SlackWorkspace,
  conversationId: string,
) => Promise<{ error: string } | null>;

/* UNIT_BOUNDARY_DESCRIPTION: the one place every outbound post, reply and
 * thread resolves its destination, so it is also the one place the Bridge's
 * closure is checked for all of them: a target the worker may not send to is
 * refused before any persona, upload or message work starts. */
async function resolveOutboundTarget(
  gateway: SlackGateway,
  bound: SlackBoundConversation[],
  conversationId: string | undefined,
  turnWorkspace: TurnWorkspace,
  refuseOutsideOwnerReach: RefuseOutsideReach,
  admit?: AdmitTarget,
): Promise<{ id: string; teamId: SlackWorkspace } | { error: string }> {
  const target = await resolveTarget(
    gateway,
    bound,
    conversationId,
    turnWorkspace,
    refuseOutsideOwnerReach,
  );
  if ("error" in target) return target;
  return (admit ? await admit(target.teamId, target.id) : null) ?? target;
}

async function resolveTarget(
  gateway: SlackGateway,
  bound: SlackBoundConversation[],
  conversationId: string | undefined,
  turnWorkspace: TurnWorkspace,
  refuseOutsideOwnerReach: RefuseOutsideReach,
): Promise<{ id: string; teamId: SlackWorkspace } | { error: string }> {
  if (!conversationId) {
    if (bound.length === 1)
      return { id: bound[0]!.id, teamId: bound[0]!.teamId };
    return {
      error:
        `this agent is connected to ${bound.length} Slack conversations ` +
        `(${bound.map((c) => c.id).join(", ")}) and cannot tell which one ` +
        "you mean — pass one of these ids as chatId",
    };
  }
  const boundTarget = bound.find((c) => c.id === conversationId);
  if (boundTarget) {
    return { id: boundTarget.id, teamId: boundTarget.teamId };
  }

  const teamId = workspaceOf(bound, conversationId, turnWorkspace);
  if (teamId === undefined) {
    return {
      error:
        `${conversationId} is not one of this agent's conversations, and the ` +
        `agent is connected to more than one Slack workspace — reach it from a ` +
        `conversation in the workspace it belongs to`,
    };
  }

  if (/^[UW][A-Z0-9]+$/.test(conversationId)) {
    const refused = await refuseOutsideOwnerReach(conversationId, teamId, {
      user: conversationId,
    });
    if (refused) return refused;
    try {
      return {
        id: await gateway.openDirectMessage(conversationId, teamId),
        teamId,
      };
    } catch (err) {
      return {
        error: `could not open a direct message with ${conversationId}: ${formatError(err)}`,
      };
    }
  }
  let lookup: SlackConversationLookup;
  try {
    lookup = await gateway.getConversationInfo(conversationId, teamId);
  } catch (err) {
    return {
      error: `could not resolve conversation ${conversationId}: ${formatError(err)}`,
    };
  }
  const info = match(lookup)
    .with({ kind: "found" }, (found) => found)
    .with({ kind: "not-found" }, { kind: "no-credential" }, () => null)
    .exhaustive();
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
  if (!info.isGroupDirectMessage) {
    const refused = await refuseOutsideOwnerReach(
      conversationId,
      teamId,
      info.isDirectMessage ? { user: info.directMessageUser } : undefined,
    );
    if (refused) return refused;
  }
  return { id: conversationId, teamId };
}

export const TURN_LINGER_MS = 60 * 60_000;

const MAY_STILL_RUN_REASONS = new Set([
  "acp-error",
  "relay-lost",
  "turn-stalled",
]);

function mayLeaveHarnessRunning(
  ghostTurn: boolean,
  failureReason: string | undefined,
): boolean {
  return (
    ghostTurn ||
    (failureReason !== undefined && MAY_STILL_RUN_REASONS.has(failureReason))
  );
}

export interface UnansweredFollowUp {
  eventTs: string;
  speaker?: string;
  text?: string;
}

function followUpNudge(
  threadTs: string,
  followUps: readonly UnansweredFollowUp[],
): string {
  return [
    "<turn-undelivered>",
    "You replied in this Slack conversation, but these messages arrived while you were working and got no answer:",
    ...followUps.map(
      (m) => `[ts ${m.eventTs}] ${m.speaker ?? "someone"}: ${m.text ?? ""}`,
    ),
    `Answer only these messages now with the reply tool (threadTs="${threadTs}"); do not repeat what you already posted.`,
    "If they need no answer, call no_reply_needed instead.",
    "</turn-undelivered>",
  ].join("\n");
}

export function undeliveredNudge(
  threadTs: string,
  opts: {
    sawFailure: boolean;
    outOfMemory?: boolean;
    followUps?: readonly UnansweredFollowUp[];
  },
): string {
  if (opts.followUps !== undefined && opts.followUps.length > 0)
    return followUpNudge(threadTs, opts.followUps);
  return [
    "<turn-undelivered>",
    opts.sawFailure
      ? "Your previous turn in this Slack thread ended without a reply being posted, and the person was already told the turn had gone wrong — so they are waiting on an answer, knowing only that something failed."
      : "Your previous turn in this Slack thread ended without a reply being posted — the person waiting in the thread never saw an answer.",
    ...(opts.outOfMemory
      ? [
          "The turn was cut short because the agent ran out of memory and restarted. " +
            "Tell the person so, and that only a platform operator can raise the " +
            "owner's memory budget, which is what would give the agent more room.",
        ]
      : []),
    `Post your result now with the reply tool (threadTs="${threadTs}").`,
    ...(opts.sawFailure || opts.outOfMemory
      ? []
      : [
          "Write it as the answer they are waiting for, not as a correction: " +
            "do not mention this notice and do not apologise for the delay — " +
            "the only thing they ever see is what you post.",
        ]),
    "If silence was deliberate, call no_reply_needed instead.",
    "</turn-undelivered>",
  ].join("\n");
}

const USER_CACHE_TTL_MS = 10 * 60_000;

const CONVERSATION_LABEL_TTL_MS = 5 * 60_000;

const PENDING_POST_DELETE_TTL_MS = 15 * 60_000;

const SLACK_MAX_BLOCKS = 50;

const userLookupSemaphore = createSemaphore(5);

const conversationInfoSemaphore = createSemaphore(5);

function conversationKey(ref: SlackConversationRef): string {
  return `${ref.teamId}/${ref.channelId}`;
}

function normalizeSlackUserId(input: string): string | null {
  const bare = input.trim().replace(/^<@/, "").replace(/>$/, "").split("|")[0]!;
  return /^[UW][A-Z0-9]+$/i.test(bare) ? bare.toUpperCase() : null;
}

async function grantedScopes(
  gw: SlackGateway,
  teamId: SlackWorkspace,
): Promise<Set<string> | null> {
  try {
    return await gw.getGrantedScopes(teamId);
  } catch {
    return null;
  }
}

async function hasScope(
  gw: SlackGateway,
  teamId: SlackWorkspace,
  scope: string,
): Promise<boolean> {
  const scopes = await grantedScopes(gw, teamId);
  return !scopes || scopes.has(scope);
}

function signsAgentPosts(scopes: Set<string> | null): boolean {
  return !scopes?.has("chat:write.customize");
}

const SCOPE_WITHHELD_USERS =
  "this workspace did not grant the permission to look people up (users:read)";
const SCOPE_WITHHELD_REACTIONS =
  "this workspace did not grant the permission to read reactions (reactions:read)";

const AGENT_SIGNATURE_RE = /^\S+\s+\*[^*\n]*\*\s+/;

type AgentPersona = {
  persona: Pick<SlackPostMessage, "username" | "iconUrl">;
  sign: (text: string, bold: "*" | "**") => string;
  emoji: string;
};

async function withoutAgentSignature<
  T extends { text: string; sender: SlackSender; teamId: SlackWorkspace },
>(gw: SlackGateway, event: T): Promise<T> {
  if (event.sender.kind !== "agent") return event;
  if (!signsAgentPosts(await grantedScopes(gw, event.teamId))) return event;
  return { ...event, text: event.text.replace(AGENT_SIGNATURE_RE, "") };
}

const SCOPE_CAPABILITIES: Array<{ scope: string; backs: string }> = [
  { scope: "app_mentions:read", backs: "answering mentions" },
  { scope: "chat:write", backs: "posting replies" },
  { scope: "files:read", backs: "reading the files people attach" },
  { scope: "files:write", backs: "sending files into a channel" },
  { scope: "channels:history", backs: "reading channel history for context" },
  { scope: "im:history", backs: "answering direct messages" },
  { scope: "reactions:write", backs: "the agent's own emoji reactions" },
  { scope: "users:read", backs: "telling the agent who people are" },
  { scope: "reactions:read", backs: "reading the reactions on a message" },
  { scope: "channels:read", backs: "posting outside the bound channel" },
];

async function reportMissingPermissions(
  gw: SlackGateway,
  teamId: SlackWorkspace,
): Promise<void> {
  const scopes = await grantedScopes(gw, teamId);
  if (!scopes) return;
  const missing = SCOPE_CAPABILITIES.filter((c) => !scopes.has(c.scope));
  if (missing.length === 0) return;
  getLogger().warn(
    {
      teamId,
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
  teamId: SlackWorkspace,
  opts?: { batched?: boolean },
): Promise<{
  canLookupUsers: boolean;
  permalink: string | null;
  botUserId: string | null;
}> {
  const [lookup, permalink, botUserId] = await Promise.all([
    hasScope(gw, teamId, "users:read"),
    opts?.batched
      ? Promise.resolve(null)
      : gw.getPermalink(channel, eventTs, teamId).catch(() => null),
    gw.getBotUserId(teamId).catch(() => null),
  ]);
  return { canLookupUsers: lookup, permalink, botUserId };
}

export type SlackWorkerDeps = {
  makeAcpClient: AcpClientFactory;
  channelPair?: ChannelPair;
  createGateway: () => SlackGateway;
  agents: () => AgentsService;
  templateDescription?: (templateId: string) => Promise<string | null>;
  identityLinks: IdentityLinkService;
  oauthConfig: KeycloakOAuthConfig;
  pendingOAuthFlows: TtlStore<SlackOAuthPending>;
  getInstanceOwner: (agentId: string) => Promise<string | null>;
  ownerDisplayName: (sub: string) => Promise<string | null>;
  channelRegistry: ChannelRegistry;
  unbindSlackChannel: (
    agentId: string,
    slackChannelId: string,
  ) => Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: The DM Bridge's records, as the worker needs
   * them: whether a DM's pairing was revoked (turns and delivery there are then
   * closed, whatever the binding or link still says), and what an in-chat
   * unbind leaves behind — the threads that Agent's Sessions owned there and
   * the email pairing that put them there. */
  dmBridges?: SlackDmBridgePort;
  setSlackChannelAmbient: (
    agentId: string,
    slackChannelId: string,
    ambient: boolean,
  ) => Promise<void>;
  setSlackChannelHistory: (
    agentId: string,
    slackChannelId: string,
    history: boolean,
  ) => Promise<void>;
  agentsFor: (owner: string) => AgentsService;
  ignoredApps: SlackIgnoredApps;
  loopGuardDrops?: Pick<SlackLoopGuardDropsRepository, "record">;
  setSlackDefault: (
    agentId: string,
    slackChannelId: string,
  ) => Promise<boolean>;
  brand: { name: string; short: string };
  isTermsAccepted: (sub: string) => Promise<boolean>;
  spendHold?: ChannelSpendHold;
  providerOutage?: ChannelProviderOutage;
  uiBaseUrl: string;
  attendance: ChannelTurnAttendance;
  workspaceFiles: AgentWorkspaceFilesFactory;
  listWorkspaces: () => Promise<SlackWorkspace[]>;
  emit?: (event: DomainEvent) => void;
  settleMs?: number;
  wakeWait?: WakeWaitOptions;
  agentIcon?: AgentIconUrl | null;
  readPodRestarts?: (agentId: string) => Promise<PodRestartState | null>;
  ownedThreads?: SlackOwnedThreads;
};

const FIRST_LINE_MAX = 200;

/* UNIT_BOUNDARY_DESCRIPTION: the agent-runtime's surface for a message no
 * viewer typed that may still join a running turn, the one a message from
 * another of the Agent's Sessions carries. A reply in a thread a Session
 * started is the same kind of message. */
const MESSAGE_SURFACE = "message";

/* UNIT_BOUNDARY_DESCRIPTION: a turn whose conversation the Bridge released
 * while the machinery was still getting ready. It ends the turn quietly — the
 * person is long gone from that DM — and is never reported as a model failure. */
class ReleasedConversationError extends Error {
  readonly released = true;
}

const BRIDGE_CLOSED_COPY =
  "The DM Bridge released this conversation, so this agent no longer reaches it here. " +
  "Ask its owner to connect it again.";

const BRIDGE_UNKNOWN_COPY =
  "Could not check whether this conversation still reaches the agent, so nothing was sent.";

export function createSlackWorker(deps: SlackWorkerDeps): SlackWorker {
  const {
    makeAcpClient,
    channelPair,
    createGateway,
    agents,
    identityLinks,
    oauthConfig,
    pendingOAuthFlows,
    getInstanceOwner,
    ownerDisplayName,
    channelRegistry,
    unbindSlackChannel,
    dmBridges,
    setSlackChannelAmbient,
    setSlackChannelHistory,
    agentsFor,
    ignoredApps,
    loopGuardDrops,
    setSlackDefault,
    brand,
    isTermsAccepted,
    spendHold,
    providerOutage = async () => null,
    uiBaseUrl,
    attendance,
    workspaceFiles,
    listWorkspaces,
    emit = defaultEmit,
    settleMs = 0,
    wakeWait = {},
    agentIcon = null,
    readPodRestarts = async () => null,
    ownedThreads = createMemorySlackOwnedThreads(),
  } = deps;
  const brandShort = brand.short;
  let gateway: SlackGateway | null = null;

  /* UNIT_BOUNDARY_DESCRIPTION: A DM the Bridge revoked admits no turn and takes
   * no delivery, even while a binding or an OAuth link still reaches it. Only a
   * DM can carry a Bridge record, so nothing else pays for the check, and a
   * record this call cannot read closes the conversation rather than opening it.
   */
  async function bridgeClosed(
    agentId: string,
    teamId: SlackWorkspace,
    channelId: string,
  ): Promise<{ error: string } | null> {
    if (!dmBridges || !isDirectMessageId(channelId)) return null;
    try {
      return (await dmBridges.blocks(agentId, teamId, channelId))
        ? { error: BRIDGE_CLOSED_COPY }
        : null;
    } catch (err) {
      getLogger().warn(
        { agentId, channelId, error: formatError(err) },
        "slack.dm_bridge.unreadable",
      );
      return { error: BRIDGE_UNKNOWN_COPY };
    }
  }

  async function ownerReach(
    gw: SlackGateway,
    instanceName: string,
    teamId: SlackWorkspace,
  ): Promise<Set<string> | "unlinked"> {
    const owner = await getInstanceOwner(instanceName);
    const slackUsers = owner
      ? await identityLinks.externalUsersOf("slack", owner)
      : [];
    if (slackUsers.length === 0) return "unlinked";
    const reach = new Set<string>();
    for (const userId of slackUsers) {
      for (const id of await gw.listSharedChannels(userId, teamId)) {
        reach.add(id);
      }
    }
    return reach;
  }

  async function linkedWorkspaces(
    links: { teamId: string | null }[],
  ): Promise<SlackWorkspace[]> {
    return [
      ...new Set([
        ...(await listWorkspaces()),
        ...links.flatMap((l) => (l.teamId === null ? [] : [l.teamId])),
      ]),
    ];
  }

  async function mayMessageDirectly(
    gw: SlackGateway,
    instanceName: string,
    userId: string,
    teamId: SlackWorkspace,
  ): Promise<boolean> {
    const owner = await getInstanceOwner(instanceName);
    if (owner) {
      const ownerUsers = await identityLinks.externalUsersOf("slack", owner);
      if (ownerUsers.includes(userId)) return true;
    }
    const bound = (
      await channelRegistry.resolveSlackChannelsByInstance(instanceName)
    ).filter((c) => c.teamId === teamId);
    for (const { id } of bound.filter((c) => isDirectMessageId(c.id))) {
      const lookup = await gw.getConversationInfo(id, teamId);
      if (lookup.kind === "found" && lookup.directMessageUser === userId)
        return true;
    }
    const boundIds = new Set(bound.map((c) => c.id));
    const shared = await gw.listSharedChannels(userId, teamId);
    return shared.some((id) => boundIds.has(id));
  }

  async function refuseOutsideOwnerReach(
    gw: SlackGateway,
    instanceName: string,
    conversationId: string,
    teamId: SlackWorkspace,
    directMessage?: { user: string | null },
  ): Promise<{ error: string } | null> {
    if (directMessage) {
      const { user } = directMessage;
      if (!user) {
        return {
          error: `could not tell who ${conversationId} is a direct message with, so it is not one you may post into`,
        };
      }
      let allowed: boolean;
      try {
        allowed = await mayMessageDirectly(gw, instanceName, user, teamId);
      } catch (err) {
        return {
          error: `could not check whether you may message ${user} directly: ${formatError(err)}`,
        };
      }
      return allowed
        ? null
        : {
            error:
              `${user} is not your owner, nor in a conversation you are ` +
              `connected to. You may message directly only your owner, the ` +
              `person in a 1:1 DM you are connected to, and the members of ` +
              `channels you are connected to`,
          };
    }
    let reach: Set<string> | "unlinked";
    try {
      reach = await ownerReach(gw, instanceName, teamId);
    } catch (err) {
      return {
        error: `could not check whether your owner is a member of ${conversationId}: ${formatError(err)}`,
      };
    }
    if (reach === "unlinked") {
      return {
        error:
          `You may reach only channels your owner is a member of, and your ` +
          `owner has not linked their Slack account: ask them to run ` +
          `\`/${brandShort} login\` in Slack`,
      };
    }
    if (!reach.has(conversationId)) {
      return {
        error:
          `your owner is not a member of ${conversationId}. You may reach ` +
          `only channels your owner is in`,
      };
    }
    return null;
  }

  type TurnRef = {
    channel: string;
    threadTs: string;
    eventTs: string;
    teamId: SlackWorkspace;
    sessionId?: string;
    releaseAttendance?: () => void;
    posted?: boolean;
    messaged?: boolean;
    declined?: boolean;
    forwarded?: boolean;
    handedOff?: boolean;
    text?: string;
    replyText?: string;
    replyTexts?: string[];
    ambient?: boolean;
    slackUserId?: string;
    hasThread?: boolean;
    hadAttachments?: boolean;
    whisper?: SlackTurnWhisper;
    steered?: boolean;
    speaker?: string;
  };

  type AddressedMessage = {
    text: string;
    eventTs: string;
    slackUserId: string;
    speaker?: string;
    sender?: SlackSender;
    inThread: boolean;
  };

  const botPosts = createBotPostRateLimit();

  const BOT_MENTION_SEEN_TTL_MS = 10 * 60 * 1000;
  const botMentionsSeen = createTtlMap<string, true>({
    ttlMs: BOT_MENTION_SEEN_TTL_MS,
  });

  function firstBotMentionSighting(channel: string, ts: string): boolean {
    const key = `${channel} ${ts}`;
    if (botMentionsSeen.get(key) !== undefined) return false;
    botMentionsSeen.set(key, true);
    return true;
  }

  function botPostConversation(channel: string, threadTs?: string): string {
    return `${channel} ${threadTs ?? "top"}`;
  }

  async function speakerOf(sender: SlackSender): Promise<string> {
    return match(sender)
      .with({ kind: "person" }, ({ user }) => `<@${user}>`)
      .with(
        { kind: "agent" },
        async ({ agentId }) =>
          `${(await resolveAgentName(agentId)) || agentId} (another agent)`,
      )
      .with({ kind: "app" }, ({ name, botId }) => `${name || botId} (an app)`)
      .exhaustive();
  }

  function senderDetail(sender: SlackSender | undefined) {
    return match(sender)
      .with(undefined, { kind: "person" }, () => ({}))
      .with({ kind: "agent" }, ({ agentId }) => ({
        sender: "agent",
        senderAgentId: agentId,
      }))
      .with({ kind: "app" }, ({ botId }) => ({
        sender: "app",
        senderBotId: botId,
      }))
      .exhaustive();
  }

  async function isIgnoredApp(
    sender: SlackSender,
    channelId: string,
  ): Promise<boolean> {
    if (sender.kind !== "app") return false;
    let ignored: SlackIgnoredApp[];
    try {
      ignored = await ignoredApps.list(channelId);
    } catch (err) {
      getLogger().warn(
        { channelId, error: formatError(err) },
        "slack.ignored_apps.unread",
      );
      return false;
    }
    if (!ignored.some((app) => app.botId === sender.botId)) return false;
    getLogger().debug(
      { channelId, botId: sender.botId },
      "slack.app_post.ignored",
    );
    return true;
  }

  async function admitBotPost(
    sender: SlackSender,
    event: { channel: string; threadTs?: string; teamId: SlackWorkspace },
  ): Promise<boolean> {
    if (sender.kind === "person") return true;
    const admission = botPosts.admitBotPost(
      botPostConversation(event.channel, event.threadTs),
    );
    if (admission === "admitted") return true;
    getLogger().info(
      { channelId: event.channel, sender: sender.kind, admission },
      "slack.bot_post.rate_limited",
    );
    void recordLoopGuardDrop(sender, event.channel, !!event.threadTs);
    if (admission === "tripped") await noticeBotPostsPaused(event);
    return false;
  }

  function minutesLabel(ms: number): string {
    const minutes = Math.round(ms / 60_000);
    return minutes === 1 ? "a minute" : `${minutes} minutes`;
  }

  async function noticeBotPostsPaused(event: {
    channel: string;
    threadTs?: string;
    teamId: SlackWorkspace;
  }): Promise<void> {
    const where = event.threadTs ? "this thread" : "this channel";
    const text =
      `:pause_button: Agents and apps posted in ${where} more than ${BOT_POST_TURNS_PER_WINDOW} times in ${minutesLabel(BOT_POST_WINDOW_MS)}, ` +
      `so their posts here start no agent turns for ${minutesLabel(BOT_POST_COOLDOWN_MS)}. ` +
      "This stops agents from waking each other in a loop. A person's message still reaches the agents.";
    try {
      await gateway?.postMessage({
        channel: event.channel,
        teamId: event.teamId,
        threadTs: event.threadTs,
        text,
      });
    } catch (err) {
      getLogger().warn(
        { channelId: event.channel, error: formatError(err) },
        "slack.bot_post.pause_unposted",
      );
    }
  }

  async function recordLoopGuardDrop(
    sender: Exclude<SlackSender, { kind: "person" }>,
    channelId: string,
    thread: boolean,
  ): Promise<void> {
    if (!loopGuardDrops) return;
    try {
      const name =
        sender.kind === "agent"
          ? (await resolveAgentName(sender.agentId)) || sender.agentId
          : sender.name || sender.botId;
      await loopGuardDrops.record(channelId, {
        at: new Date().toISOString(),
        thread,
        sender: sender.kind,
        name,
      });
    } catch (err) {
      getLogger().warn(
        { channelId, error: formatError(err) },
        "slack.bot_post.drop_unrecorded",
      );
    }
  }

  const inFlightTurns = new Map<string, Set<TurnRef>>();

  const threadSupersede = createThreadSupersede();

  type SupersedableTurn = { turn: HeldTurn; signal: AbortSignal };

  function holdSupersedable(
    instanceName: string,
    channel: string,
    sessionKey: string,
    carries: () => readonly string[],
    claim?: (ts: string) => void,
  ): SupersedableTurn & { end: () => void } {
    const cancelled = new AbortController();
    const turn = threadSupersede.hold(instanceName, {
      channel,
      sessionKey,
      carries,
      ...(claim && { claim }),
      cancel: () => cancelled.abort(),
    });
    return { turn, signal: cancelled.signal, end: () => turn.end() };
  }

  async function waitForSupersededTurns(
    instanceName: string,
    channel: string,
    rootTs: string,
  ): Promise<string> {
    const earlier = threadSupersede.supersede(instanceName, {
      channel,
      rootTs,
      sessionKey: slackThreadKey(channel, rootTs),
    });
    if (!earlier) return "";
    const turns = await earlier;
    getLogger().info(
      {
        agentId: instanceName,
        channelId: channel,
        threadTs: rootTs,
        cancelled: turns.filter((turn) => turn.cancelled).length,
        waited: turns.length,
      },
      "slack.turn.superseded_earlier",
    );
    return supersededTurnNote(turns);
  }

  const turnReplies = (refs: TurnRef[]) =>
    refs.flatMap((ref) => ref.replyTexts ?? []);

  function noteCarriedByThread(
    instanceName: string,
    threadKey: string,
    tss: readonly string[],
  ): void {
    if (tss.length === 0) return;
    replaceSeenAbove(instanceName, threadKey, [
      ...readSeenAbove(instanceName, threadKey),
      ...tss,
    ]);
  }

  function addTo<K, T>(sets: Map<K, Set<T>>, key: K, item: T): void {
    let set = sets.get(key);
    if (!set) {
      set = new Set();
      sets.set(key, set);
    }
    set.add(item);
  }

  function removeFrom<K, T>(sets: Map<K, Set<T>>, key: K, item: T): void {
    const set = sets.get(key);
    if (!set) return;
    set.delete(item);
    if (set.size === 0) sets.delete(key);
  }

  const lingeringTurns = new Map<string, Map<TurnRef, number>>();

  function beginTurn(instanceName: string, ref: TurnRef) {
    addTo(inFlightTurns, instanceName, ref);
    ref.releaseAttendance ??= attendance.openChannelTurn(instanceName);
    if (!ref.whisper) noteAgentThread(instanceName, ref.channel, ref.threadTs);
  }

  function endTurn(
    instanceName: string,
    ref: TurnRef,
    opts?: { harnessMayStillRun?: boolean },
  ) {
    removeFrom(inFlightTurns, instanceName, ref);
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

  type StoppableTurn = {
    instanceName: string;
    startedBy: (slackUserId: string) => boolean;
    sessionIds: Set<string>;
    stop: () => Promise<void>;
  };

  const stoppableTurns = new Map<string, Set<StoppableTurn>>();

  function holdStoppableTurn(
    channel: string,
    threadTs: string,
    turn: StoppableTurn,
  ): () => void {
    const key = `${channel} ${threadTs}`;
    addTo(stoppableTurns, key, turn);
    return () => removeFrom(stoppableTurns, key, turn);
  }

  const watchedTurnRefs = new Map<string, Set<TurnRef>>();

  function holdWatchedRefs(instanceName: string, refs: TurnRef[]) {
    for (const ref of refs) addTo(watchedTurnRefs, instanceName, ref);
  }

  function releaseWatchedRefs(instanceName: string, refs: TurnRef[]) {
    for (const ref of refs) removeFrom(watchedTurnRefs, instanceName, ref);
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

  function separateReplyTargets(refs: TurnRef[]): boolean {
    return new Set(refs.map((ref) => ref.threadTs)).size > 1;
  }

  function resolveTurn(
    instanceName: string,
    kind: "reply" | "react",
  ): { ref: TurnRef } | { ambiguous: true } | { none: true } {
    const candidates = liveTurnRefs(instanceName);
    if (candidates.length === 0) return { none: true };
    const target = (ref: TurnRef) =>
      kind === "reply"
        ? `${ref.channel} ${ref.threadTs}`
        : `${ref.channel} ${ref.eventTs}`;
    const targets = new Set(candidates.map(target));
    return targets.size === 1 ? { ref: candidates[0]! } : { ambiguous: true };
  }

  function liveTurnRefs(instanceName: string): TurnRef[] {
    return [
      ...(inFlightTurns.get(instanceName) ?? []),
      ...lingeringFor(instanceName),
    ];
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
    for (const ref of watchedTurnRefs.get(instanceName) ?? []) {
      if (match(ref)) return ref;
    }
    return undefined;
  }

  function turnWorkspace(instanceName: string): TurnWorkspace {
    return (conversationId) => {
      if (conversationId) {
        return findTurnRef(
          instanceName,
          (ref) => ref.channel === conversationId,
        )?.teamId;
      }
      const workspaces = new Set(
        liveTurnRefs(instanceName).map((ref) => ref.teamId),
      );
      return workspaces.size === 1 ? [...workspaces][0] : undefined;
    };
  }

  function noteEngagedTurn(
    instanceName: string,
    match: (ref: TurnRef) => boolean,
    opts: { messaged?: boolean; replyText?: string } = {},
  ) {
    noteEngaged(findTurnRef(instanceName, match), opts);
  }

  function noteEngaged(
    engaged: TurnRef | undefined,
    opts: { messaged?: boolean; replyText?: string } = {},
  ) {
    if (!engaged) return;
    engaged.posted = true;
    if (opts.messaged) engaged.messaged = true;
    if (opts.replyText) {
      engaged.replyTexts = [...(engaged.replyTexts ?? []), opts.replyText];
      engaged.replyText = engaged.replyText
        ? `${engaged.replyText}\n${opts.replyText}`
        : opts.replyText;
    }
  }

  const userCache = createTtlMap<string, SlackUserInfo | null>({
    ttlMs: USER_CACHE_TTL_MS,
    maxEntries: 500,
  });

  async function lookupUser(
    gw: SlackGateway,
    workspace: SlackWorkspace,
    id: string,
  ): Promise<SlackUserInfo | null> {
    const key = `${workspace}/${id}`;
    const cached = userCache.get(key);
    if (cached !== undefined) return cached;
    const release = await userLookupSemaphore.acquire();
    let info: SlackUserInfo | null;
    try {
      info = await gw.getUserInfo(id, workspace);
    } finally {
      release();
    }
    userCache.set(key, info);
    return info;
  }

  const conversationLabelCache = createTtlMap<
    string,
    SlackConversationLabel | null
  >({ ttlMs: CONVERSATION_LABEL_TTL_MS, maxEntries: 500 });

  async function directMessagePartner(
    gw: SlackGateway,
    workspace: SlackWorkspace,
    userId: string | null,
  ): Promise<string | null> {
    if (!userId) return null;
    try {
      const user = await lookupUser(gw, workspace, userId);
      return user?.displayName || user?.realName || user?.username || null;
    } catch (err) {
      process.stderr.write(
        `[slack] users.info failed for ${userId}: ${formatError(err)}\n`,
      );
      return null;
    }
  }

  const conversationLabelInFlight = new Map<
    string,
    Promise<SlackConversationLabel | null>
  >();

  function resolveConversationLabel(
    gw: SlackGateway,
    ref: SlackConversationRef,
  ): Promise<SlackConversationLabel | null> {
    const key = conversationKey(ref);
    const pending = conversationLabelInFlight.get(key);
    if (pending) return pending;
    const lookup = (async (): Promise<SlackConversationLabel | null> => {
      const release = await conversationInfoSemaphore.acquire();
      let lookup: SlackConversationLookup;
      try {
        lookup = await gw.getConversationInfo(ref.channelId, ref.teamId);
      } catch (err) {
        process.stderr.write(
          `[slack] conversations.info failed for ${ref.channelId}: ${formatError(err)}\n`,
        );
        return null;
      } finally {
        release();
      }
      const label = await match(lookup)
        .with({ kind: "found" }, (info) => labelOf(gw, ref, info))
        .with({ kind: "not-found" }, () => ({ kind: "gone" }) as const)
        .with({ kind: "no-credential" }, () => null)
        .exhaustive();
      conversationLabelCache.set(key, label);
      return label;
    })().finally(() => conversationLabelInFlight.delete(key));
    conversationLabelInFlight.set(key, lookup);
    return lookup;
  }

  async function labelOf(
    gw: SlackGateway,
    ref: SlackConversationRef,
    info: SlackConversationInfo,
  ): Promise<SlackConversationLabel | null> {
    if (info.isGroupDirectMessage) {
      return {
        kind: "group-direct-message",
        members: groupDirectMessageMembers(info.name),
      };
    }
    if (info.isDirectMessage) {
      return {
        kind: "direct-message",
        with: await directMessagePartner(
          gw,
          ref.teamId,
          info.directMessageUser,
        ),
      };
    }
    return info.name ? { kind: "channel", name: info.name } : null;
  }

  const AMBIGUOUS_THREAD_ERROR =
    "This agent is handling more than one Slack thread right now — pass the " +
    'threadTs shown in your turn instructions (reply threadTs="…", react ' +
    'messageTs="…") so this lands in the thread you are answering.';

  const AMBIGUOUS_MESSAGE_ERROR =
    "This agent is handling more than one Slack thread right now — pass the " +
    "messageTs shown in your turn instructions so this inspects the message " +
    "you mean.";

  async function resolveAgentDisplayName(
    instanceName: string,
  ): Promise<string | null> {
    try {
      const agent = await agents().get(instanceName);
      const name = agent?.name?.trim();
      return name && name !== instanceName ? name : null;
    } catch {
      return null;
    }
  }

  async function resolveChannelOwner(
    instanceName: string,
    teamId: SlackWorkspace,
  ): Promise<ChannelOwner | null> {
    let owner: string | null;
    try {
      owner = await getInstanceOwner(instanceName);
    } catch (err) {
      getLogger().warn(
        { agentId: instanceName, step: "owner", error: formatError(err) },
        "slack.owner_lookup.failed",
      );
      return null;
    }
    const name = owner ? await ownerName(instanceName, owner) : null;
    if (!owner || !name) return null;
    return {
      name,
      slackUserId: await ownerSlackUserId(instanceName, owner, teamId),
    };
  }

  async function ownerName(
    instanceName: string,
    owner: string,
  ): Promise<string | null> {
    try {
      return await ownerDisplayName(owner);
    } catch (err) {
      getLogger().warn(
        { agentId: instanceName, step: "name", error: formatError(err) },
        "slack.owner_lookup.failed",
      );
      return null;
    }
  }

  async function ownerSlackUserId(
    instanceName: string,
    owner: string,
    teamId: SlackWorkspace,
  ): Promise<string | null> {
    try {
      const links = await identityLinks.externalLinksOf("slack", owner);
      const inWorkspace =
        links.find((link) => link.teamId === teamId) ??
        (await soleWorkspaceLink(links, teamId));
      return inWorkspace?.externalUserId ?? null;
    } catch (err) {
      getLogger().warn(
        { agentId: instanceName, step: "link", error: formatError(err) },
        "slack.owner_lookup.failed",
      );
      return null;
    }
  }

  async function soleWorkspaceLink(
    links: ExternalLink[],
    teamId: SlackWorkspace,
  ): Promise<ExternalLink | undefined> {
    const legacy = links.find((link) => link.teamId === null);
    if (!legacy) return undefined;
    const active = await listWorkspaces();
    return active.length === 1 && active[0] === teamId ? legacy : undefined;
  }

  const AGENT_NAME_TTL_MS = 30_000;
  const agentNameCache = createTtlMap<
    string,
    { name: string; avatar: string | undefined; description: string }
  >({ ttlMs: AGENT_NAME_TTL_MS, maxEntries: 500 });

  async function resolveAgentName(instanceName: string): Promise<string> {
    return (await resolveAgentIdentity(instanceName)).name;
  }

  async function resolveAgentIdentity(instanceName: string): Promise<{
    name: string;
    avatar: string | undefined;
    description: string;
  }> {
    const readAt = Date.now();
    const cached = agentNameCache.get(instanceName);
    if (cached) return cached;
    let name: string;
    let avatar: string | undefined;
    let description = "";
    try {
      const agent = await agents().get(instanceName);
      name = agent?.name?.trim() || instanceName;
      avatar = agent?.spec?.avatar;
      description = await ownDescription(agent);
    } catch {
      name = instanceName;
    }
    agentNameCache.set(instanceName, { name, avatar, description }, readAt);
    return { name, avatar, description };
  }

  async function ownDescription(agent: Agent | null): Promise<string> {
    const own = agent?.spec?.description?.trim() ?? "";
    if (!own || !agent?.templateId || !deps.templateDescription) return own;
    const inherited = await deps
      .templateDescription(agent.templateId)
      .catch(() => null);
    return own === inherited?.trim() ? "" : own;
  }

  const THREAD_SEEN_TTL_MS = 24 * 60 * 60 * 1000;
  const threadSeen = createTtlMap<string, string>({
    ttlMs: THREAD_SEEN_TTL_MS,
  });

  function threadSeenKey(instanceName: string, threadKey: string): string {
    return `${instanceName} ${threadKey}`;
  }

  function noteThreadSeen(
    instanceName: string,
    threadKey: string,
    ts: string | null,
  ): void {
    if (!ts) return;
    threadSeen.set(threadSeenKey(instanceName, threadKey), ts);
  }

  function readThreadSeen(
    instanceName: string,
    threadKey: string,
  ): string | null {
    return threadSeen.get(threadSeenKey(instanceName, threadKey)) ?? null;
  }

  const seenAbove = createTtlMap<string, string[]>({
    ttlMs: THREAD_SEEN_TTL_MS,
  });

  function replaceSeenAbove(
    instanceName: string,
    threadKey: string,
    tss: string[],
  ): void {
    const key = threadSeenKey(instanceName, threadKey);
    if (tss.length === 0) {
      seenAbove.delete(key);
      return;
    }
    seenAbove.set(key, tss);
  }

  function readSeenAbove(instanceName: string, threadKey: string): string[] {
    return seenAbove.get(threadSeenKey(instanceName, threadKey)) ?? [];
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: What a delivered turn adds to the seen record.
   * The boundary is a single point, so it may only reach a time below which
   * every message was shown or carried: the batch, held back further by a read
   * that hit its cap. A message steered into the turn sits above that point
   * and is recorded one by one instead, because the messages between the batch
   * and the steered one were shown to nobody and must stay unseen.
   */
  function commitSeenBoundary(turn: {
    instanceName: string;
    threadKey: string;
    read: { hasMore: boolean; newestReadTs: string | null };
    deliveredUpTo: string;
    steeredTs: () => string[];
  }): void {
    const boundary = nextBoundary(
      {
        hasMore: turn.read.hasMore,
        newestReadTs: turn.read.newestReadTs,
        coveredUpTo: turn.deliveredUpTo,
      },
      readThreadSeen(turn.instanceName, turn.threadKey),
    );
    noteThreadSeen(turn.instanceName, turn.threadKey, boundary);
    replaceSeenAbove(
      turn.instanceName,
      turn.threadKey,
      aboveBoundary(
        [
          ...readSeenAbove(turn.instanceName, turn.threadKey),
          ...turn.steeredTs(),
        ],
        boundary,
      ),
    );
  }

  const OFFERED_THREAD_TTL_MS = 48 * 60 * 60 * 1000;
  const offeredThreads = createTtlMap<
    string,
    { channel: string; byHistory: boolean }
  >({
    ttlMs: OFFERED_THREAD_TTL_MS,
  });

  function noteOfferedThreads(
    instanceName: string,
    channel: string,
    threadTss: string[],
    by: "window" | "history" = "window",
  ): void {
    for (const ts of threadTss) {
      const key = `${instanceName} ${ts}`;
      if (by === "history" && offeredThreads.get(key)?.byHistory === false)
        continue;
      offeredThreads.set(key, { channel, byHistory: by === "history" });
    }
  }

  function noteTurnThread(ctx: {
    instanceName: string;
    channel: string;
    threadTs: string;
    hasThread: boolean;
  }): void {
    if (ctx.hasThread)
      noteOfferedThreads(ctx.instanceName, ctx.channel, [ctx.threadTs]);
  }

  async function readsChannelHistoryIn(
    instanceName: string,
    channel: string,
    roster: RosterEntry[] | undefined,
  ): Promise<boolean> {
    const listed = roster?.find((e) => e.instanceName === instanceName);
    if (listed) return listed.history;
    try {
      const bound =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      return bound.some((c) => c.id === channel && c.history === true);
    } catch {
      return false;
    }
  }

  async function historyReachOf(
    instanceName: string,
    sessionId: string | undefined,
  ): Promise<{ only: string | null } | { error: string }> {
    if (sessionId === undefined) return { error: CHANNEL_HISTORY_UNIDENTIFIED };
    const turn = findTurnRef(
      instanceName,
      (ref) => ref.sessionId === sessionId,
    );
    if (turn) return { only: turn.channel };
    let sessions: AcpSessionInfo[];
    try {
      sessions = await makeAcpClient(instanceName).listSessions();
    } catch (err) {
      return {
        error:
          "could not tell which conversation this session answers in, so " +
          `nothing was read: ${formatError(err)}`,
      };
    }
    const caller = sessions.find((s) => s.sessionId === sessionId);
    if (!caller) return { error: CHANNEL_HISTORY_UNIDENTIFIED };
    if (caller.platform?.type === SessionType.ChannelSlack)
      return {
        only: slackChannelIdFromThreadKey(caller.platform.threadTs) ?? "",
      };
    if (caller.platform?.type === SessionType.ChannelTelegram)
      return { only: "" };
    return { only: null };
  }

  function readOfferedThread(
    instanceName: string,
    ts: string,
    bound: readonly SlackBoundConversation[],
  ): { channel: string } | null {
    const offer = offeredThreads.get(`${instanceName} ${ts}`);
    if (offer === undefined) return null;
    const stillReadable =
      !offer.byHistory ||
      bound.some((c) => c.id === offer.channel && c.history === true);
    return stillReadable ? { channel: offer.channel } : null;
  }

  const AGENT_THREAD_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const agentThreads = createTtlMap<string, true>({
    ttlMs: AGENT_THREAD_TTL_MS,
  });
  const untaggedNoticesShown = createTtlMap<string, true>({
    ttlMs: AGENT_THREAD_TTL_MS,
  });

  function noteExpiring(entries: TtlMap<string, true>, key: string): void {
    entries.set(key, true);
  }

  function isLive(entries: TtlMap<string, true>, key: string): boolean {
    return entries.get(key) !== undefined;
  }

  function noteAgentThread(
    instanceName: string,
    channel: string,
    threadTs: string,
  ): void {
    noteExpiring(agentThreads, `${instanceName} ${channel} ${threadTs}`);
  }

  function isAgentThread(
    instanceName: string,
    channel: string,
    threadTs: string,
  ): boolean {
    return isLive(agentThreads, `${instanceName} ${channel} ${threadTs}`);
  }

  async function resolveRoster(slackChannelId: string): Promise<RosterEntry[]> {
    const bindings = await channelRegistry.resolveSlackBindings(slackChannelId);
    return Promise.all(
      bindings.map(async (binding) => ({
        instanceName: binding.instanceName,
        name: await resolveAgentName(binding.instanceName),
        owner: binding.owner,
        teamId: binding.teamId,
        ambient: binding.ambient,
        history: binding.history,
        isDefault: binding.isDefault,
      })),
    );
  }

  async function agentPersona(
    gw: SlackGateway,
    instanceName: string,
    conversation: { id: string; teamId: SlackWorkspace },
  ): Promise<AgentPersona> {
    const signs = signsAgentPosts(await grantedScopes(gw, conversation.teamId));
    const [{ name: username, avatar }, owner, bound] = await Promise.all([
      resolveAgentIdentity(instanceName),
      getInstanceOwner(instanceName).catch(() => null),
      channelRegistry
        .resolveSlackChannelsByInstance(instanceName)
        .catch((err: unknown) => {
          getLogger().warn(
            { instanceName, err: formatError(err) },
            "slack.persona.bindings_unavailable: posting with the robot face",
          );
          return [];
        }),
    ]);
    const parsed = owner ? parseAvatar(avatar, owner, username) : null;
    const custom =
      parsed?.kind === "character" &&
      bound.find((c) => c.id === conversation.id)?.customEmoji?.[
        SLACK_EMOJI_INDEX[parsed.character]
      ];
    const emoji =
      parsed?.kind === "emoji"
        ? parsed.emoji
        : custom
          ? `:${custom}:`
          : ":robot_face:";
    if (signs) {
      const name = username.replace(/[*<>&]/g, "");
      return {
        persona: {},
        sign: (text, bold) => `${emoji} ${bold}${name}${bold}\n\n${text}`,
        emoji,
      };
    }
    const iconUrl = agentIcon && parsed ? await agentIcon(parsed) : null;
    if (agentIcon && parsed && !iconUrl)
      getLogger().warn(
        { agentId: instanceName, avatar: parsed.kind },
        "slack.agent_icon.missing",
      );
    return {
      persona: { username, ...(iconUrl ? { iconUrl } : {}) },
      sign: (text) => text,
      emoji,
    };
  }

  async function agentFooter(
    instanceName: string,
    sessionId?: string,
    ambientRound?: boolean,
  ): Promise<AgentFooter> {
    const resolved = await resolveAgentName(instanceName);
    return {
      uiBaseUrl,
      agentId: instanceName,
      label: agentFooterLabel(resolved === instanceName ? undefined : resolved),
      ...(sessionId ? { sessionId } : {}),
      ...(ambientRound ? { ambientRound } : {}),
    };
  }

  function fileShareBlocks(
    markdown: string,
    footerBlock: SlackBlock,
    cardBlocks: SlackBlock[] = [],
  ): SlackBlock[] | null {
    const body = [...markdownToSections(markdown), ...cardBlocks];
    return body.length < SLACK_MAX_BLOCKS ? [...body, footerBlock] : null;
  }

  type AgentPost = {
    text: string;
    cardBlocks: SlackBlock[] | undefined;
    cardIssues: string[];
    blocks: SlackBlock[];
    asText: SlackBlock[] | null;
    replyText: string;
  };

  function agentPost(
    text: string,
    card: ChannelCard | undefined,
    footer: AgentFooter,
    sign: (text: string, bold: "*" | "**") => string,
  ): AgentPost {
    const withCard = (cardText: string) =>
      [text, cardText].filter((part) => part.trim()).join("\n\n");
    const cardBlocks = card ? slackCardBlocks(card) : undefined;
    return {
      text: sign(card ? withCard(slackCardText(card)) : text, "*"),
      cardBlocks,
      cardIssues: card ? slackCardIssues(card) : [],
      blocks: renderAssistantBlocks(footer, sign(text, "**"), cardBlocks),
      asText: card
        ? renderAssistantBlocks(footer, sign(withCard(card.text), "**"))
        : null,
      replyText: card ? withCard(card.text) : text,
    };
  }

  function postRefusal(post: AgentPost): { error: string } | null {
    if (post.cardIssues.length > 0)
      return {
        error: `The card was not sent: ${post.cardIssues.join("; ")}.`,
      };
    if (post.cardBlocks && post.blocks.length === 1)
      return {
        error:
          "The message shows nothing in Slack: its text is empty and its card renders no block. Add text or content to the card.",
      };
    return post.blocks.length > SLACK_MAX_BLOCKS
      ? {
          error: `With its card the message is ${post.blocks.length} Slack blocks long, and Slack takes at most ${SLACK_MAX_BLOCKS}. Shorten the card, or move part of it to a second message.`,
        }
      : null;
  }

  async function sendAgentPost<T>(
    channelId: string,
    post: AgentPost,
    send: (blocks: SlackBlock[]) => Promise<T>,
  ): Promise<T> {
    try {
      return await send(post.blocks);
    } catch (err) {
      if (!post.asText || !slackRefusedBlocks(err)) throw err;
      getLogger().warn(
        { channelId, err: formatError(err) },
        "slack.card.refused: posting the card as text",
      );
      return send(post.asText);
    }
  }

  async function stageFile(
    gw: SlackGateway,
    teamId: SlackWorkspace,
    attachment: ChannelAttachment,
  ): Promise<
    | { reserved: SlackReservedFile; bytesSent: Promise<string | null> }
    | { error: string }
  > {
    let reserved: SlackReservedFile;
    try {
      reserved = await gw.reserveFile({
        filename: attachment.filename,
        length: attachment.data.length,
        teamId,
      });
    } catch (err) {
      return { error: formatError(err) };
    }
    const bytesSent = gw
      .sendFileBytes({
        reserved,
        file: attachment.data,
        filename: attachment.filename,
        teamId,
      })
      .then(
        () => null,
        (err: unknown) => formatError(err),
      );
    return { reserved, bytesSent };
  }

  async function postWithAttachment(
    gw: SlackGateway,
    target: { id: string; teamId: SlackWorkspace },
    attachment: ChannelAttachment | undefined,
    threadTs: string | undefined,
    persona: Pick<SlackPostMessage, "username" | "iconUrl">,
    post: (fileIds: string[]) => Promise<{ ts: string } | null>,
    fileBlocks: SlackBlock[] | null,
  ): Promise<{ uploadError: string | null; ts?: string }> {
    const posted = async (fileIds: string[]) => {
      const message = await post(fileIds);
      return message ? { ts: message.ts } : {};
    };
    if (!attachment) return { uploadError: null, ...(await posted([])) };
    const share = (fileId: string, blocks?: SlackBlock[]) =>
      gw.shareFile({
        fileId,
        filename: attachment.filename,
        ...(attachment.title !== undefined ? { title: attachment.title } : {}),
        ...persona,
        channelId: target.id,
        ...(threadTs ? { threadTs } : {}),
        ...(blocks ? { blocks } : {}),
        teamId: target.teamId,
      });
    if (fileBlocks) {
      const staged = await stageFile(gw, target.teamId, attachment);
      const failure =
        "error" in staged
          ? staged.error
          : ((await staged.bytesSent) ??
            (await share(staged.reserved.fileId, fileBlocks).then(
              () => null,
              (err: unknown) => formatError(err),
            )));
      if (failure === null) return { uploadError: null };
      getLogger().warn(
        { channelId: target.id, err: failure },
        "slack.file_post.failed: posting the text and the file apart",
      );
    }
    const staged = await stageFile(gw, target.teamId, attachment);
    if ("error" in staged)
      return { uploadError: staged.error, ...(await posted([])) };
    const message = await posted([staged.reserved.fileId]);
    const bytesError = await staged.bytesSent;
    if (bytesError !== null) return { uploadError: bytesError, ...message };
    try {
      await share(staged.reserved.fileId);
      return { uploadError: null, ...message };
    } catch (err) {
      return { uploadError: formatError(err), ...message };
    }
  }

  type PendingPostDelete = {
    agentId: string;
    userId: string;
    channel: string;
    replyChannel: string;
    teamId: SlackWorkspace;
    post: SlackMessage & { ts: string };
    fileIds: string[];
    expiresAt: number;
  };

  const pendingPostDeletes = new Map<string, PendingPostDelete>();

  async function authorizePostDelete(
    userId: string,
    agentId: string,
    channel: string,
  ): Promise<{ ok: true; invoker: string } | { ok: false; text: string }> {
    const invoker = await identityLinks.resolve("slack", userId);
    const owner = invoker ? await getInstanceOwner(agentId) : null;
    if (invoker && invoker === owner) return { ok: true, invoker };
    channelDeny("slack", {
      actor: invoker,
      agentId,
      reason: invoker ? "not-owner" : "unlinked",
      detail: {
        slackUserId: userId,
        channelId: channel,
        action: "post-delete",
      },
    });
    return {
      ok: false,
      text: invoker
        ? "Only this agent's owner can delete its posts."
        : `Link your account first: run \`/${brandShort} login\`, then run \`/${brandShort} delete\` again.`,
    };
  }

  async function handleDeleteCommand(
    command: SlackSlashCommand,
    ack: SlackAck,
  ): Promise<void> {
    const gw = gateway;
    if (!gw) {
      await ack({
        text: "Slack isn't connected right now. Try again shortly.",
      });
      return;
    }
    const after = command.text.trim().replace(/^\S+\s*/, "");
    const linkText = /^\S+/.exec(after)?.[0] ?? "";
    const link = parseAgentPostLink(linkText);
    if (!link) {
      await ack({
        text:
          `Usage: \`/${brandShort} delete <message link> [reason]\`. Get the ` +
          `link from the post's "Copy link" action.`,
      });
      return;
    }
    const reason = after.slice(linkText.length).trim() || null;
    const post = await gw
      .getMessage({ ...link, teamId: command.teamId })
      .catch(() => null);
    if (!post) {
      await ack({
        text:
          "I can't find that message. Check the link points at a message in " +
          "this workspace, and that I am in that conversation.",
      });
      return;
    }
    const agentId = parseAgentFooter(post)?.agentId;
    if (!agentId) {
      await ack({
        text: "That message is not an agent post, so there is nothing for me to delete.",
      });
      return;
    }
    const auth = await authorizePostDelete(
      command.userId,
      agentId,
      link.channel,
    );
    if (!auth.ok) {
      await ack({ text: auth.text });
      return;
    }
    const now = Date.now();
    for (const [id, pending] of pendingPostDeletes)
      if (pending.expiresAt < now) pendingPostDeletes.delete(id);
    const pendingId = randomUUID();
    pendingPostDeletes.set(pendingId, {
      agentId,
      userId: command.userId,
      channel: link.channel,
      replyChannel: command.channelId,
      teamId: command.teamId,
      post,
      fileIds: deletePostFileIds(post),
      expiresAt: now + PENDING_POST_DELETE_TTL_MS,
    });
    try {
      await gw.openModal({
        triggerId: command.triggerId,
        teamId: command.teamId,
        view: deletePostModal(
          { pendingId, channel: command.channelId },
          reason,
        ),
      });
      await ack();
    } catch (err) {
      pendingPostDeletes.delete(pendingId);
      getLogger().warn(
        { agentId, err: formatError(err) },
        "slack.post_delete.modal_failed",
      );
      await ack({
        text: `Couldn't open the confirmation. Run \`/${brandShort} delete\` again.`,
      });
    }
  }

  async function handleViewSubmission(
    event: SlackViewSubmission,
  ): Promise<void> {
    const gw = gateway;
    if (event.callbackId !== DELETE_POST_CONFIRM || !gw) return;
    const parsed = parseDeletePostModal(event.privateMetadata, event.inputs);
    if (!parsed) return;
    const { metadata, reason } = parsed;
    const pending = pendingPostDeletes.get(metadata.pendingId);
    if (pending && pending.userId !== event.userId) return;
    pendingPostDeletes.delete(metadata.pendingId);
    const channel = pending?.replyChannel ?? metadata.channel;
    const reply = (text: string) =>
      gw
        .postEphemeral({
          channel,
          user: event.userId,
          text,
          teamId: pending?.teamId ?? event.teamId,
        })
        .catch(() => {});
    if (!pending || pending.expiresAt < Date.now()) {
      await reply(
        `That confirmation expired. Run \`/${brandShort} delete\` again.`,
      );
      return;
    }
    const auth = await authorizePostDelete(
      event.userId,
      pending.agentId,
      pending.channel,
    );
    if (!auth.ok) {
      await reply(auth.text);
      return;
    }
    await reply(await deleteAgentPost(gw, pending, auth.invoker, reason));
  }

  async function deleteAgentPost(
    gw: SlackGateway,
    pending: PendingPostDelete,
    invoker: string,
    reason: string | null,
  ): Promise<string> {
    const { agentId, channel, teamId, post, fileIds } = pending;
    let deleted: boolean;
    try {
      deleted = await gw.deleteMessage(channel, post.ts, teamId);
    } catch (err) {
      return `Couldn't delete the post (${formatError(err)}). Run \`/${brandShort} delete\` again to retry.`;
    }
    let fileFailure: string | null = null;
    for (const fileId of fileIds) {
      try {
        await gw.deleteFile(fileId, teamId);
      } catch (err) {
        fileFailure ??= formatError(err);
      }
    }
    if (!deleted)
      return fileFailure
        ? `This post was already deleted, but an attachment could not be (${fileFailure}).`
        : "This post was already deleted.";
    securityLog("info", "channel.post_deleted", {
      category: "channel",
      actor: invoker,
      actorKind: "user",
      surface: "slack",
      agentId,
      result: fileFailure ? "failure" : "success",
      detail: { channelId: channel, ts: post.ts, fileIds },
    });
    const told = await tellAgentPostDeleted({
      agentId,
      channel,
      post,
      withFiles: fileIds.length > 0 && fileFailure === null,
      reason,
    });
    if (fileFailure)
      return `The post was deleted, but an attachment could not be (${fileFailure}).`;
    return told ? "Post deleted. The agent will be told." : "Post deleted.";
  }

  async function tellAgentPostDeleted(args: {
    agentId: string;
    channel: string;
    post: SlackMessage & { ts: string };
    withFiles: boolean;
    reason: string | null;
  }): Promise<boolean> {
    const { agentId, channel, post } = args;
    const sessionId = footerSessionId(post);
    const { threadTs } = post;
    if (!sessionId || !threadTs) return false;
    const agent = await agents()
      .get(agentId)
      .catch(() => null);
    if (!agent || agent.stopRequested) return false;
    void withSessionTurnLock(
      agentId,
      slackThreadKey(channel, threadTs),
      async () => {
        await agents().ensureReady(agentId);
        await makeAcpClient(agentId).sendPrompt(
          postDeletedNotice({
            text: post.text ?? null,
            withFiles: args.withFiles,
            reason: args.reason,
          }),
          { resumeSessionId: sessionId },
        );
      },
    ).catch((err: unknown) => {
      getLogger().warn(
        { agentId, sessionId, err: formatError(err) },
        "slack.post_deleted.notice_failed",
      );
    });
    return true;
  }

  async function replyToWhisper(
    gw: SlackGateway,
    instanceName: string,
    turn: TurnRef,
    whisper: SlackTurnWhisper,
    args: ChannelReply,
  ): Promise<ChannelSendResult> {
    if (args.attachment)
      return {
        error:
          "A whisper's answer is shown only to the person who whispered, and " +
          "Slack cannot attach a file to that. Describe the file in your " +
          "reply, or ask them whether to post it where others can see it.",
      };
    if (args.alsoSendToChannel)
      return {
        error:
          "This was whispered to you privately, so its answer is never sent " +
          "to the channel. Reply without alsoSendToChannel.",
      };
    const [base, { persona, sign, emoji }] = await Promise.all([
      agentFooter(instanceName, turn.sessionId),
      agentPersona(gw, instanceName, {
        id: turn.channel,
        teamId: turn.teamId,
      }),
    ]);
    const footer = { ...base, emoji };
    const engaged = findTurnRef(
      instanceName,
      (ref) => ref.channel === turn.channel && ref.threadTs === turn.threadTs,
    );
    const post = agentPost(args.text, args.card, footer, sign);
    const refused = postRefusal(post);
    if (refused) return refused;
    try {
      await sendAgentPost(turn.channel, post, (blocks) =>
        gw.postEphemeral({
          channel: turn.channel,
          user: whisper.whisperer,
          teamId: turn.teamId,
          text: post.text,
          blocks,
          ...persona,
        }),
      );
    } catch (err) {
      return { error: formatError(err) };
    }
    noteEngaged(engaged, { messaged: true, replyText: post.replyText });
    return { ok: true as const };
  }

  async function ephemeral(
    channel: string,
    user: string,
    threadTs: string | undefined,
    text: string,
    teamId: SlackWorkspace,
  ) {
    if (!gateway) {
      process.stderr.write(
        `[slack] ephemeral skipped (app not started): ${text}\n`,
      );
      return;
    }
    try {
      await gateway.postEphemeral({ channel, user, threadTs, text, teamId });
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

  const turnRecovery = createTurnRecovery({
    turnStatus: (agentId, sessionId) =>
      makeAcpClient(agentId).turnStatus(sessionId),
    podGone: async (agentId) => {
      const agent = await agents().get(agentId);
      return (
        agent === null ||
        agent.state === "hibernated" ||
        agent.state === "hibernating" ||
        agent.state === "over_budget" ||
        agent.state === "error"
      );
    },
  });

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

  const readRestarts = (agentId: string) =>
    readPodRestarts(agentId).catch(() => null);

  async function restartedOutOfMemorySince(
    instanceName: string,
    baseline: PodRestartState | undefined,
  ): Promise<boolean> {
    if (baseline === undefined) return false;
    const current = await readRestarts(instanceName);
    return current !== null && isNewOutOfMemoryRestart(baseline, current);
  }

  async function runUndeliveredNudge(args: {
    instanceName: string;
    sessionId: string;
    threadKey: string;
    threadTs: string;
    verdictRefs: TurnRef[];
    anchorRef: TurnRef;
    isDelivered: () => boolean;
    isCancelled: () => boolean;
    sawFailure: boolean;
    restartsAtStart?: PodRestartState;
    externalActorId?: string;
    followUps?: readonly UnansweredFollowUp[];
  }): Promise<void> {
    const { instanceName, sessionId, threadKey, threadTs } = args;
    const disposition = () =>
      args.verdictRefs
        .map((ref) =>
          [
            ref.posted === true,
            ref.declined === true,
            ref.handedOff === true,
            ref.replyText?.length ?? 0,
          ].join(":"),
        )
        .join(" ");
    let answered: boolean | undefined;
    try {
      if (
        await bridgeClosed(
          instanceName,
          args.anchorRef.teamId,
          args.anchorRef.channel,
        )
      ) {
        getLogger().info(
          { agentId: instanceName, channelId: args.anchorRef.channel },
          "slack.turn.recovery_skipped: the conversation was released",
        );
        return;
      }
      await withSessionTurnLock(instanceName, threadKey, async () => {
        if (args.isDelivered() || args.isCancelled()) return;
        const outOfMemory = await restartedOutOfMemorySince(
          instanceName,
          args.restartsAtStart,
        );
        await agents().ensureReady(instanceName);
        if (args.isDelivered() || args.isCancelled()) return;
        /* UNIT_BOUNDARY_DESCRIPTION: the wake can outlive the conversation, so
         * the release is judged again after it, right before the nudge. */
        if (
          await bridgeClosed(
            instanceName,
            args.anchorRef.teamId,
            args.anchorRef.channel,
          )
        ) {
          getLogger().info(
            { agentId: instanceName, channelId: args.anchorRef.channel },
            "slack.turn.recovery_skipped: the conversation was released",
          );
          return;
        }
        const before = disposition();
        beginTurn(instanceName, args.anchorRef);
        try {
          await makeAcpClient(instanceName).sendPrompt(
            undeliveredNudge(threadTs, {
              sawFailure: args.sawFailure,
              outOfMemory,
              ...(args.followUps && { followUps: args.followUps }),
            }),
            { resumeSessionId: sessionId },
          );
        } finally {
          endTurn(instanceName, args.anchorRef);
          answered = disposition() !== before;
          if (!answered) {
            getLogger().info(
              { agentId: instanceName, sessionId, threadTs },
              "slack.turn.recovery_unanswered: the agent was nudged but still posted nothing",
            );
          }
        }
      });
    } finally {
      if (answered !== undefined) {
        emit({
          type: EventType.ChannelTurnRelayed,
          channel: "slack",
          agentId: instanceName,
          actorSub: null,
          ...(args.externalActorId
            ? { externalActorId: args.externalActorId }
            : {}),
          outcome: answered ? "success" : "failure",
          reason: "recovery-nudge",
        });
      }
    }
  }

  function answeredRef(ref: TurnRef, end: WatchedTurnEnd): boolean {
    return end === "interrupted"
      ? ref.declined === true || ref.handedOff === true
      : ref.posted === true || ref.declined === true || ref.handedOff === true;
  }

  function newestSteeredPerTarget(refs: TurnRef[]): TurnRef[] {
    const newest = new Map<string, TurnRef>();
    for (const ref of refs) if (ref.steered) newest.set(ref.threadTs, ref);
    return [...newest.values()];
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a turn is answered when its agent replied,
   * declined, handed off or reacted. A message steered into the turn joins it
   * after the agent may already have replied, so a turn carrying steered
   * messages is answered only when, for each reply target, its newest steered
   * message got its own reply, decline, hand-off or reaction.
   */
  function deliveredBy(refs: TurnRef[], end: WatchedTurnEnd): boolean {
    const steered = newestSteeredPerTarget(refs);
    return steered.length === 0
      ? refs.some((ref) => answeredRef(ref, end))
      : steered.every((ref) => answeredRef(ref, end));
  }

  function unansweredFollowUps(refs: TurnRef[]): TurnRef[] {
    const open = new Set(
      newestSteeredPerTarget(refs)
        .filter((ref) => !answeredRef(ref, "clean"))
        .map((ref) => ref.threadTs),
    );
    return refs.filter(
      (ref) =>
        ref.steered === true &&
        open.has(ref.threadTs) &&
        !answeredRef(ref, "clean"),
    );
  }

  function watchUndeliveredTurn(turn: {
    instanceName: string;
    sessionId: string;
    threadKey: string;
    threadTs: string;
    refs: TurnRef[];
    anchorRef: TurnRef;
    sawFailure: boolean;
    restartsAtStart?: PodRestartState;
    externalActorId?: string;
    endedAs?: WatchedTurnEnd;
    followUps?: readonly UnansweredFollowUp[];
  }): void {
    const { instanceName, sessionId, refs, endedAs, ...nudge } = turn;
    if (!serving) {
      getLogger().info(
        { agentId: instanceName, sessionId, threadTs: nudge.threadTs },
        "slack.turn.recovery_skipped: the replica is standing down; the undelivered turn is not nudged from it",
      );
      return;
    }
    holdWatchedRefs(instanceName, refs);
    turnRecovery.watch(
      {
        instanceName,
        sessionId,
        isDelivered: (end) => deliveredBy(refs, end),
        onDone: () => releaseWatchedRefs(instanceName, refs),
        recover: (end, isCancelled) =>
          runUndeliveredNudge({
            ...nudge,
            isCancelled,
            instanceName,
            sessionId,
            verdictRefs: refs,
            isDelivered: () => deliveredBy(refs, end),
          }),
      },
      ...(endedAs !== undefined ? [{ endedAs }] : []),
    );
  }

  async function runSessionTurn(args: {
    instanceName: string;
    threadKey: string;
    channelId: string;
    teamId: SlackWorkspace;
    title: string;
    buildResumePrompt: () => Promise<BuiltPrompt>;
    buildFreshPrompt: () => Promise<BuiltPrompt>;
    onWaking?: () => void;
    onReady?: () => void;
    onImagesDropped?: () => void;
    onUpdate?: (update: PromptUpdate) => void;
    onSession?: (sessionId: string, promptId?: string) => void;
    onGhostTurn?: () => void;
    legacyThreadKey?: string;
    signal?: AbortSignal;
  }): Promise<string> {
    const freshSessionMeta = async () => ({
      type: SessionType.ChannelSlack,
      threadTs: args.threadKey,
      title: args.title,
      ...pairFields(
        await channelPair?.(args.instanceName, {
          type: "slack",
          id: args.channelId,
        }),
      ),
    });
    return withSessionTurnLock(args.instanceName, args.threadKey, async () => {
      await agents().ensureReady(args.instanceName, {
        onWaking: args.onWaking,
      });
      /* UNIT_BOUNDARY_DESCRIPTION: waking an Agent can take minutes, and the DM
       * may have been released meanwhile, so the permission to prompt is
       * checked again here rather than trusting the one the enqueue gave. */
      const closed = await bridgeClosed(
        args.instanceName,
        args.teamId,
        args.channelId,
      );
      if (closed) {
        args.signal?.throwIfAborted?.();
        throw new ReleasedConversationError(closed.error);
      }
      args.onReady?.();
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
        signal: args.signal,
      };
      const send = async (
        built: BuiltPrompt,
        opts: Parameters<typeof acp.sendPrompt>[1],
      ) => {
        args.signal?.throwIfAborted();
        try {
          const answer = await acp.sendPrompt(built.prompt, opts);
          built.commit();
          return answer;
        } catch (err) {
          if (
            err instanceof AcpModelRefusedError ||
            err instanceof AcpModelCallFailedError
          )
            built.commit();
          throw err;
        }
      };
      if (existing) {
        const resume = await args.buildResumePrompt();
        try {
          return await send(resume, {
            resumeSessionId: existing.sessionId,
            ...sendOpts,
          });
        } catch (err) {
          if (!(err instanceof AcpSessionLoadError)) throw err;
          args.onGhostTurn?.();
          return send(await args.buildFreshPrompt(), {
            platformMeta: await freshSessionMeta(),
            ...sendOpts,
          });
        }
      }
      return send(await args.buildFreshPrompt(), {
        platformMeta: await freshSessionMeta(),
        ...sendOpts,
      });
    });
  }

  function relayOwnerTurn(ctx: Parameters<typeof runOwnerTurn>[0]) {
    return inBackgroundSpan(
      "channel.turn",
      { "platform.channel": "slack", "platform.channel.ambient": false },
      () => runOwnerTurn(ctx),
    );
  }

  async function runOwnerTurn(ctx: {
    instanceName: string;
    channel: string;
    threadTs: string;
    title: string;
    messages: AddressedMessage[];
    actorSub: string | null;
    externalActorId?: string;
    slackUserId: string;
    teamId: SlackWorkspace;
    images: FetchedImage[];
    files: FetchedFile[];
    droppedFiles?: string[];
    ambient: boolean;
    roster?: RosterEntry[];
    ambiguousName?: string | null;
    forwardedFrom?: string;
    whisper?: SlackTurnWhisper;
    siblingRefs?: () => TurnRef[];
    onSession?: (sessionId: string, promptId?: string) => void;
    steersSettled?: () => Promise<void>;
    held?: SupersedableTurn;
  }) {
    if (!gateway) return;
    const gw = gateway;
    const { instanceName } = ctx;
    const privateReply = ctx.whisper?.privateReply === true;
    const threadKey = slackThreadKey(ctx.channel, ctx.threadTs);

    const batched = ctx.messages.length > 1;
    const lastMessage = ctx.messages.at(-1)!;
    const eventTs = lastMessage.eventTs;
    const deliveredUpTo = ctx.messages.reduce(
      (newest, m) => laterTs(newest, m.eventTs),
      eventTs,
    );
    const steeredTs = (): string[] =>
      (ctx.siblingRefs?.() ?? []).map((ref) => ref.eventTs);
    const droppedNote = renderWithheldNote(
      (ctx.droppedFiles ?? []).map((name) => ({
        name,
        kind: "file" as const,
        reason:
          "too many attachments arrived at once for it to be included. " +
          "Send it again on its own.",
      })),
    );
    const text =
      (batched
        ? ctx.messages.map((m) => `[ts ${m.eventTs}] ${m.text}`).join("\n")
        : lastMessage.text) + droppedNote;

    const seenSessionIds = new Set<string>();
    const turnRefs: TurnRef[] = ctx.messages.map((m) => ({
      channel: ctx.channel,
      teamId: ctx.teamId,
      threadTs: m.inThread ? ctx.threadTs : m.eventTs,
      eventTs: m.eventTs,
      forwarded: ctx.forwardedFrom !== undefined,
      text: m.text,
      slackUserId: m.slackUserId,
      hasThread: m.inThread,
      hadAttachments: ctx.images.length > 0 || ctx.files.length > 0,
      ...(ctx.whisper ? { whisper: ctx.whisper } : {}),
    }));
    const replyThreadTs = turnRefs.at(-1)!.threadTs;
    const hasThread = ctx.messages[0]!.inThread;

    const verdictRefs = () => [...turnRefs, ...(ctx.siblingRefs?.() ?? [])];
    const turnSessionId = () =>
      turnRefs.find((ref) => ref.sessionId !== undefined)?.sessionId;
    const watchTurn = (
      sessionId: string,
      refs: TurnRef[],
      sawFailure: boolean,
      ending:
        { endedAs: WatchedTurnEnd } | { restartsAtStart?: PodRestartState },
      followUps: TurnRef[] = [],
    ) =>
      watchUndeliveredTurn({
        instanceName,
        sessionId,
        threadKey,
        threadTs: followUps.at(-1)?.threadTs ?? replyThreadTs,
        refs,
        anchorRef: followUps.at(-1) ?? turnRefs.at(-1)!,
        sawFailure,
        ...(followUps.length > 0 && { followUps }),
        ...(ctx.externalActorId
          ? { externalActorId: ctx.externalActorId }
          : {}),
        ...ending,
      });

    const presenter = privateReply
      ? SILENT_PRESENTER
      : createTurnPresenter(gw, {
          channel: ctx.channel,
          threadTs: replyThreadTs,
          teamId: ctx.teamId,
          instanceName,
          admit: async () =>
            (await bridgeClosed(instanceName, ctx.teamId, ctx.channel)) ===
            null,
        });
    presenter.setThinking();
    const postNotice = (text: string) =>
      privateReply
        ? ephemeral(ctx.channel, ctx.slackUserId, undefined, text, ctx.teamId)
        : gw.postMessage({
            channel: ctx.channel,
            teamId: ctx.teamId,
            threadTs: replyThreadTs,
            text,
          });

    const isDirectMessage = isDirectMessageId(ctx.channel);
    const [turnContext, agentName, owner, readsHistory] = await Promise.all([
      turnContractContext(gw, ctx.channel, eventTs, ctx.teamId, {
        batched: batched || privateReply,
      }),
      resolveAgentDisplayName(instanceName),
      resolveChannelOwner(instanceName, ctx.teamId),
      readsChannelHistoryIn(instanceName, ctx.channel, ctx.roster),
    ]);
    const { botUserId, ...contractContext } = turnContext;
    const contract = slackTurnContract({
      replyThreadTs,
      eventTs,
      batch: {
        count: ctx.messages.length,
        inThread: hasThread,
        separateTargets: separateReplyTargets(turnRefs),
      },
      identity: { brand, botUserId, agentName },
      reach: {
        isDirectMessage,
        ambient: ctx.ambient,
        channelHistory: readsHistory ? { chatId: ctx.channel } : null,
      },
      roster: rosterCopy(ctx.roster, instanceName),
      ...(ctx.whisper ? { whisper: ctx.whisper } : {}),
      owner,
      ...contractContext,
    });
    const earlierTurn =
      hasThread && !ctx.whisper
        ? await waitForSupersededTurns(instanceName, ctx.channel, ctx.threadTs)
        : "";
    const guidance = [
      addressedGuidance({
        isDirectMessage,
        botUserId,
        forwardedFrom: ctx.forwardedFrom,
        ambiguousName: ctx.ambiguousName ?? null,
        ...(ctx.whisper ? { whisper: ctx.whisper } : {}),
      }),
      ...(earlierTurn ? [earlierTurn] : []),
    ].join("\n\n");

    let outcome: TurnOutcome = "failure";
    let failureReason: string | undefined;
    const onImagesDropped = () =>
      ephemeral(
        ctx.channel,
        ctx.slackUserId,
        hasThread ? ctx.threadTs : undefined,
        "This agent can't process images yet — answering text only.",
        ctx.teamId,
      );

    let coldNoticePosted = false;
    const onWaking = () => {
      presenter.setWaking();
      if (coldNoticePosted) return;
      coldNoticePosted = true;
      ephemeral(
        ctx.channel,
        ctx.slackUserId,
        hasThread ? ctx.threadTs : undefined,
        "Waking the agent…",
        ctx.teamId,
      );
    };

    let delivery: Promise<TurnDelivery>;
    const deliverFiles = () =>
      (delivery ??= deliverTurnFiles({
        agentId: instanceName,
        conversation: threadKey,
        files: ctx.files,
        onWithheld: (f) =>
          ephemeral(
            ctx.channel,
            ctx.slackUserId,
            hasThread ? ctx.threadTs : undefined,
            `Couldn't use attached file '${f.name}': ${f.reason}`,
            ctx.teamId,
          ),
      }));

    let ghostTurn = false;
    let restartsAtStart: Promise<PodRestartState | null> | undefined;
    const stopper = new AbortController();
    const stopped = () => stopper.signal.aborted;
    const runTurn = async () => {
      await runSessionTurn({
        instanceName,
        threadKey,
        channelId: ctx.channel,
        teamId: ctx.teamId,
        title: ctx.title,
        legacyThreadKey: ctx.threadTs,
        onReady: () => {
          restartsAtStart = readRestarts(instanceName);
        },
        buildResumePrompt: async () => {
          const delivered = await deliverFiles();
          const caught = await buildCatchUp(gw, {
            ...ctx,
            hasThread,
            eventTs,
            threadKey,
            deliveredUpTo,
            steeredTs,
            batchTs: ctx.messages.map((m) => m.eventTs),
          });
          return {
            prompt: framePrompt({
              contract,
              guidance,
              ...caught.frame,
              text: text + delivered.withheldNote,
              images: ctx.images,
              files: delivered.files,
            }),
            commit: caught.commit,
          };
        },
        buildFreshPrompt: () =>
          buildThreadPrompt(
            gw,
            {
              ...ctx,
              hasThread,
              eventTs,
              text,
              threadKey,
              batchTs: ctx.messages.map((m) => m.eventTs),
              deliveredUpTo,
              steeredTs,
            },
            contract,
            {
              guidance,
              deliver: deliverFiles,
            },
          ),
        onWaking,
        onImagesDropped,
        onUpdate: (update) => {
          presenter.onUpdate(update);
          if (update.kind === "tool") ctx.held?.turn.noteTool(update.title);
        },
        onSession: (sessionId, promptId) => {
          seenSessionIds.add(sessionId);
          for (const ref of turnRefs) ref.sessionId = sessionId;
          ctx.onSession?.(sessionId, promptId);
        },
        onGhostTurn: () => {
          ghostTurn = true;
        },
        signal: stopper.signal,
      });
    };

    let failurePosted = false;
    let failureTemplateId: string | undefined;
    const postFailure = async (err: unknown) => {
      const failure = classifyTurnFailure(err);
      failureReason = failure.reason;
      getLogger().warn(
        {
          agentId: instanceName,
          reason: failureReason,
          error: formatError(err),
        },
        "slack.turn.failed",
      );
      const outage =
        failure.kind === "provider-unavailable"
          ? await lookUpProviderOutage(providerOutage, instanceName, {
              type: "slack",
              id: ctx.channel,
            })
          : null;
      failureTemplateId = outage?.templateId ?? undefined;
      if (turnRefs.some((ref) => ref.posted || ref.declined || ref.handedOff))
        return;
      const copy = match(failure)
        .with({ kind: "plain" }, ({ copy }) =>
          copy({ uiBaseUrl, agentId: instanceName, threads: true }),
        )
        .with({ kind: "spend" }, ({ block }) =>
          spendHoldUserCopy(
            block,
            "This agent",
            brand.name,
            slackResetTime(new Date()),
          ),
        )
        .with({ kind: "provider-unavailable" }, () =>
          slackProviderOutageCopy(outage, brand.name),
        )
        .exhaustive();
      await postNotice(`${copy}${renderTurnFiles(ctx)}`);
      failurePosted = true;
    };

    const releaseStoppable = holdStoppableTurn(ctx.channel, replyThreadTs, {
      instanceName,
      startedBy: (slackUserId) =>
        verdictRefs().some((ref) => ref.slackUserId === slackUserId),
      sessionIds: seenSessionIds,
      stop: async () => {
        stopper.abort();
        await presenter.clearStatus();
      },
    });
    let superseded = false;
    const onSuperseded = () => {
      superseded = true;
      stopper.abort();
      void presenter.clearStatus();
    };
    if (ctx.held?.signal.aborted) onSuperseded();
    ctx.held?.signal.addEventListener("abort", onSuperseded, { once: true });
    try {
      for (const ref of turnRefs) beginTurn(instanceName, ref);
      try {
        await runWhileAgentStarts(runTurn, {
          ...wakeWait,
          onStillStarting: async () => {
            await postNotice(
              "The agent is still starting — this can take a few more " +
                "minutes. It'll answer as soon as it's up.",
            );
          },
        });
      } finally {
        await ctx.steersSettled?.();
      }
      outcome = "success";
    } catch (err) {
      if (superseded)
        noteCarriedByThread(
          instanceName,
          threadKey,
          verdictRefs().map((ref) => ref.eventTs),
        );
      if (err instanceof ReleasedConversationError) {
        /* UNIT_BOUNDARY_DESCRIPTION: the Bridge released the conversation while
         * the Agent was still getting ready; there is nobody left to tell, and
         * posting a failure notice into a closed DM is exactly the delivery a
         * revoke forbids. */
        outcome = "success";
        getLogger().info(
          { agentId: instanceName, channelId: ctx.channel },
          "slack.turn.released_before_prompt",
        );
        return;
      }
      if (stopped()) {
        outcome = "success";
        getLogger().info(
          { agentId: instanceName, error: formatError(err) },
          "slack.turn.stopped_with_error",
        );
        return;
      }
      await postFailure(err);
      const sessionId = turnSessionId();
      if (err instanceof AcpTurnAbandonedError && sessionId !== undefined) {
        watchTurn(sessionId, verdictRefs(), failurePosted, {
          restartsAtStart: (await restartsAtStart) ?? undefined,
        });
      }
    } finally {
      releaseStoppable();
      ctx.held?.signal.removeEventListener("abort", onSuperseded);
      ctx.held?.turn.noteReplies(turnReplies(verdictRefs()));
      for (const ref of turnRefs) {
        endTurn(instanceName, ref, {
          harnessMayStillRun: mayLeaveHarnessRunning(ghostTurn, failureReason),
        });
      }
      if (outcome === "success") {
        for (const sid of seenSessionIds)
          turnRecovery.dismiss(instanceName, sid);
      }
      const settledRefs = verdictRefs();
      const nudgeSessionId = turnSessionId();
      if (
        failureReason === undefined &&
        !ghostTurn &&
        !stopped() &&
        !deliveredBy(settledRefs, "clean")
      ) {
        const followUps = settledRefs.some((ref) => ref.posted)
          ? unansweredFollowUps(settledRefs)
          : [];
        getLogger().warn(
          {
            agentId: instanceName,
            channelId: ctx.channel,
            threadTs: replyThreadTs,
            eventTs,
            unansweredFollowUps: followUps.length,
          },
          followUps.length > 0
            ? "slack.turn.unanswered: the agent replied, but messages steered into the turn after it got no answer"
            : "slack.turn.unanswered: the agent finished an addressed turn without " +
                "posting a reply or a reaction",
        );
        if (nudgeSessionId !== undefined)
          watchTurn(
            nudgeSessionId,
            settledRefs,
            false,
            { endedAs: "clean" },
            followUps,
          );
      }
      await presenter.clearStatus();
      annotateSpan({
        "platform.channel.outcome": outcome,
        ...(failureReason !== undefined && {
          "platform.channel.failure_reason": failureReason,
        }),
      });
      emit({
        type: EventType.ChannelTurnRelayed,
        channel: "slack",
        agentId: instanceName,
        actorSub: ctx.actorSub,
        ...(ctx.externalActorId
          ? { externalActorId: ctx.externalActorId }
          : {}),
        outcome,
        ...(failureReason !== undefined
          ? { reason: failureReason }
          : superseded
            ? { reason: "superseded" }
            : stopped()
              ? { reason: "stopped" }
              : {}),
        ...(failureTemplateId !== undefined
          ? { templateId: failureTemplateId }
          : {}),
      });
    }
  }

  async function readSlackContext(
    gw: SlackGateway,
    ctx: {
      instanceName: string;
      channel: string;
      teamId: SlackWorkspace;
      threadTs: string;
      hasThread: boolean;
      batchTs: string[];
    },
    catchUp: CatchUpSelection | null,
  ) {
    const bot = {
      userId: await gw.getBotUserId(ctx.teamId).catch(() => null),
      label: botHistoryLabel(brand),
    };
    const read = await getContextMessages({
      gateway: gw,
      channel: ctx.channel,
      teamId: ctx.teamId,
      threadTs: ctx.hasThread ? ctx.threadTs : undefined,
      readingAgentId: ctx.instanceName,
      carried: ctx.batchTs,
      bot,
      resolveAgentName,
      catchUp,
    });
    return { ...read, bot };
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
      threadKey: string;
      batchTs: string[];
      deliveredUpTo: string;
      steeredTs: () => string[];
      teamId: SlackWorkspace;
      images: FetchedImage[];
    },
    contract: string,
    opts?: { guidance?: string; deliver?: () => Promise<TurnDelivery> },
  ): Promise<BuiltPrompt> {
    const {
      bot,
      lines,
      hasAgentAuthored,
      hasUnattributedBot,
      hasThreadMarker,
      hasAttachmentMarker,
      offeredThreads: offeredHere,
      readNewestTs,
      readHasMore,
      threadWindow,
    } = await readSlackContext(gw, ctx, null);
    noteOfferedThreads(ctx.instanceName, ctx.channel, offeredHere);
    noteTurnThread(ctx);
    const preamble = historyPreamble(
      ctx.hasThread
        ? "thread"
        : isDirectMessageId(ctx.channel)
          ? "direct-message"
          : "channel",
      {
        hasThreadMarker,
        hasAttachmentMarker,
        windowed: threadWindow.windowed,
      },
    );
    const attribution =
      hasAgentAuthored || hasUnattributedBot
        ? historyLegend(await hasScope(gw, ctx.teamId, "users:read"), {
            botLabel: hasUnattributedBot ? bot.label : null,
          })
        : null;
    const legend = attribution ? `${preamble} ${attribution}` : preamble;
    const delivered = await opts?.deliver?.();
    return {
      prompt: framePrompt({
        contract,
        guidance: opts?.guidance,
        context: lines,
        contextLegend: legend,
        text: ctx.text + (delivered?.withheldNote ?? ""),
        images: ctx.images,
        files: delivered?.files ?? [],
      }),
      commit: () =>
        commitSeenBoundary({
          instanceName: ctx.instanceName,
          threadKey: ctx.threadKey,
          read: {
            hasMore:
              ctx.hasThread || isAmbientThreadKey(ctx.threadKey)
                ? readHasMore
                : false,
            newestReadTs: readNewestTs,
          },
          deliveredUpTo: ctx.deliveredUpTo,
          steeredTs: ctx.steeredTs,
        }),
    };
  }

  async function catchUpSince(
    gw: SlackGateway,
    ctx: {
      instanceName: string;
      channel: string;
      conversationTs: string | undefined;
      threadKey: string;
      teamId: SlackWorkspace;
    },
  ): Promise<string> {
    const remembered = readThreadSeen(ctx.instanceName, ctx.threadKey);
    if (remembered) return remembered;
    const tail =
      ctx.conversationTs !== undefined
        ? (
            await gw.getThreadReplies({
              channel: ctx.channel,
              teamId: ctx.teamId,
              threadTs: ctx.conversationTs,
              limit: THREAD_LOOKBACK,
            })
          ).messages
        : (
            await gw.getChannelHistory({
              channel: ctx.channel,
              teamId: ctx.teamId,
              limit: CHANNEL_LOOKBACK,
            })
          ).messages;
    const own = lastOwnPostTs(
      tail.map((message) => ({
        ts: message.ts,
        authorAgentId: parseAgentFooter(message)?.agentId ?? null,
        message,
      })),
      ctx.instanceName,
    );
    const floor = ((Date.now() - CATCH_UP_WINDOW_MS) / 1000).toFixed(6);
    if (own === null) return floor;
    return ctx.conversationTs !== undefined ? own : laterTs(own, floor);
  }

  async function buildCatchUp(
    gw: SlackGateway,
    ctx: {
      instanceName: string;
      channel: string;
      threadTs: string;
      eventTs: string;
      hasThread: boolean;
      threadKey: string;
      deliveredUpTo: string;
      steeredTs: () => string[];
      teamId: SlackWorkspace;
      batchTs: string[];
    },
  ): Promise<CatchUpFrame> {
    const { threadKey } = ctx;
    const conversationTs = ctx.hasThread ? ctx.threadTs : undefined;
    noteTurnThread(ctx);
    try {
      const since = await catchUpSince(gw, {
        instanceName: ctx.instanceName,
        channel: ctx.channel,
        conversationTs,
        threadKey,
        teamId: ctx.teamId,
      });
      const {
        bot,
        lines,
        hasUnattributedBot,
        hasThreadMarker,
        hasAttachmentMarker,
        offeredThreads: offeredHere,
        readNewestTs,
        readHasMore,
      } = await readSlackContext(gw, ctx, {
        readingAgentId: ctx.instanceName,
        since,
        until: ctx.deliveredUpTo,
        carried: [
          ...ctx.batchTs,
          ...readSeenAbove(ctx.instanceName, threadKey),
        ],
      });
      const commit = () =>
        commitSeenBoundary({
          instanceName: ctx.instanceName,
          threadKey,
          read: { hasMore: readHasMore, newestReadTs: readNewestTs },
          deliveredUpTo: ctx.deliveredUpTo,
          steeredTs: ctx.steeredTs,
        });
      if (lines.length === 0) return { frame: {}, commit };
      noteOfferedThreads(ctx.instanceName, ctx.channel, offeredHere);
      return {
        frame: {
          context: lines,
          contextLegend: catchUpLegend(
            await hasScope(gw, ctx.teamId, "users:read"),
            {
              botLabel: hasUnattributedBot ? bot.label : null,
              someOmitted: readHasMore,
              ...(conversationTs !== undefined
                ? { threadTs: conversationTs }
                : {}),
              hasThreadMarker,
              hasAttachmentMarker,
            },
          ),
        },
        commit,
      };
    } catch (err) {
      getLogger().warn(
        {
          agentId: ctx.instanceName,
          channelId: ctx.channel,
          threadTs: ctx.threadTs,
          error: formatError(err),
        },
        "slack.catchup.failed",
      );
      return { frame: {}, commit: NO_COMMIT };
    }
  }

  function rosterNames(roster: RosterEntry[]): string {
    return roster.map((entry) => `\`${entry.name}\``).join(", ");
  }

  async function mintBindInvitation(
    slackUserId: string,
    channelId: string,
    teamId: SlackWorkspace,
  ): Promise<string> {
    const roster = await resolveRoster(channelId);
    const { state, codeVerifier, codeChallenge } = generatePkce();
    await pendingOAuthFlows.set(state, {
      slackUserId,
      channelId,
      teamId,
      codeVerifier,
      intent: "bind",
      createdAt: Date.now(),
    });

    const bindUrl = buildAuthorizeUrl(oauthConfig, state, codeChallenge);
    const alreadyHere =
      roster.length > 0
        ? ` Already connected here: ${rosterNames(roster)} — a new agent joins them rather than replacing them.`
        : "";
    return isDirectMessageId(channelId)
      ? `<${bindUrl}|Connect one of your agents to this DM>. You'll talk to it here privately, under the agent's own connected accounts and API tokens.${alreadyHere}`
      : `<${bindUrl}|Connect an agent to this channel>. Everyone here will be able to drive it under the agent's own connected accounts and API tokens.${alreadyHere}`;
  }

  async function botIsAbsentFromGroupDm(
    command: SlackSlashCommand,
  ): Promise<boolean> {
    if (!gateway || !isGroupDirectMessageName(command.channelName))
      return false;
    const asked = gateway.getConversationInfo(
      command.channelId,
      command.teamId,
    );
    const timedOut = new Promise<"unknown">((resolve) =>
      setTimeout(() => resolve("unknown"), MEMBERSHIP_CHECK_BUDGET_MS).unref(),
    );
    const answer = await Promise.race([
      asked.then(
        (lookup) =>
          match(lookup)
            .with({ kind: "found" }, () => "present" as const)
            .with(
              { kind: "not-found" },
              { kind: "no-credential" },
              () => "absent" as const,
            )
            .exhaustive(),
        () => "unknown" as const,
      ),
      timedOut,
    ]);
    return answer === "absent";
  }

  function groupDmUnreachableCopy(): string {
    return (
      `I can't be added to this group DM: Slack only lets an app into a group DM that was started with it. ` +
      `Start a new group DM that includes @${brand.name}, or move this conversation to a private channel and invite me there, then run \`/${brandShort} bind\` again.`
    );
  }

  async function handleSessionStopped(event: SlackSessionStoppedEvent) {
    const gw = gateway;
    if (!gw) return;
    const { channel, threadTs, teamId, user } = event;
    for (const ts of event.streamingMessageTs) {
      await gw
        .stopStream({ channel, ts, teamId })
        .catch((err) =>
          getLogger().debug(
            { channelId: channel, ts, err: formatError(err) },
            "slack.stop.stream_stop_failed",
          ),
        );
    }
    const running = [...(stoppableTurns.get(`${channel} ${threadTs}`) ?? [])];
    if (running.length === 0) {
      await gw
        .setStatus({ channel, threadTs, teamId, status: "" })
        .catch((err) =>
          getLogger().debug(
            { channelId: channel, threadTs, err: formatError(err) },
            "slack.stop.status_clear_failed",
          ),
        );
      return;
    }
    const invoker = await identityLinks
      .resolve("slack", user)
      .catch(() => null);
    const mayStop = async (turn: StoppableTurn) =>
      turn.startedBy(user) ||
      (invoker !== null &&
        invoker ===
          (await getInstanceOwner(turn.instanceName).catch(() => null)));
    const allowed: StoppableTurn[] = [];
    for (const turn of running) if (await mayStop(turn)) allowed.push(turn);
    const agentName = await resolveAgentName(
      (allowed[0] ?? running[0]!).instanceName,
    );
    if (allowed.length === 0) {
      channelDeny("slack", {
        actor: invoker,
        agentId: running[0]!.instanceName,
        reason: "not-starter-or-owner",
        detail: { slackUserId: user, channelId: channel, trigger: "stop" },
      });
      await ephemeral(
        channel,
        user,
        threadTs,
        `Only the person who asked, or \`${agentName}\`'s owner, can stop it.`,
        teamId,
      );
      return;
    }
    for (const turn of allowed) {
      securityLog("info", "channel.authz", {
        category: "channel",
        actor: invoker,
        actorKind: invoker ? "user" : "external",
        surface: "slack",
        agentId: turn.instanceName,
        decision: "allow",
        detail: {
          basis: turn.startedBy(user) ? "starter" : "owner",
          trigger: "stop",
          slackUserId: user,
          channelId: channel,
        },
      });
      await turn.stop();
      for (const sid of turn.sessionIds)
        turnRecovery.dismiss(turn.instanceName, sid);
    }
    await ephemeral(
      channel,
      user,
      threadTs,
      `Stopped \`${agentName}\`.`,
      teamId,
    );
  }

  async function handleBotJoinedChannel(event: SlackBotJoinedChannelEvent) {
    if (!gateway || !event.inviter) return;
    await gateway.postEphemeral({
      channel: event.channel,
      user: event.inviter,
      text: await mintBindInvitation(
        event.inviter,
        event.channel,
        event.teamId,
      ),
      teamId: event.teamId,
    });
  }

  async function pickRosterAgent(
    channelId: string,
    nameArg: string,
    exampleFor: (name: string) => string,
  ): Promise<
    | { ok: true; entry: RosterEntry; roster: RosterEntry[] }
    | { ok: false; text: string }
  > {
    const roster = await resolveRoster(channelId);
    if (roster.length === 0)
      return { ok: false, text: "This channel isn't connected to an agent." };

    if (!nameArg) {
      if (roster.length === 1) return { ok: true, entry: roster[0]!, roster };
      return {
        ok: false,
        text:
          `${roster.length} agents are connected here: ${rosterNames(roster)}. ` +
          `Name the one you mean — \`${exampleFor(roster[0]!.name)}\`.`,
      };
    }

    const { matches } = matchRosterName(roster, nameArg);
    if (matches.length === 0)
      return {
        ok: false,
        text:
          `No agent called \`${nameArg}\` is connected here. ` +
          `Connected: ${rosterNames(roster)}.`,
      };
    if (matches.length > 1)
      return {
        ok: false,
        text:
          `More than one agent connected here is called \`${nameArg}\`, so I ` +
          "can't tell which you mean. Use the platform UI, where each is " +
          "listed separately.",
      };
    return { ok: true, entry: matches[0]!, roster };
  }

  async function handleCommand(
    command: SlackSlashCommand,
    ack: SlackAck,
    respond: SlackRespond,
  ) {
    const reply = { ack, respond, receivedAt: Date.now() };
    const subcommand = command.text.trim().toLowerCase();
    const [verb = ""] = subcommand.split(/\s+/).filter(Boolean);
    const rest = command.text
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(1)
      .join(" ");

    await match(verb)
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
          teamId: command.teamId,
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
        if (await botIsAbsentFromGroupDm(command)) {
          getLogger().info(
            { channelId: command.channelId, teamId: command.teamId },
            "slack.bind.refused_group_dm_without_bot",
          );
          await ack({ text: groupDmUnreachableCopy() });
          return;
        }
        await ack({
          text: await mintBindInvitation(
            command.userId,
            command.channelId,
            command.teamId,
          ),
        });
      })
      .with("unbind", async () => {
        /* UNIT_BOUNDARY_DESCRIPTION: A DM the Bridge paired is released from
         * its record, not from the roster: the record is what names the
         * destination and whom to authorize, and it survives the binding the
         * earlier attempt already deleted — which is what lets the command the
         * person is told to run again actually finish the job. */
        let pending: {
          agentId: string;
          ownerSub: string;
          state: "active" | "revoking";
        }[];
        try {
          pending =
            (await dmBridges?.pendingInChat({
              teamId: command.teamId,
              slackChannelId: command.channelId,
            })) ?? [];
        } catch (err) {
          getLogger().warn(
            { error: formatError(err) },
            "slack.unbind.bridge_unreadable",
          );
          await ack({
            text: "Couldn't read this conversation's state just now, so nothing was changed. Try again in a moment.",
          });
          return;
        }
        if (pending.length > 0) {
          const bridged = await releaseBridgedDm(command, ack, pending, rest);
          if (bridged !== null) {
            if (bridged) await ack({ text: bridged });
            return;
          }
        }

        const picked = await pickRosterAgent(
          command.channelId,
          rest,
          (name) => `/${brandShort} unbind ${name}`,
        );
        if (!picked.ok) {
          await ack({ text: picked.text });
          return;
        }
        const binding = picked.entry;
        let agentOwner: string | null = null;

        const invoker = await authorizeActor(command, ack, {
          agentId: binding.instanceName,
          subcommand: "unbind",
          allowed: async (invoker) => {
            agentOwner = await getInstanceOwner(binding.instanceName);
            return invoker === binding.owner || invoker === agentOwner;
          },
          denyReason: "not-binder-or-owner",
          denyCopy:
            "Only the person who connected this channel, or the agent's owner, can disconnect it.",
        });
        if (!invoker) return;

        await unbindSlackChannel(binding.instanceName, command.channelId);
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
          slackChannelId: command.channelId,
          ownerSub: agentOwner ?? binding.owner,
        });
        const remaining = picked.roster.filter(
          (entry) => entry.instanceName !== binding.instanceName,
        );
        await ack({
          text:
            remaining.length === 0
              ? `\`${binding.name}\` disconnected. Run \`/${brandShort} bind\` to connect an agent again.`
              : `\`${binding.name}\` disconnected. Still connected here: ${rosterNames(remaining)}.` +
                (binding.isDefault
                  ? ` It was this channel's default agent, so mentions with no name now reach no one until an agent's owner runs \`/${brandShort} default <agent>\`.`
                  : ""),
        });
      })
      .with("ambient", async () => {
        await handleSwitchCommand(AMBIENT_SWITCH, rest, command, ack);
      })
      .with("history", async () => {
        await handleSwitchCommand(HISTORY_SWITCH, rest, command, ack);
      })
      .with("ignore", async () => {
        await handleIgnoreCommand(rest, command, ack);
      })
      .with("unignore", async () => {
        await handleUnignoreCommand(rest, command, ack);
      })
      .with("delete", async () => {
        await handleDeleteCommand(command, ack);
      })
      .with("default", async () => {
        await handleDefaultCommand(rest, command, reply);
      })
      .with("who", async () => {
        await handleWhoCommand(command, reply);
      })
      .with("whisper", async () => {
        const { action, nameArg } = parseSwitchArgs(rest);
        if (action && parseWhisperRequest(rest).message === null)
          await handleWhisperSwitchCommand(action, nameArg, command, ack);
        else await handleWhisperCommand(command, ack);
      })
      .with(P.string, async () => {
        await ack({
          text: `Usage: \`/${brandShort} who\`, \`/${brandShort} bind\`, \`/${brandShort} unbind [agent]\`, \`/${brandShort} default [agent]\`, \`/${brandShort} ambient [agent] on|off\`, \`/${brandShort} history [agent] on|off\`, \`/${brandShort} ignore [message link]\`, \`/${brandShort} unignore <app>\`, \`/${brandShort} whisper [agent] ["message"]\`, \`/${brandShort} whisper [agent] on|off\`, or \`/${brandShort} delete <message link> [reason]\`. The agent name is needed only where more than one is connected here. Every command except \`whisper\` and \`delete\` also works as a mention, for example \`@${brand.name} who\`.`,
        });
      })
      .exhaustive();
  }

  function pickWhisperTarget(
    roster: RosterEntry[],
    name: string,
    usage: string,
  ): { ok: true; entry: RosterEntry } | { ok: false; text: string } {
    const example = `\`${usage} ${roster[0]!.name} "your message"\``;
    if (!name) {
      const fallback =
        defaultOf(roster) ?? (roster.length === 1 ? roster[0]! : null);
      return fallback
        ? { ok: true, entry: fallback }
        : {
            ok: false,
            text:
              "This conversation has no default agent, so name the one you " +
              `mean — ${example}. Connected here: ${rosterNames(roster)}.`,
          };
    }
    const { matches } = matchRosterName(roster, name);
    if (matches.length === 1) return { ok: true, entry: matches[0]! };
    if (matches.length > 1)
      return {
        ok: false,
        text:
          `More than one agent connected here is called \`${name}\`, so I ` +
          "can't tell which you mean.",
      };
    return {
      ok: false,
      text:
        `No agent called \`${name}\` is connected here. Connected: ` +
        `${rosterNames(roster)}. To whisper a message, put it in quotes — ` +
        `${example}.`,
    };
  }

  async function handleWhisperCommand(
    command: SlackSlashCommand,
    ack: SlackAck,
  ) {
    if (!gateway) return;
    const gw = gateway;
    const usage = `/${brandShort} whisper`;
    const request = parseWhisperRequest(
      command.text.trim().replace(/^\S+/, ""),
    );
    const roster = await resolveRoster(command.channelId);
    if (roster.length === 0) {
      await ack({
        text: "No agent is connected to this conversation, so there is no one here to whisper to.",
      });
      return;
    }
    const picked = pickWhisperTarget(roster, request.name, usage);
    if (!picked.ok) {
      await ack({ text: picked.text });
      return;
    }
    const target = picked.entry;
    const takes = await takesWhispers(target.instanceName);
    if (takes === null) {
      await ack({
        text: `Couldn't check whether \`${target.name}\` takes whispers. Try again in a moment.`,
      });
      return;
    }
    if (!takes) {
      channelDeny("slack", {
        actor: null,
        agentId: target.instanceName,
        reason: "whisper-off",
        detail: { slackUserId: command.userId, channelId: command.channelId },
      });
      await ack({ text: whisperOffText(target.name) });
      return;
    }

    if (request.message !== null) {
      await ack({
        text: `Whispered to \`${target.name}\`. Its answer will appear here, and nobody else in this conversation will see it.`,
      });
      const eventTs = whisperTs();
      await relaySharedTurn({
        channel: command.channelId,
        teamId: target.teamId,
        threadTs: eventTs,
        messages: [
          {
            text: request.message,
            eventTs,
            slackUserId: command.userId,
            inThread: false,
          },
        ],
        slackUserId: command.userId,
        instanceName: target.instanceName,
        owner: target.owner,
        images: [],
        files: [],
        ambient: target.ambient,
        roster,
        whisper: {
          whisperer: command.userId,
          origin: command.channelId,
          privateReply: true,
          command: usage,
        },
      });
      await noticeWhispersTurnedOff(target.instanceName, {
        channel: command.channelId,
        teamId: command.teamId,
        whisperer: command.userId,
        origin: command.channelId,
        threadTs: undefined,
      });
      return;
    }

    let checksMembership = false;
    if (!isDirectMessageId(command.channelId)) {
      try {
        checksMembership = (
          await gw.listSharedChannels(command.userId, command.teamId)
        ).includes(command.channelId);
      } catch (err) {
        getLogger().warn(
          { channelId: command.channelId, error: formatError(err) },
          "slack.whisper.membership_unknown",
        );
        await ack({
          text: "Couldn't confirm you're a member of this conversation, so no whisper was opened. Try again in a moment.",
        });
        return;
      }
    }

    let dm = "";
    let rootTs: string | null = null;
    try {
      dm = await gw.openDirectMessage(command.userId, command.teamId);
      /* UNIT_BOUNDARY_DESCRIPTION: the root is a post into that DM, so the DM's
       * closure is judged before it is written rather than after. */
      const closed = await bridgeClosed(
        target.instanceName,
        command.teamId,
        dm,
      );
      if (closed) {
        await ack({ text: closed.error });
        return;
      }
      const root = await gw.postMessage({
        channel: dm,
        teamId: command.teamId,
        text:
          `You're whispering with \`${target.name}\` from <#${command.channelId}>. ` +
          `Reply in this thread to talk to it. Nobody in <#${command.channelId}> ` +
          "sees this conversation, and the agent keeps what you say here out " +
          "of it. Like every conversation with an agent, its owner can read it.",
        metadata: whisperSessionMetadata({
          agentId: target.instanceName,
          origin: command.channelId,
          originWorkspace: command.teamId,
          user: command.userId,
          checksMembership,
        }),
      });
      rootTs = root?.ts ?? null;
    } catch (err) {
      getLogger().warn(
        { agentId: target.instanceName, error: formatError(err) },
        "slack.whisper.open_failed",
      );
    }
    if (!rootTs) {
      await ack({
        text: "Couldn't open a direct message with you to whisper in. Try again in a moment.",
      });
      return;
    }

    securityLog("info", "channel.whisper_opened", {
      category: "channel",
      actor: null,
      actorKind: "external",
      surface: "slack",
      agentId: target.instanceName,
      result: "success",
      detail: {
        slackUserId: command.userId,
        channelId: command.channelId,
        whisperChannelId: dm,
      },
    });
    const link = await gw
      .getPermalink(dm, rootTs, command.teamId)
      .catch(() => null);
    const where = link ? `<${link}|your DM with me>` : "your DM with me";
    await ack({
      text: `Opened a whisper with \`${target.name}\` in ${where}. Reply in that thread — nobody else here sees it.`,
    });
  }

  const whisperRoots = new Map<
    string,
    { session: WhisperSession | null; expiresAt: number }
  >();

  async function resolveWhisperSession(
    gw: SlackGateway,
    channel: string,
    threadTs: string,
    teamId: SlackWorkspace,
  ): Promise<WhisperSession | null> {
    const key = `${teamId}/${channel}/${threadTs}`;
    const now = Date.now();
    const cached = whisperRoots.get(key);
    if (cached && cached.expiresAt > now) return cached.session;
    if (whisperRoots.size > 5_000) {
      for (const [stale, entry] of whisperRoots) {
        if (entry.expiresAt <= now) whisperRoots.delete(stale);
      }
    }
    const [root, botUserId] = await Promise.all([
      gw.getMessage({ channel, ts: threadTs, teamId }),
      gw.getBotUserId(teamId),
    ]);
    const session = root ? parseWhisperSession(root, botUserId) : null;
    whisperRoots.set(key, { session, expiresAt: now + WHISPER_ROOT_TTL_MS });
    return session;
  }

  async function relayWhisperThread(
    event: SlackMentionEvent,
    session: WhisperSession,
    slackUserId: string,
  ) {
    if (!gateway || session.user !== slackUserId) return;
    const gw = gateway;
    const threadTs = event.threadTs ?? event.ts;
    const ended = (why: string) =>
      ephemeral(
        event.channel,
        slackUserId,
        threadTs,
        `This whisper has ended — ${why}. Run \`/${brandShort} whisper\` in a conversation an agent is connected to, to start another.`,
        event.teamId,
      );
    const deny = (reason: string) =>
      channelDeny("slack", {
        actor: null,
        agentId: session.agentId,
        reason,
        detail: {
          slackUserId,
          channelId: session.origin,
          whisperChannelId: event.channel,
        },
      });

    const entry = (await resolveRoster(session.origin)).find(
      (candidate) => candidate.instanceName === session.agentId,
    );
    if (!entry) {
      deny("whisper-unbound");
      await ended(`its agent is no longer connected to <#${session.origin}>`);
      return;
    }
    const takes = await takesWhispers(entry.instanceName);
    if (takes === null) {
      await ephemeral(
        event.channel,
        slackUserId,
        threadTs,
        "Couldn't check whether this agent still takes whispers, so this message wasn't passed on. Send it again in a moment.",
        event.teamId,
      );
      return;
    }
    if (!takes) {
      deny("whisper-off");
      await ephemeral(
        event.channel,
        slackUserId,
        threadTs,
        whispersOffEndedText(session.origin),
        event.teamId,
      );
      return;
    }
    if (session.checksMembership) {
      let member: boolean;
      try {
        member = (
          await gw.listSharedChannels(
            slackUserId,
            session.originWorkspace ?? event.teamId,
          )
        ).includes(session.origin);
      } catch (err) {
        getLogger().warn(
          { agentId: entry.instanceName, error: formatError(err) },
          "slack.whisper.membership_unknown",
        );
        await ephemeral(
          event.channel,
          slackUserId,
          threadTs,
          `Couldn't confirm you're still in <#${session.origin}>, so this message wasn't passed on. Send it again in a moment.`,
          event.teamId,
        );
        return;
      }
      if (!member) {
        deny("whisper-not-member");
        await ended(`you're no longer in <#${session.origin}>`);
        return;
      }
    }

    const closed = await bridgeClosed(
      entry.instanceName,
      event.teamId,
      event.channel,
    );
    if (closed) {
      await ephemeral(
        event.channel,
        slackUserId,
        threadTs,
        closed.error,
        event.teamId,
      );
      return;
    }
    const fetched = await fetchTurnAttachments(event, slackUserId);
    if (fetched === null) return;
    await enqueueAddressed(
      {
        channelId: event.channel,
        teamId: event.teamId,
        threadTs,
        oneThread: true,
        instanceName: entry.instanceName,
        speakerLabel: false,
        directMessage: true,
        whisper: {
          whisperer: slackUserId,
          origin: session.origin,
          privateReply: false,
          command: `/${brandShort} whisper`,
        },
      },
      slackUserId,
      {
        text: event.text + fetched.withheldNote,
        eventTs: event.ts,
        slackUserId,
        sender: event.sender,
        speaker: await speakerOf(event.sender),
        inThread: true,
        images: fetched.images,
        files: fetched.files,
        release: fetched.release,
        turn: {
          owner: entry.owner,
          teamId: event.teamId,
          ambient: false,
        },
      },
    );
  }

  function rosterRoll(roster: RosterEntry[]): string {
    return roster
      .map(
        (entry) =>
          `• \`${entry.name}\`${entry.isDefault ? " — default" : ""}${
            entry.ambient ? " (reads along)" : ""
          }`,
      )
      .join("\n");
  }

  async function ownerMention(entry: RosterEntry): Promise<string | null> {
    const owner =
      (await getInstanceOwner(entry.instanceName).catch(() => null)) ??
      entry.owner;
    const slackUserId = await ownerSlackUserId(
      entry.instanceName,
      owner,
      entry.teamId,
    );
    if (slackUserId) return `<@${slackUserId}>`;
    const name = await ownerName(entry.instanceName, owner);
    return name ? escapeMrkdwn(name) : null;
  }

  async function ownedRosterRoll(roster: RosterEntry[]): Promise<string> {
    const teamId = roster[0]?.teamId;
    const [owners, identities, botUserId] = await Promise.all([
      Promise.all(roster.map(ownerMention)),
      Promise.all(
        roster.map((entry) => resolveAgentIdentity(entry.instanceName)),
      ),
      teamId ? gateway?.getBotUserId(teamId).catch(() => null) : null,
    ]);
    const tag = botUserId ? `<@${botUserId}>` : `@${brand.name}`;
    return roster
      .map((entry, i) => {
        const owner = owners[i] ? `, owned by ${owners[i]}` : "";
        const named = `${tag} ${escapeMrkdwn(entry.name)} &lt;message&gt;`;
        const role = roleLine(identities[i]!.description);
        return (
          `• \`${entry.name}\`${owner}${entry.isDefault ? ", the default" : ""}. ` +
          (entry.ambient
            ? "Reads every message here. "
            : "Reads only messages that tag it. ") +
          (entry.history ? "Can read this conversation's history. " : "") +
          (entry.isDefault
            ? `Reach it with ${tag} &lt;message&gt; or ${named}.`
            : `Reach it with ${named}.`) +
          (role ? `\n      _${role}_` : "")
        );
      })
      .join("\n");
  }

  function roleLine(description: string): string {
    const chars = [
      ...description.replace(/\s+/g, " ").trim().replaceAll("_", "ˍ"),
    ];
    return escapeMrkdwn(
      chars.length > ROLE_LINE_MAX
        ? `${chars.slice(0, ROLE_LINE_MAX - 1).join("")}…`
        : chars.join(""),
    );
  }

  async function ackWhenReady(
    reply: CommandReply,
    pending: Promise<string>,
  ): Promise<void> {
    const text = pending.catch((err: unknown) => {
      getLogger().warn(
        { error: formatError(err) },
        "slack.command.reply_failed",
      );
      return "Could not list the agents here. Try again.";
    });
    const left = reply.receivedAt + ROSTER_ACK_BUDGET_MS - Date.now();
    const ready = await Promise.race([
      text,
      sleep(Math.max(0, left), null, { ref: false }),
    ]);
    if (ready !== null) {
      await reply.ack({ text: ready });
      return;
    }
    await reply.ack();
    try {
      await reply.respond(await text);
    } catch (err) {
      getLogger().warn(
        { error: formatError(err) },
        "slack.command.late_reply_failed",
      );
    }
  }

  async function handleWhoCommand(
    command: SlackSlashCommand,
    reply: CommandReply,
  ) {
    const roster = await resolveRoster(command.channelId);
    if (roster.length === 0) {
      await reply.ack({
        text: `No agent is connected here. Run \`/${brandShort} bind\` to connect one of yours.`,
      });
      return;
    }
    await ackWhenReady(
      reply,
      ownedRosterRoll(roster).then((roll) => `Connected here:\n${roll}`),
    );
  }

  async function handleDefaultCommand(
    rest: string,
    command: SlackSlashCommand,
    reply: CommandReply,
  ) {
    const { ack } = reply;
    const roster = await resolveRoster(command.channelId);
    if (roster.length === 0) {
      await ack({ text: "This channel isn't connected to an agent." });
      return;
    }

    if (!rest) {
      const current = roster.find((entry) => entry.isDefault);
      await ackWhenReady(
        reply,
        ownedRosterRoll(roster).then(
          (roll) =>
            (current
              ? `\`${current.name}\` is this channel's default agent — a mention with a message that names no agent reaches it.`
              : "This channel has no default agent set.") +
            `\n\nConnected here:\n${roll}\n\nRun \`/${brandShort} default <agent>\` to change it; only that agent's owner can.`,
        ),
      );
      return;
    }

    const { matches } = matchRosterName(roster, rest);
    if (matches.length === 0) {
      await ack({
        text: `No agent called \`${rest}\` is connected here.\n\nConnected:\n${rosterRoll(roster)}`,
      });
      return;
    }
    if (matches.length > 1) {
      await ack({
        text: `More than one agent connected here is called \`${rest}\`, so I can't tell which you mean.`,
      });
      return;
    }
    const target = matches[0]!;

    if (target.isDefault) {
      await ack({
        text: `\`${target.name}\` is already this channel's default agent.`,
      });
      return;
    }

    const invoker = await identityLinks.resolve("slack", command.userId);
    if (!invoker) {
      await ack({
        text: `Link your account first — run \`/${brandShort} login\`, then \`/${brandShort} default ${target.name}\` again.`,
      });
      return;
    }

    const agentOwner = await getInstanceOwner(target.instanceName);
    if (invoker !== target.owner && invoker !== agentOwner) {
      channelDeny("slack", {
        actor: invoker,
        agentId: target.instanceName,
        reason: "not-agent-owner",
        detail: {
          slackUserId: command.userId,
          channelId: command.channelId,
        },
      });
      await ack({
        text: `Only \`${target.name}\`'s owner can make it the default agent — being the default sends it every unnamed mention, so the load lands on them.`,
      });
      return;
    }

    const previous = roster.find((entry) => entry.isDefault);
    const changed = await setSlackDefault(
      target.instanceName,
      command.channelId,
    );
    if (!changed) {
      await ack({
        text: `Couldn't set \`${target.name}\` as the default — it may have just been disconnected.`,
      });
      return;
    }

    securityLog("info", "channel.default_changed", {
      category: "authz-list",
      actor: invoker,
      actorKind: "user",
      surface: "slack",
      agentId: target.instanceName,
      result: "success",
      detail: {
        slackUserId: command.userId,
        channelId: command.channelId,
        ...(previous ? { previousAgentId: previous.instanceName } : {}),
      },
    });

    await ack({
      text:
        `\`${target.name}\` is now this channel's default agent — mentions with a message that names no agent reach it` +
        (previous ? `, not \`${previous.name}\`` : "") +
        `. Every agent here stays reachable by name.`,
    });
  }

  const isBinderOrOwner = async (
    binding: RosterEntry,
    invoker: string,
  ): Promise<boolean> => {
    const owner = await getInstanceOwner(binding.instanceName);
    return invoker === binding.owner || invoker === owner;
  };

  function anyRosterOwner(roster: RosterEntry[]) {
    return async (invoker: string): Promise<boolean> => {
      for (const entry of roster) {
        if (entry.owner === invoker) return true;
        if ((await getInstanceOwner(entry.instanceName)) === invoker)
          return true;
      }
      return false;
    };
  }

  async function authorizeActor(
    command: SlackSlashCommand,
    ack: SlackAck,
    opts: {
      agentId: string | null;
      subcommand: string;
      allowed: (invoker: string) => Promise<boolean>;
      denyReason: string;
      denyCopy: string;
    },
  ): Promise<string | null> {
    const invoker = await identityLinks.resolve("slack", command.userId);
    const detail = {
      slackUserId: command.userId,
      channelId: command.channelId,
    };
    if (!invoker) {
      channelDeny("slack", {
        actor: null,
        agentId: opts.agentId,
        reason: "unlinked",
        detail,
      });
      await ack({
        text: `Link your account first — run \`/${brandShort} login\`, then \`/${brandShort} ${opts.subcommand}\` again.`,
      });
      return null;
    }
    if (await opts.allowed(invoker)) return invoker;
    channelDeny("slack", {
      actor: invoker,
      agentId: opts.agentId,
      reason: opts.denyReason,
      detail,
    });
    await ack({ text: opts.denyCopy });
    return null;
  }

  function appLabel(app: SlackIgnoredApp): string {
    return `\`${app.name || app.botId}\``;
  }

  function ignoredListCopy(ignored: SlackIgnoredApp[]): string {
    return ignored.length === 0
      ? `The agents here hear every app and webhook. To ignore one, run \`/${brandShort} ignore <link to one of its posts>\`.`
      : `The agents here ignore posts from ${ignored.map(appLabel).join(", ")}. Run \`/${brandShort} unignore <app>\` to hear one again.`;
  }

  async function resolveLinkedApp(
    linkText: string,
    teamId: SlackWorkspace,
  ): Promise<{ ok: true; app: SlackIgnoredApp } | { ok: false; text: string }> {
    const link = parseAgentPostLink(linkText);
    if (!link)
      return {
        ok: false,
        text: `That isn't a message link. Use the post's "Copy link" action.`,
      };
    const post = gateway
      ? await gateway.getMessage({ ...link, teamId }).catch(() => null)
      : null;
    if (!post)
      return {
        ok: false,
        text: "I can't find that message. Check the link points at a message in this workspace, and that I am in that conversation.",
      };
    if (parseAgentFooter(post))
      return {
        ok: false,
        text: "That is an agent's post. Posts by agents always reach the other agents here; only apps and webhooks can be ignored.",
      };
    if (!post.botId)
      return {
        ok: false,
        text: "That message is from a person. Only apps and webhooks can be ignored.",
      };
    return { ok: true, app: { botId: post.botId, name: post.botName ?? "" } };
  }

  async function handleIgnoreCommand(
    rest: string,
    command: SlackSlashCommand,
    ack: SlackAck,
  ) {
    const roster = await resolveRoster(command.channelId);
    if (roster.length === 0) {
      await ack({
        text: `No agent is connected here, so there is nothing to ignore apps for. Run \`/${brandShort} bind\` to connect one.`,
      });
      return;
    }
    const linkText = /^\S+/.exec(rest)?.[0] ?? "";
    if (!linkText) {
      await ack({
        text: ignoredListCopy(await ignoredApps.list(command.channelId)),
      });
      return;
    }
    const resolved = await resolveLinkedApp(linkText, command.teamId);
    if (!resolved.ok) {
      await ack({ text: resolved.text });
      return;
    }
    const invoker = await authorizeActor(command, ack, {
      agentId: roster[0]?.instanceName ?? null,
      subcommand: "ignore <message link>",
      allowed: anyRosterOwner(roster),
      denyReason: "not-binder-or-owner-here",
      denyCopy:
        "Only someone who connected an agent here, or owns one connected here, can change which apps the agents here ignore.",
    });
    if (!invoker) return;
    const added = await ignoredApps.ignore(
      command.channelId,
      resolved.app,
      invoker,
    );
    if (added)
      securityLog("info", "channel.app_ignored", {
        category: "authz-list",
        actor: invoker,
        actorKind: "user",
        surface: "slack",
        agentId: roster[0]!.instanceName,
        result: "success",
        detail: {
          slackUserId: command.userId,
          channelId: command.channelId,
          botId: resolved.app.botId,
        },
      });
    await ack({
      text: added
        ? `The agents here now ignore posts from ${appLabel(resolved.app)}. Run \`/${brandShort} unignore ${resolved.app.name || resolved.app.botId}\` to hear it again.`
        : `The agents here already ignore ${appLabel(resolved.app)}.`,
    });
  }

  async function handleUnignoreCommand(
    rest: string,
    command: SlackSlashCommand,
    ack: SlackAck,
  ) {
    const roster = await resolveRoster(command.channelId);
    const ignored = await ignoredApps.list(command.channelId);
    const wanted = rest.trim();
    if (!wanted || roster.length === 0) {
      await ack({ text: ignoredListCopy(ignored) });
      return;
    }
    let app: SlackIgnoredApp;
    if (parseAgentPostLink(wanted)) {
      const resolved = await resolveLinkedApp(wanted, command.teamId);
      if (!resolved.ok) {
        await ack({ text: resolved.text });
        return;
      }
      app = resolved.app;
    } else {
      const name = wanted.toLowerCase();
      const matches = ignored.filter(
        (entry) => (entry.name || entry.botId).toLowerCase() === name,
      );
      if (matches.length !== 1) {
        await ack({
          text:
            (matches.length === 0
              ? `No ignored app here is called \`${wanted}\`. `
              : `More than one ignored app here is called \`${wanted}\`; run \`/${brandShort} unignore <link to one of its posts>\` instead. `) +
            ignoredListCopy(ignored),
        });
        return;
      }
      app = matches[0]!;
    }
    const invoker = await authorizeActor(command, ack, {
      agentId: roster[0]?.instanceName ?? null,
      subcommand: `unignore ${wanted}`,
      allowed: anyRosterOwner(roster),
      denyReason: "not-binder-or-owner-here",
      denyCopy:
        "Only someone who connected an agent here, or owns one connected here, can change which apps the agents here ignore.",
    });
    if (!invoker) return;
    const removed = await ignoredApps.unignore(command.channelId, app.botId);
    if (removed)
      securityLog("info", "channel.app_unignored", {
        category: "authz-list",
        actor: invoker,
        actorKind: "user",
        surface: "slack",
        agentId: roster[0]!.instanceName,
        result: "success",
        detail: {
          slackUserId: command.userId,
          channelId: command.channelId,
          botId: app.botId,
        },
      });
    await ack({
      text: removed
        ? `The agents here hear ${appLabel(app)} again.`
        : `The agents here don't ignore ${appLabel(app)}.`,
    });
  }

  function whisperOffText(name: string): string {
    return (
      `Whispers to \`${name}\` are turned off. ` +
      "Mention it in the conversation instead."
    );
  }

  function whispersOffEndedText(origin: string): string {
    return (
      "This whisper has ended: the agent's owner turned whispers off. " +
      `To keep talking to it, mention it in <#${origin}>.`
    );
  }

  async function noticeWhispersTurnedOff(
    instanceName: string,
    where: {
      channel: string;
      teamId: SlackWorkspace;
      whisperer: string;
      origin: string;
      threadTs: string | undefined;
    },
  ) {
    if ((await takesWhispers(instanceName)) !== false) return;
    await ephemeral(
      where.channel,
      where.whisperer,
      where.threadTs,
      whispersOffEndedText(where.origin),
      where.teamId,
    );
  }

  async function takesWhispers(instanceName: string): Promise<boolean | null> {
    try {
      const agent = await agents().get(instanceName);
      return agent !== null && agent.spec.whispersOff !== true;
    } catch (err) {
      getLogger().warn(
        { agentId: instanceName, error: formatError(err) },
        "slack.whisper.setting_unread",
      );
      return null;
    }
  }

  async function handleWhisperSwitchCommand(
    action: "on" | "off",
    nameArg: string,
    command: SlackSlashCommand,
    ack: SlackAck,
  ) {
    const usage = `/${brandShort} whisper <agent> ${action}`;
    const invoker = await identityLinks.resolve("slack", command.userId);
    if (!invoker) {
      channelDeny("slack", {
        actor: null,
        reason: "unlinked",
        detail: { slackUserId: command.userId, channelId: command.channelId },
      });
      await ack({
        text: `Link your account first: run \`/${brandShort} login\`, then \`${usage}\` again.`,
      });
      return;
    }

    const owned = agentsFor(invoker);
    let candidates: Agent[];
    try {
      const mine = await owned.list();
      if (nameArg) {
        candidates = mine.filter((agent) => sameAgentName(agent.name, nameArg));
      } else {
        const here = new Set(
          (await resolveRoster(command.channelId)).map((e) => e.instanceName),
        );
        candidates = mine.filter((agent) => here.has(agent.id));
      }
    } catch (err) {
      getLogger().warn(
        { error: formatError(err) },
        "slack.whisper.switch_lookup_failed",
      );
      await ack({
        text: "Couldn't look up your agents. Try again in a moment.",
      });
      return;
    }
    if (candidates.length !== 1) {
      const names = candidates.map((agent) => `\`${agent.name}\``).join(", ");
      await ack({
        text:
          candidates.length > 1
            ? `More than one of your agents matches: ${names}. Name one, or use the platform UI.`
            : nameArg
              ? `You have no agent called \`${nameArg}\`. Only an agent's owner can change its whispers.`
              : `Name one of your agents: \`${usage}\`.`,
      });
      return;
    }
    const target = candidates[0]!;

    const enable = action === "on";
    if (enable === (target.spec.whispersOff !== true)) {
      await ack({
        text: `Whispers to \`${target.name}\` are already ${action}.`,
      });
      return;
    }

    let updated: Agent | null;
    try {
      updated = await owned.update({ id: target.id, whisper: enable });
    } catch (err) {
      getLogger().warn(
        { agentId: target.id, error: formatError(err) },
        "slack.whisper.switch_failed",
      );
      updated = null;
    }
    if (!updated) {
      await ack({
        text: `Couldn't change whispers for \`${target.name}\`. Try again in a moment.`,
      });
      return;
    }
    securityLog("info", "channel.whisper_toggled", {
      category: "authz-list",
      actor: invoker,
      actorKind: "user",
      surface: "slack",
      agentId: target.id,
      result: "success",
      detail: {
        slackUserId: command.userId,
        channelId: command.channelId,
        whisper: enable,
      },
    });

    await ack({
      text: enable
        ? `Whispers to \`${target.name}\` turned on. Anyone in a conversation it is connected to can talk to it privately with \`/${brandShort} whisper\`, and you can read every whisper in its sessions. Run \`/${brandShort} whisper ${target.name} off\` to turn them off again.`
        : `Whispers to \`${target.name}\` turned off in every conversation it is connected to. Open whisper threads with it end at their next message.`,
    });
  }

  interface BindingSwitch {
    verb: "ambient" | "history";
    title: string;
    perAgentNote: string;
    isOn: (entry: RosterEntry) => boolean;
    state: (on: boolean) => string;
    set: (
      agentId: string,
      slackChannelId: string,
      on: boolean,
    ) => Promise<void>;
    auditEvent: string;
    denyCopy: string;
    turnedOn: (agentName: string) => string;
    turnedOff: (agentName: string) => string;
    warnsPendingTerms: boolean;
  }

  const AMBIENT_SWITCH: BindingSwitch = {
    verb: "ambient",
    title: "Ambient mode",
    perAgentNote: "Ambient is set per agent",
    isOn: (entry) => entry.ambient,
    state: (on) =>
      on
        ? "on — it reads along and may chime in without being mentioned"
        : "off — it only responds to mentions",
    set: setSlackChannelAmbient,
    auditEvent: "channel.ambient_toggled",
    denyCopy:
      "Only the person who connected this channel, or the agent's owner, can change ambient mode.",
    turnedOn: (name) =>
      `Ambient mode turned on — \`${name}\` now reads along in this channel and may chime in without being mentioned when it can clearly help. It still answers mentions as usual; run \`/${brandShort} ambient ${name} off\` to make it mentions-only again.`,
    turnedOff: (name) =>
      `Ambient mode turned off — \`${name}\` now only responds when mentioned.`,
    warnsPendingTerms: true,
  };

  const HISTORY_SWITCH: BindingSwitch = {
    verb: "history",
    title: "Channel history",
    perAgentNote: "Channel history is set per agent",
    isOn: (entry) => entry.history,
    state: (on) =>
      on
        ? "on — it can read this conversation's older messages and its threads when an answer needs them"
        : "off — it sees only the newest messages it is handed here",
    set: setSlackChannelHistory,
    auditEvent: "channel.history_toggled",
    denyCopy:
      "Only the person who connected this channel, or the agent's owner, can change channel history.",
    turnedOn: (name) =>
      `Channel history turned on — from its next session, \`${name}\` can read this conversation's older messages and its threads when an answer needs them. What it reads lands in its sessions, which its owner can see. Run \`/${brandShort} history ${name} off\` to turn it off.`,
    turnedOff: (name) =>
      `Channel history turned off — \`${name}\` now sees only the newest messages it is handed here.`,
    warnsPendingTerms: false,
  };

  async function handleSwitchCommand(
    spec: BindingSwitch,
    rest: string,
    command: SlackSlashCommand,
    ack: SlackAck,
  ) {
    const { action, nameArg } = parseSwitchArgs(rest);
    const subcommand = action ? `${spec.verb} ${action}` : spec.verb;

    const picked = await pickRosterAgent(
      command.channelId,
      nameArg,
      (name) =>
        `/${brandShort} ${spec.verb} ${name}${action ? ` ${action}` : ""}`,
    );
    if (!picked.ok) {
      await ack({ text: picked.text });
      return;
    }
    const binding = picked.entry;

    const isOn = spec.isOn(binding);
    if (!action) {
      const others = picked.roster.filter(
        (entry) => entry.instanceName !== binding.instanceName,
      );
      const othersNote =
        others.length > 0
          ? ` ${spec.perAgentNote}; the others here are ${others
              .map((e) => `\`${e.name}\` (${spec.isOn(e) ? "on" : "off"})`)
              .join(", ")}.`
          : "";
      await ack({
        text:
          `${spec.title} for \`${binding.name}\` is ${spec.state(isOn)}. Use \`/${brandShort} ${spec.verb} ${binding.name} on\` or \`/${brandShort} ${spec.verb} ${binding.name} off\` to change it.` +
          othersNote,
      });
      return;
    }
    const enable = action === "on";

    const invoker = await authorizeActor(command, ack, {
      agentId: binding.instanceName,
      subcommand,
      allowed: (invoker) => isBinderOrOwner(binding, invoker),
      denyReason: "not-binder-or-owner",
      denyCopy: spec.denyCopy,
    });
    if (!invoker) return;

    if (enable === isOn) {
      await ack({
        text: `${spec.title} is already ${enable ? "on" : "off"}.`,
      });
      return;
    }

    await spec.set(binding.instanceName, command.channelId, enable);
    securityLog("info", spec.auditEvent, {
      category: "authz-list",
      actor: invoker,
      actorKind: "user",
      surface: "slack",
      agentId: binding.instanceName,
      result: "success",
      detail: {
        slackUserId: command.userId,
        channelId: command.channelId,
        [spec.verb]: enable,
      },
    });

    const termsPending =
      spec.warnsPendingTerms &&
      enable &&
      !(await isTermsAccepted(binding.owner))
        ? ` Heads-up: the person who connected this channel hasn't accepted the Terms of Use at ${uiBaseUrl} yet, so the agent stays silent until they do.`
        : "";
    await ack({
      text: enable
        ? `${spec.turnedOn(binding.name)}${termsPending}`
        : spec.turnedOff(binding.name),
    });
  }

  async function fetchTurnAttachments(
    event: SlackMentionEvent,
    slackUserId: string,
  ): Promise<TurnAttachments | null> {
    if (!gateway) return null;
    const { images, files, failures, release } = await fetchSlackAttachments(
      gateway,
      event.files,
      slackUserId,
      heldBudget,
      event.teamId,
    );
    for (const f of failures) {
      await ephemeral(
        event.channel,
        slackUserId,
        event.threadTs,
        `Couldn't use attached ${f.plural ? `${f.kind}s` : f.kind} '${f.name}': ${f.reason}`,
        event.teamId,
      );
    }
    return {
      images,
      files,
      withheldNote: renderWithheldNote(failures),
      release,
    };
  }

  async function deliverTurnFiles(opts: {
    agentId: string;
    conversation: string;
    files: FetchedFile[];
    onWithheld?: (failure: FetchedFailure) => Promise<void>;
  }): Promise<TurnDelivery> {
    if (opts.files.length === 0) return { files: [], withheldNote: "" };
    const delivered: DeliveredFile[] = [];
    const failures: FetchedFailure[] = [];
    try {
      const store = workspaceFiles(opts.agentId);
      for (const f of opts.files) {
        try {
          const path = await store.write({
            path: inboundFilePath({
              conversation: opts.conversation,
              name: f.name,
              unique: randomUUID().slice(0, 8),
            }),
            bytes: f.bytes,
            ...(f.contentType ? { contentType: f.contentType } : {}),
          });
          delivered.push({
            name: f.name,
            path,
            size: f.bytes.length,
            ...(f.contentType ? { contentType: f.contentType } : {}),
          });
          securityLog("info", "channel.file.delivered", {
            category: "channel",
            actor: f.uploader,
            actorKind: "external",
            surface: "slack",
            agentId: opts.agentId,
            result: "success",
            target: path,
            detail: { file: f.name, bytes: f.bytes.length },
          });
        } catch (err) {
          getLogger().warn(
            {
              agentId: opts.agentId,
              file: f.name,
              bytes: f.bytes.length,
              error: formatError(err),
            },
            "slack.file.undelivered",
          );
          failures.push({
            name: f.name,
            kind: "file",
            reason: `the agent couldn't be handed it (${formatError(err)}). Try resending.`,
          });
        }
      }
    } catch (err) {
      getLogger().warn(
        { agentId: opts.agentId, error: formatError(err) },
        "slack.file_delivery.failed",
      );
      for (const f of opts.files) {
        if (delivered.some((d) => d.name === f.name)) continue;
        failures.push({
          name: f.name,
          kind: "file",
          reason: `the agent couldn't be handed it (${formatError(err)}). Try resending.`,
        });
      }
    }
    for (const f of failures) await opts.onWithheld?.(f);
    return { files: delivered, withheldNote: renderWithheldNote(failures) };
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
    return `No agent is connected to this channel yet. Run \`/${brandShort} bind\` to connect one of your agents, then @-mention it here.`;
  }

  function noDefaultAgentCopy(
    roster: RosterEntry[],
    ambiguousName: string | null,
  ): string {
    const names = roster.map((entry) => `\`${entry.name}\``).join(", ");
    return (
      (ambiguousName
        ? `More than one agent here is called \`${ambiguousName}\`, and this channel has no default agent to fall back to. `
        : "This channel has no default agent, so a mention with no name doesn't reach anyone. ") +
      `Start your mention with the agent you want: ${names}. ` +
      `An agent's owner can make it the default with \`/${brandShort} default <agent>\`.`
    );
  }

  type OwnedPending = PendingMessage & {
    channelId: string;
    threadTs: string;
    teamId: SlackWorkspace;
    reroute: () => Promise<void>;
    /* UNIT_BOUNDARY_DESCRIPTION: set when a final admission check drops this
     * message, so the steer's bookkeeping covers only what was admitted. */
    droppedByRelease?: boolean;
  };

  const ownedQueues = new Map<string, ConversationQueue<OwnedPending>>();

  function ownedQueueKey(instanceName: string, sessionId: string): string {
    return `${instanceName}|${sessionId}`;
  }

  function ownedRefOf(msg: OwnedPending, sessionId: string): TurnRef {
    return {
      channel: msg.channelId,
      threadTs: msg.threadTs,
      eventTs: msg.eventTs,
      teamId: msg.teamId,
      sessionId,
      text: msg.text,
      slackUserId: msg.slackUserId,
      hasThread: true,
      hadAttachments: msg.images.length > 0 || msg.files.length > 0,
    };
  }

  async function ownedBatches(
    gw: SlackGateway,
    instanceName: string,
    queued: OwnedPending[],
  ): Promise<OwnedThreadBatch[]> {
    const byThread = new Map<string, OwnedPending[]>();
    for (const msg of queued) {
      const key = `${msg.channelId} ${msg.threadTs}`;
      byThread.set(key, [...(byThread.get(key) ?? []), msg]);
    }
    return Promise.all(
      [...byThread.values()].map(async (messages) => {
        const first = messages[0]!;
        const owned = await ownedThreads
          .find(first.channelId, first.threadTs)
          .catch(() => null);
        return {
          channel: first.channelId,
          threadTs: first.threadTs,
          firstLine: owned?.firstLine ?? "",
          messages: messages.map((m) => ({
            ts: m.eventTs,
            speaker: m.speaker,
            text: m.text,
          })),
          missed: owned
            ? await missedInOwnedThread(gw, instanceName, owned, messages)
            : [],
        };
      }),
    );
  }

  async function missedInOwnedThread(
    gw: SlackGateway,
    instanceName: string,
    owned: SlackOwnedThread,
    carried: OwnedPending[],
  ): Promise<string[]> {
    const oldest = carried.reduce(
      (min, m) => (isAfterTs(min, m.eventTs) ? m.eventTs : min),
      carried[0]!.eventTs,
    );
    try {
      const read = await gw.getThreadReplies({
        channel: owned.channelId,
        threadTs: owned.threadTs,
        teamId: owned.teamId,
        limit: THREAD_LOOKBACK,
        oldest: owned.deliveredUpTo,
      });
      const carriedTs = new Set(carried.map((m) => m.eventTs));
      const entries = read.messages
        .filter(
          (message) =>
            message.ts !== undefined &&
            message.ts !== owned.threadTs &&
            !carriedTs.has(message.ts) &&
            isAfterTs(message.ts, owned.deliveredUpTo) &&
            isAfterTs(oldest, message.ts),
        )
        .map((message) => ({ message, footer: parseAgentFooter(message) }))
        .filter((e) => e.footer?.agentId !== instanceName);
      if (entries.length === 0) return [];
      const names = await resolveAuthorNames(entries, resolveAgentName);
      return labelMessages(
        entries,
        names,
        instanceName,
        {
          userId: await gw.getBotUserId(owned.teamId).catch(() => null),
          label: botHistoryLabel(brand),
        },
        { showThreadMarkers: false },
      );
    } catch (err) {
      getLogger().warn(
        {
          agentId: instanceName,
          channelId: owned.channelId,
          threadTs: owned.threadTs,
          error: formatError(err),
        },
        "slack.owned_thread.catchup_failed",
      );
      return [];
    }
  }

  async function markOwnedDelivered(
    batch: Array<Pick<OwnedPending, "channelId" | "threadTs" | "eventTs">>,
  ): Promise<void> {
    const newest = new Map<string, (typeof batch)[number]>();
    for (const msg of batch) {
      const key = `${msg.channelId} ${msg.threadTs}`;
      const seen = newest.get(key);
      if (!seen || isAfterTs(msg.eventTs, seen.eventTs)) newest.set(key, msg);
    }
    for (const msg of newest.values()) {
      await ownedThreads
        .markDelivered(msg.channelId, msg.threadTs, msg.eventTs)
        .catch((err) =>
          getLogger().warn(
            {
              channelId: msg.channelId,
              threadTs: msg.threadTs,
              error: formatError(err),
            },
            "slack.owned_thread.boundary_unsaved",
          ),
        );
    }
  }

  async function ownedTurnPrompt(
    gw: SlackGateway,
    instanceName: string,
    batch: OwnedPending[],
  ): Promise<string | ContentBlock[]> {
    const batches = await ownedBatches(gw, instanceName, batch);
    const owner = await resolveChannelOwner(instanceName, batch[0]!.teamId);
    const files = await deliverTurnFiles({
      agentId: instanceName,
      conversation: slackThreadKey(batch[0]!.channelId, batch[0]!.threadTs),
      files: batch.flatMap((m) => m.files),
    });
    return framePrompt({
      contract: ownedThreadGuidance({
        owner,
        brandName: brand.name,
        steered: false,
        several: batches.length > 1,
      }),
      text: ownedThreadMessages(batches) + files.withheldNote,
      images: batch.flatMap((m) => m.images),
      files: files.files,
    });
  }

  async function ownedSteerText(
    gw: SlackGateway,
    instanceName: string,
    batch: OwnedPending[],
  ): Promise<string> {
    const batches = await ownedBatches(gw, instanceName, batch);
    return [
      ownedThreadGuidance({
        owner: await resolveChannelOwner(instanceName, batch[0]!.teamId),
        brandName: brand.name,
        steered: true,
        several: batches.length > 1,
      }),
      ownedThreadMessages(batches),
    ].join("\n\n");
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: the session that owned the thread is gone, so
   * the thread has no owner any more and the message takes the road it would
   * have taken had nobody owned the thread.
   */
  async function releaseOwnedThread(
    instanceName: string,
    sessionId: string,
    batch: OwnedPending[],
  ): Promise<void> {
    getLogger().info(
      { agentId: instanceName, sessionId },
      "slack.owned_thread.session_gone: the session that started the thread no longer exists; its threads are released",
    );
    await ownedThreads.forgetSession(instanceName, sessionId).catch(() => {});
    for (const msg of batch) {
      msg.release();
      await msg.reroute();
    }
  }

  function createOwnedQueue(
    key: string,
    instanceName: string,
    sessionId: string,
  ): ConversationQueue<OwnedPending> {
    const steeredRefs: TurnRef[] = [];
    return createConversationQueue<OwnedPending>({
      settleMs,
      canSteer: (msg) => !carriesAttachments(msg),
      runTurn: async (queued, onSession, steersSettled) => {
        const gw = gateway;
        if (!gw) return;
        /* UNIT_BOUNDARY_DESCRIPTION: one queue per Session mixes the Session's
         * threads, so each message is judged by its own destination — a revoked
         * DM's message is dropped without dropping an unrelated thread's. */
        const batch: OwnedPending[] = [];
        for (const message of queued) {
          if (
            isDirectMessageId(message.channelId) &&
            (await bridgeClosed(
              instanceName,
              message.teamId,
              message.channelId,
            ))
          ) {
            message.release();
            continue;
          }
          batch.push(message);
        }
        const first = batch[0];
        if (!first) return;
        const owner = await getInstanceOwner(instanceName);
        if (!owner || !(await isTermsAccepted(owner))) return;
        const held = await spendHold?.(instanceName, {
          kind: "ambient",
          channel: "slack",
        });
        if (held) {
          getLogger().info(
            { agentId: instanceName, sessionId, reason: held },
            "slack.owned_thread.skipped_spend",
          );
          return;
        }
        const refs = batch.map((m) => ownedRefOf(m, sessionId));
        for (const ref of refs) beginTurn(instanceName, ref);
        let outcome: TurnOutcome = "failure";
        let failureReason: string | undefined;
        let gone = false;
        try {
          await runWhileAgentStarts(async () => {
            await agents().ensureReady(instanceName);
            const acp = makeAcpClient(instanceName);
            const sessions = await acp.listSessions();
            if (!sessions.some((s) => s.sessionId === sessionId)) {
              gone = true;
              return;
            }
            /* UNIT_BOUNDARY_DESCRIPTION: the DM may have been revoked while the
             * machinery woke or waited, so every message is judged again here
             * by its own destination — the unrelated threads of this batch
             * still run. */
            const admitted = await admittedOwned(instanceName, batch);
            for (const message of batch)
              if (!admitted.includes(message)) message.release();
            if (admitted.length === 0) return;
            const prompt = await ownedTurnPrompt(gw, instanceName, admitted);
            await acp.sendPrompt(prompt, {
              resumeSessionId: sessionId,
              surface: MESSAGE_SURFACE,
              onSession,
            });
          }, wakeWait);
          if (gone) {
            outcome = "success";
            await releaseOwnedThread(instanceName, sessionId, batch);
            return;
          }
          outcome = "success";
          await steersSettled();
          await markOwnedDelivered([
            ...batch,
            ...steeredRefs.map((ref) => ({
              channelId: ref.channel,
              threadTs: ref.threadTs,
              eventTs: ref.eventTs,
            })),
          ]);
        } catch (err) {
          failureReason = classifyTurnFailure(err).reason;
          getLogger().warn(
            {
              agentId: instanceName,
              sessionId,
              reason: failureReason,
              error: formatError(err),
            },
            "slack.owned_thread.turn_failed",
          );
        } finally {
          await steersSettled();
          for (const ref of refs) endTurn(instanceName, ref);
          emit({
            type: EventType.ChannelTurnRelayed,
            channel: "slack",
            agentId: instanceName,
            actorSub: null,
            externalActorId: batch.at(-1)!.slackUserId,
            outcome,
            ...(failureReason !== undefined ? { reason: failureReason } : {}),
            ambient: true,
          });
        }
      },
      steer: async (target, batch, request) => {
        const gw = gateway;
        if (!gw) return "refused";
        const admitted = await admittedOwned(instanceName, batch);
        if (admitted.length === 0) return "refused";
        return steerChannelTurn(
          makeAcpClient(instanceName),
          target,
          await ownedSteerText(gw, instanceName, admitted),
          request,
          {
            surface: "slack",
            fields: { agentId: instanceName, sessionId },
          },
        );
      },
      onSteered: (batch) => {
        for (const msg of batch) {
          if (msg.droppedByRelease) {
            msg.release();
            continue;
          }
          const ref = { ...ownedRefOf(msg, sessionId), steered: true };
          beginTurn(instanceName, ref);
          steeredRefs.push(ref);
          msg.release();
        }
      },
      onTurnSettled: (batch) => {
        for (const ref of steeredRefs) endTurn(instanceName, ref);
        steeredRefs.length = 0;
        for (const msg of batch) msg.release();
      },
      onEmpty: () => {
        ownedQueues.delete(key);
      },
      onError: (err) => {
        getLogger().warn(
          { agentId: instanceName, sessionId, error: formatError(err) },
          "slack.owned_thread.drain_failed",
        );
      },
    });
  }

  type OwnedRouting =
    { owner: null } | { owner: string; dropped: boolean; rateChecked: boolean };

  /**
   * UNIT_BOUNDARY_DESCRIPTION: keep only the owned messages whose own
   * destination still admits the Agent. It is the last thing that happens
   * before a prompt or a steer, so a batch admitted before a revoke cannot
   * carry a released DM's content into a running or new turn, and its unrelated
   * threads are kept rather than dropped with it.
   */
  async function admittedOwned(
    instanceName: string,
    messages: OwnedPending[],
  ): Promise<OwnedPending[]> {
    const kept: OwnedPending[] = [];
    for (const message of messages) {
      if (
        isDirectMessageId(message.channelId) &&
        (await bridgeClosed(instanceName, message.teamId, message.channelId))
      ) {
        message.droppedByRelease = true;
        continue;
      }
      kept.push(message);
    }
    return kept;
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: a message in a thread one of an Agent's
   * Sessions started goes to that Session, whoever wrote it and whether or
   * not it tags the Agent, and the owning Agent takes it no other way. Another
   * Agent tagged in the thread still gets it as usual, which is how one Agent
   * asks another. The owning Agent's own posts never come back to it, and bot
   * posts pass the rate limit once, here, so two Agents cannot wake each other
   * in a loop there. Every message waits in one queue per Session, so two
   * owned threads never send two prompts into one Session at once.
   */
  async function routeOwnedThreadMessage(
    event: SlackMentionEvent,
    reroute: () => Promise<void>,
  ): Promise<OwnedRouting> {
    if (!event.threadTs || !gateway) return { owner: null };
    let owned: SlackOwnedThread | null;
    try {
      owned = await ownedThreads.find(event.channel, event.threadTs);
    } catch (err) {
      getLogger().warn(
        { channelId: event.channel, error: formatError(err) },
        "slack.owned_thread.unread",
      );
      return { owner: null };
    }
    if (!owned) return { owner: null };
    const connected = await channelRegistry
      .resolveSlackChannelsByInstance(owned.agentId)
      .catch(() => []);
    if (connected.length === 0) return { owner: null };
    if (await bridgeClosed(owned.agentId, owned.teamId, event.channel))
      return { owner: owned.agentId, dropped: true, rateChecked: false };
    const sender = event.sender;
    const { agentId, sessionId } = owned;
    if (await isIgnoredApp(sender, event.channel))
      return { owner: agentId, dropped: true, rateChecked: false };
    if (!senderReaches(sender, { instanceName: agentId }))
      return { owner: agentId, dropped: false, rateChecked: false };
    if (!(await admitBotPost(sender, event)))
      return { owner: agentId, dropped: true, rateChecked: true };
    const slackUserId = sender.kind === "person" ? sender.user : "";
    const fetched = await fetchSlackAttachments(
      gateway,
      event.files,
      slackUserId,
      heldBudget,
      event.teamId,
    );
    securityLog("info", "channel.authz", {
      category: "channel",
      actor: null,
      actorKind: "external",
      surface: "slack",
      agentId,
      decision: "allow",
      detail: {
        basis: "place",
        trigger: "owned-thread",
        slackUserId,
        ...senderDetail(sender),
        channelId: event.channel,
      },
    });
    const key = ownedQueueKey(agentId, sessionId);
    void getOrCreateQueue(ownedQueues, key, () =>
      createOwnedQueue(key, agentId, sessionId),
    ).submit({
      text: event.text + renderWithheldNote(fetched.failures),
      eventTs: event.ts,
      slackUserId,
      sender,
      speaker: await speakerOf(sender),
      images: fetched.images,
      files: fetched.files,
      release: fetched.release,
      channelId: event.channel,
      threadTs: event.threadTs,
      /* UNIT_BOUNDARY_DESCRIPTION: the workspace the thread was recorded in,
       * not the one the event happens to be tagged with — a Grid reply can
       * carry the person's home workspace, and every later admission and TurnRef
       * must use the workspace the authorization was made in. */
      teamId: owned.teamId,
      reroute,
    });
    return { owner: agentId, dropped: false, rateChecked: true };
  }

  async function runMentionCommand(
    event: SlackMentionEvent,
    user: string,
  ): Promise<boolean> {
    if (!mentionCommandVerb(event.text)) return false;
    const parsed = await parseMentionCommand(
      event.text,
      await resolveRoster(event.channel),
      async () =>
        (await ignoredApps.list(event.channel)).map(
          (app) => app.name || app.botId,
        ),
    );
    if (!parsed) return false;
    const say = (text: string) =>
      ephemeral(event.channel, user, event.threadTs, text, event.teamId);
    getLogger().info(
      {
        channelId: event.channel,
        command:
          parsed.kind === "run" ? parsed.text.split(" ")[0] : parsed.verb,
      },
      "slack.mention.command",
    );
    if (parsed.kind === "slash-only") {
      await say(
        `Run \`/${brandShort} delete <message link> [reason]\` to delete an agent post. Its confirmation opens only from the slash command.`,
      );
      return true;
    }
    await handleCommand(
      {
        text: parsed.text,
        userId: user,
        channelId: event.channel,
        teamId: event.teamId,
        triggerId: "",
      },
      async (response) => {
        if (response) await say(response.text);
      },
      say,
    );
    return true;
  }

  /**
   * UNIT_BOUNDARY_DESCRIPTION: An in-chat unbind of a DM the Bridge paired. The
   * record decides the target and the authorization, so the command works after
   * the earlier attempt already removed the binding, and the DM is closed
   * before anything is deleted: an outcome that could not close it says so
   * instead of claiming closure. It answers `null` when no record matches, so
   * the ordinary unbind can release a conversation the Bridge never paired.
   */
  async function releaseBridgedDm(
    command: SlackSlashCommand,
    ack: SlackAck,
    pending: {
      agentId: string;
      ownerSub: string;
      state: "active" | "revoking";
    }[],
    rest: string,
  ): Promise<string | null> {
    const named = rest.trim();
    let target = named
      ? pending.find((record) => record.agentId === named)
      : pending.length === 1
        ? pending[0]
        : undefined;
    let label = target
      ? `\`${(await resolveAgentDisplayName(target.agentId)) ?? target.agentId}\``
      : null;
    if (!target && named) {
      const roster = await resolveRoster(command.channelId);
      const matches = matchRosterName(roster, named).matches;
      const entry = matches.length === 1 ? matches[0] : null;
      if (entry) {
        target = pending.find(
          (record) => record.agentId === entry.instanceName,
        );
        if (target) label = `\`${entry.name}\``;
      }
    }
    if (!target) {
      if (pending.length > 1)
        return (
          `This DM has more than one agent the DM Bridge paired (${pending
            .map((record) => record.agentId)
            .join(", ")}). ` +
          `Run \`/${brandShort} unbind <agent>\` to say which one.`
        );
      return null;
    }
    const record = target;
    const invoker = await authorizeActor(command, ack, {
      agentId: record.agentId,
      subcommand: "unbind",
      allowed: async (who) =>
        who === record.ownerSub ||
        who === (await getInstanceOwner(record.agentId)),
      denyReason: "not-binder-or-owner",
      denyCopy:
        "Only the person who paired this DM, or the agent's owner, can disconnect it.",
    });
    if (!invoker) return "";

    let outcome: SlackDmReleaseOutcome;
    try {
      outcome =
        (await dmBridges?.releaseInChat({
          agentId: record.agentId,
          teamId: command.teamId,
          slackChannelId: command.channelId,
        })) ?? "none";
    } catch (err) {
      getLogger().warn(
        { error: formatError(err), agentId: record.agentId },
        "slack.unbind.bridge_release_failed",
      );
      outcome = "failed";
    }
    if (outcome === "none") return null;
    const who = label ?? "The agent";
    if (outcome === "failed")
      return `Could not close ${who} here, so nothing was changed. Try again in a moment.`;
    if (outcome === "superseded")
      return `${who} was connected again while it was being released, so it stays connected.`;

    /* UNIT_BOUNDARY_DESCRIPTION: the binding is gone from the worker's point of
     * view whether or not the cleanup finished — a half-done revoke deleted it
     * first — so the registration goes and the DM stays closed until a connect
     * reopens it. */
    securityLog("info", "channel.dm_bridge_released", {
      category: "authz-list",
      actor: invoker,
      actorKind: "user",
      surface: "slack",
      agentId: record.agentId,
      result: "success",
      detail: {
        slackUserId: command.userId,
        channelId: command.channelId,
        state: outcome,
      },
    });
    emit({
      type: EventType.SlackDisconnected,
      agentId: record.agentId,
      slackChannelId: command.channelId,
      ownerSub: record.ownerSub,
    });
    return `${who} disconnected. The owner can pair it again from the platform when they want it back.`;
  }

  async function handleInbound(
    signedEvent: SlackMentionEvent,
    opts: { directMessage: boolean },
    rerouted = false,
  ) {
    if (!gateway) return;

    const event = await withoutAgentSignature(gateway, signedEvent);
    const sender = event.sender;
    if (opts.directMessage && sender.kind !== "person") return;
    if (
      !opts.directMessage &&
      sender.kind === "person" &&
      (await runMentionCommand(event, sender.user))
    )
      return;
    if (
      !rerouted &&
      sender.kind !== "person" &&
      !firstBotMentionSighting(event.channel, event.ts)
    )
      return;
    const owned = rerouted
      ? { owner: null }
      : await routeOwnedThreadMessage(event, () =>
          handleInbound(signedEvent, opts, true),
        );
    if (owned.owner !== null && owned.dropped) return;
    if (await isIgnoredApp(sender, event.channel)) return;
    const slackUserId = sender.kind === "person" ? sender.user : "";

    const threadTs = event.threadTs ?? event.ts;
    if (opts.directMessage && event.threadTs) {
      let whisper: WhisperSession | null;
      try {
        whisper = await resolveWhisperSession(
          gateway,
          event.channel,
          event.threadTs,
          event.teamId,
        );
      } catch (err) {
        getLogger().warn(
          { channelId: event.channel, error: formatError(err) },
          "slack.whisper.root_unread",
        );
        await ephemeral(
          event.channel,
          slackUserId,
          event.threadTs,
          "Couldn't read this thread from Slack, so your message wasn't passed on. Send it again in a moment.",
          event.teamId,
        );
        return;
      }
      if (whisper) {
        await relayWhisperThread(event, whisper, slackUserId);
        return;
      }
    }
    const roster = await resolveRoster(event.channel);
    const routed = routeMention(event.text, roster);
    if (
      owned.owner !== null &&
      (!routed?.target || routed.target.instanceName === owned.owner)
    )
      return;
    if (!routed) {
      await gateway.postEphemeral({
        channel: event.channel,
        user: slackUserId,
        teamId: event.teamId,
        text: unboundConversationCopy(event, opts.directMessage),
      });
      return;
    }
    if (!routed.target) {
      await gateway.postEphemeral({
        channel: event.channel,
        user: slackUserId,
        teamId: event.teamId,
        text: noDefaultAgentCopy(roster, routed.ambiguousName),
      });
      return;
    }
    const binding = routed.target;
    if (!senderReaches(sender, binding)) return;
    const closed = await bridgeClosed(
      binding.instanceName,
      event.teamId,
      event.channel,
    );
    if (closed) {
      await gateway.postEphemeral({
        channel: event.channel,
        user: slackUserId,
        teamId: event.teamId,
        text: closed.error,
      });
      return;
    }
    const rateChecked = rerouted || (owned.owner !== null && owned.rateChecked);
    if (!rateChecked && !(await admitBotPost(sender, event))) return;

    const fetched = await fetchTurnAttachments(event, slackUserId);
    if (fetched === null) return;

    const inThread = !!event.threadTs;

    await enqueueAddressed(
      {
        channelId: event.channel,
        teamId: binding.teamId,
        threadTs,
        oneThread: inThread || !opts.directMessage,
        instanceName: binding.instanceName,
        speakerLabel: !opts.directMessage,
        directMessage: opts.directMessage,
      },
      slackUserId,
      {
        text: event.text + fetched.withheldNote,
        eventTs: event.ts,
        slackUserId,
        sender,
        speaker: await speakerOf(sender),
        inThread,
        images: fetched.images,
        files: fetched.files,
        release: fetched.release,
        turn: {
          owner: binding.owner,
          teamId: binding.teamId,
          ambient: binding.ambient,
          roster,
          ambiguousName: routed.ambiguousName,
        },
      },
    );
  }

  type AddressedConversation = {
    channelId: string;
    teamId: SlackWorkspace;
    threadTs: string;
    oneThread: boolean;
    instanceName: string;
    speakerLabel: boolean;
    directMessage: boolean;
    whisper?: SlackTurnWhisper;
  };

  type AddressedTurnContext = {
    owner: string;
    teamId: SlackWorkspace;
    ambient: boolean;
    roster?: RosterEntry[];
    ambiguousName?: string | null;
  };

  type AddressedPending = PendingMessage & {
    inThread: boolean;
    turn: AddressedTurnContext;
  };

  const addressedQueues = new Map<
    string,
    ConversationQueue<AddressedPending>
  >();

  function addressedQueueKey(
    conversation: AddressedConversation,
    slackUserId: string,
  ): string {
    const where = conversation.oneThread
      ? `thread:${conversation.threadTs}`
      : `dm:${slackUserId}`;
    return `${conversation.instanceName}|${conversation.channelId}|${where}`;
  }

  function carriesAttachments(msg: PendingMessage): boolean {
    return msg.images.length > 0 || msg.files.length > 0;
  }

  function steerFrame(
    conversation: AddressedConversation,
    batch: PendingMessage[],
  ): string {
    const one = batch.length === 1;
    const them = one ? "it" : "them";
    return [
      "<new-messages>",
      `${one ? "Another message" : `${batch.length} more messages`} arrived in this same Slack conversation while you were working.`,
      "If you have not posted a reply yet, answer everything in one reply.",
      conversation.oneThread
        ? `If you already posted a reply that does not cover ${them}, post one more reply that answers only ${them}, with the reply tool and threadTs="${conversation.threadTs}".`
        : `If you already posted a reply that does not cover ${them}, post one more reply that answers only ${them}, with the reply tool.`,
      `If ${one ? "it needs" : "they need"} no answer, call no_reply_needed for ${them}.`,
      ...(conversation.oneThread
        ? []
        : [
            "Several messages now share this turn, so pass the [ts …] tag of the message you are answering as threadTs — a reply naming none is refused.",
          ]),
      ...batch.map((m) => `[ts ${m.eventTs}] ${m.speaker}: ${m.text}`),
      "</new-messages>",
    ].join("\n");
  }

  function createAddressedQueue(
    key: string,
    conversation: AddressedConversation,
  ): ConversationQueue<AddressedPending> {
    const steeredRefs: TurnRef[] = [];
    const queue: ConversationQueue<AddressedPending> =
      createConversationQueue<AddressedPending>({
        settleMs,
        canSteer: (msg) => !carriesAttachments(msg),
        runTurn: async (queued, onSession, steersSettled) => {
          if (conversation.directMessage) {
            const closed = await bridgeClosed(
              conversation.instanceName,
              conversation.teamId,
              conversation.channelId,
            );
            if (closed) {
              for (const m of queued) m.release?.();
              return;
            }
          }
          const threadKey = slackThreadKey(
            conversation.channelId,
            conversation.threadTs,
          );
          const isCarriedByThread = (m: AddressedPending) =>
            !conversation.oneThread &&
            threadSupersede.isSuperseded(
              conversation.instanceName,
              conversation.channelId,
              m.eventTs,
            );
          noteCarriedByThread(
            conversation.instanceName,
            threadKey,
            queued.filter(isCarriedByThread).map((m) => m.eventTs),
          );
          const batch = queued.filter((m) => !isCarriedByThread(m));
          const latest = batch.at(-1);
          if (!latest) return;
          const { kept, dropped } = batchFiles(batch);
          const held = conversation.oneThread
            ? null
            : holdSupersedable(
                conversation.instanceName,
                conversation.channelId,
                threadKey,
                () => [
                  ...batch.map((m) => m.eventTs),
                  ...steeredRefs.map((ref) => ref.eventTs),
                  ...queue.heldSteer().map((m) => m.eventTs),
                ],
                (ts) => {
                  if (queue.heldSteer().some((m) => m.eventTs === ts))
                    queue.abortSteer();
                },
              );
          await relaySharedTurn({
            channel: conversation.channelId,
            teamId: conversation.teamId,
            threadTs: conversation.threadTs,
            messages: batch.map(
              ({ text, eventTs, slackUserId, speaker, sender, inThread }) => ({
                text,
                eventTs,
                slackUserId,
                speaker,
                sender,
                inThread,
              }),
            ),
            slackUserId: latest.slackUserId,
            instanceName: conversation.instanceName,
            owner: latest.turn.owner,
            ...(latest.turn.teamId ? { teamId: latest.turn.teamId } : {}),
            images: batch.flatMap((m) => m.images),
            files: kept,
            droppedFiles: dropped.map((f) => f.name),
            speakerLabel: conversation.speakerLabel,
            ambient: latest.turn.ambient,
            roster: latest.turn.roster,
            ambiguousName: latest.turn.ambiguousName,
            ...(conversation.whisper ? { whisper: conversation.whisper } : {}),
            siblingRefs: () => steeredRefs,
            onSession,
            steersSettled,
            ...(held ? { held } : {}),
          }).finally(() => held?.end());
          if (conversation.whisper)
            await noticeWhispersTurnedOff(conversation.instanceName, {
              channel: conversation.channelId,
              teamId: conversation.teamId,
              whisperer: conversation.whisper.whisperer,
              origin: conversation.whisper.origin,
              threadTs: conversation.threadTs,
            });
        },
        steer: async (sessionId, batch, request) => {
          const closed = await bridgeClosed(
            conversation.instanceName,
            conversation.teamId,
            conversation.channelId,
          );
          if (closed) return "refused" as const;
          return steerChannelTurn(
            makeAcpClient(conversation.instanceName),
            sessionId,
            steerFrame(conversation, batch),
            request,
            {
              surface: "slack",
              fields: {
                agentId: conversation.instanceName,
                channelId: conversation.channelId,
              },
            },
          );
        },
        onSteered: (batch) => {
          for (const msg of batch) {
            const ref: TurnRef = {
              channel: conversation.channelId,
              teamId: conversation.teamId,
              threadTs: msg.inThread ? conversation.threadTs : msg.eventTs,
              eventTs: msg.eventTs,
              text: msg.text,
              slackUserId: msg.slackUserId,
              hasThread: msg.inThread,
              hadAttachments: false,
              ...(conversation.whisper
                ? { whisper: conversation.whisper }
                : {}),
              steered: true,
              speaker: msg.speaker,
            };
            beginTurn(conversation.instanceName, ref);
            steeredRefs.push(ref);
            securityLog("info", "channel.authz", {
              category: "channel",
              actor: null,
              actorKind: "external",
              surface: "slack",
              agentId: conversation.instanceName,
              decision: "allow",
              detail: {
                basis: "place",
                trigger: "steer",
                slackUserId: msg.slackUserId,
                ...senderDetail(msg.sender),
                channelId:
                  conversation.whisper?.origin ?? conversation.channelId,
                ...(conversation.whisper
                  ? { whisperChannelId: conversation.channelId }
                  : {}),
              },
            });
            msg.release();
          }
        },
        onTurnSettled: (batch) => {
          for (const ref of steeredRefs) {
            endTurn(conversation.instanceName, ref);
          }
          steeredRefs.length = 0;
          for (const msg of batch) msg.release();
        },
        onEmpty: () => {
          addressedQueues.delete(key);
        },
        onError: (err) => {
          getLogger().warn(
            {
              channelId: conversation.channelId,
              error: formatError(err),
            },
            "slack.addressed_drain.failed",
          );
        },
      });
    return queue;
  }

  function enqueueAddressed(
    conversation: AddressedConversation,
    slackUserId: string,
    msg: AddressedPending,
  ): Promise<void> {
    const key = addressedQueueKey(conversation, slackUserId);
    return getOrCreateQueue(addressedQueues, key, () =>
      createAddressedQueue(key, conversation),
    ).submit(msg);
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
    messages: AddressedMessage[];
    slackUserId: string;
    instanceName: string;
    owner: string;
    teamId: SlackWorkspace;
    images: FetchedImage[];
    files: FetchedFile[];
    droppedFiles?: string[];
    speakerLabel?: boolean;
    ambient: boolean;
    roster?: RosterEntry[];
    ambiguousName?: string | null;
    forwardedFrom?: string;
    whisper?: SlackTurnWhisper;
    siblingRefs?: () => TurnRef[];
    onSession?: (sessionId: string, promptId?: string) => void;
    steersSettled?: () => Promise<void>;
    held?: SupersedableTurn;
  }) {
    if (!gateway) return;

    for (const message of args.messages) {
      securityLog("info", "channel.authz", {
        category: "channel",
        actor: null,
        actorKind: "external",
        surface: "slack",
        agentId: args.instanceName,
        decision: "allow",
        detail: {
          basis: "place",
          slackUserId: message.slackUserId,
          ...senderDetail(message.sender),
          channelId: args.whisper?.origin ?? args.channel,
          ...(args.forwardedFrom
            ? { trigger: "forward", forwardedFrom: args.forwardedFrom }
            : {}),
          ...(args.whisper
            ? {
                trigger: "whisper",
                ...(args.whisper.privateReply
                  ? {}
                  : { whisperChannelId: args.channel }),
              }
            : {}),
        },
      });
    }

    if (!(await isTermsAccepted(args.owner))) {
      await gateway.postEphemeral({
        channel: args.channel,
        user: args.slackUserId,
        teamId: args.teamId,
        text: `This agent can't reply yet — its owner must accept the Terms of Use at ${uiBaseUrl}.`,
      });
      return;
    }

    const held = await spendHold?.(args.instanceName, {
      kind: "mention",
      channel: "slack",
    });
    if (held) {
      const text = spendHoldUserCopy(
        held,
        `\`${await resolveAgentName(args.instanceName)}\``,
        brand.name,
        slackResetTime(new Date()),
      );
      if (args.slackUserId)
        await gateway.postEphemeral({
          channel: args.channel,
          user: args.slackUserId,
          teamId: args.teamId,
          text,
        });
      else
        await gateway.postMessage({
          channel: args.channel,
          teamId: args.teamId,
          threadTs: args.threadTs,
          text,
        });
      return;
    }

    await relayOwnerTurn({
      instanceName: args.instanceName,
      channel: args.channel,
      threadTs: args.threadTs,
      title: sessionTitleOf(args.messages[0]!.text),
      messages: args.messages.map((message) => ({
        ...message,
        text:
          args.speakerLabel === false
            ? message.text
            : `${message.speaker ?? `<@${message.slackUserId}>`}: ${message.text}`,
      })),
      actorSub: null,
      externalActorId: args.slackUserId,
      slackUserId: args.slackUserId,
      teamId: args.teamId,
      images: args.images,
      files: args.files,
      ...(args.droppedFiles ? { droppedFiles: args.droppedFiles } : {}),
      ambient: args.ambient,
      roster: args.roster,
      ambiguousName: args.ambiguousName,
      forwardedFrom: args.forwardedFrom,
      ...(args.whisper ? { whisper: args.whisper } : {}),
      ...(args.siblingRefs ? { siblingRefs: args.siblingRefs } : {}),
      ...(args.onSession ? { onSession: args.onSession } : {}),
      ...(args.steersSettled ? { steersSettled: args.steersSettled } : {}),
      ...(args.held ? { held: args.held } : {}),
    });
  }

  function relayAmbientTurn(args: Parameters<typeof runAmbientTurn>[0]) {
    return inBackgroundSpan(
      "channel.turn",
      { "platform.channel": "slack", "platform.channel.ambient": true },
      () => runAmbientTurn(args),
    );
  }

  async function runAmbientTurn(args: {
    instanceName: string;
    channel: string;
    teamId: SlackWorkspace;
    threadKey: string;
    legacyThreadKey?: string;
    replyThreadTs: string;
    eventTs: string;
    hasThread: boolean;
    title: string;
    messages: Array<{ text: string; eventTs: string; slackUserId?: string }>;
    images: FetchedImage[];
    files: FetchedFile[];
    droppedFiles: string[];
    externalActorId: string;
    roster?: RosterEntry[];
    readers?: RosterEntry[];
    answeredAlready?: AmbientPeerReply[];
    earlierTurn?: string;
    held?: SupersedableTurn;
  }): Promise<{
    posted: boolean;
    replyText: string | null;
    replies: string[];
  }> {
    if (!gateway) return { posted: false, replyText: null, replies: [] };
    const gw = gateway;

    const deliveredUpTo = args.messages.reduce(
      (newest, m) => laterTs(newest, m.eventTs),
      args.eventTs,
    );
    const neverSteered = (): string[] => [];
    const multi = args.messages.length > 1;
    const seenSessionIds = new Set<string>();
    const turnRefs: TurnRef[] = args.messages.map((m) => ({
      channel: args.channel,
      teamId: args.teamId,
      threadTs: args.hasThread ? args.replyThreadTs : m.eventTs,
      eventTs: m.eventTs,
      text: m.text,
      slackUserId: m.slackUserId ?? args.externalActorId,
      hasThread: args.hasThread,
      hadAttachments: args.images.length > 0 || args.files.length > 0,
      ambient: true,
    }));
    const droppedNote = renderWithheldNote(
      args.droppedFiles.map((name) => ({
        name,
        kind: "file" as const,
        reason:
          "too many attachments arrived at once for it to be included. " +
          "Send it again on its own.",
      })),
    );
    const text =
      (multi
        ? args.messages.map((m) => `[ts ${m.eventTs}] ${m.text}`).join("\n")
        : args.messages[0]!.text) + droppedNote;

    let outcome: TurnOutcome = "failure";
    let failureReason: string | undefined;
    let failureTemplateId: string | undefined;
    const [agentName, owner, turnContext, readsHistory] = await Promise.all([
      resolveAgentDisplayName(args.instanceName),
      resolveChannelOwner(args.instanceName, args.teamId),
      turnContractContext(gw, args.channel, args.eventTs, args.teamId, {
        batched: args.messages.length > 1,
      }),
      readsChannelHistoryIn(args.instanceName, args.channel, args.roster),
    ]);
    const { botUserId, ...contractContext } = turnContext;
    const contract = slackTurnContract({
      replyThreadTs: args.replyThreadTs,
      eventTs: args.eventTs,
      batch: {
        count: args.messages.length,
        inThread: args.hasThread,
        separateTargets: separateReplyTargets(turnRefs),
      },
      identity: { brand, botUserId, agentName },
      reach: {
        isDirectMessage: isDirectMessageId(args.channel),
        ambient: true,
        channelHistory: readsHistory ? { chatId: args.channel } : null,
      },
      roster: rosterCopy(args.roster, args.instanceName),
      owner,
      ...contractContext,
    });
    const guidance = [
      ambientGuidance(
        brand,
        agentName,
        rosterCopy(args.readers ?? args.roster, args.instanceName),
        args.answeredAlready ?? [],
        args.hasThread,
      ),
      ...(args.earlierTurn ? [args.earlierTurn] : []),
    ].join("\n\n");

    let delivery: Promise<TurnDelivery>;
    const deliverFiles = () =>
      (delivery ??= deliverTurnFiles({
        agentId: args.instanceName,
        conversation: args.threadKey,
        files: args.files,
      }));

    let ghostTurn = false;
    const runTurn = () =>
      runSessionTurn({
        instanceName: args.instanceName,
        threadKey: args.threadKey,
        channelId: args.channel,
        teamId: args.teamId,
        title: args.title,
        ...(args.legacyThreadKey
          ? { legacyThreadKey: args.legacyThreadKey }
          : {}),
        buildResumePrompt: async () => {
          const delivered = await deliverFiles();
          const caught = await buildCatchUp(gw, {
            instanceName: args.instanceName,
            channel: args.channel,
            teamId: args.teamId,
            threadTs: args.replyThreadTs,
            eventTs: args.eventTs,
            hasThread: args.hasThread,
            threadKey: args.threadKey,
            deliveredUpTo,
            steeredTs: neverSteered,
            batchTs: args.messages.map((m) => m.eventTs),
          });
          return {
            prompt: framePrompt({
              contract,
              guidance,
              ...caught.frame,
              text: text + delivered.withheldNote,
              images: args.images,
              files: delivered.files,
            }),
            commit: caught.commit,
          };
        },
        buildFreshPrompt: async () =>
          buildThreadPrompt(
            gw,
            {
              instanceName: args.instanceName,
              channel: args.channel,
              threadTs: args.replyThreadTs,
              eventTs: args.eventTs,
              text,
              teamId: args.teamId,
              hasThread: args.hasThread,
              threadKey: args.threadKey,
              batchTs: args.messages.map((m) => m.eventTs),
              deliveredUpTo,
              steeredTs: neverSteered,
              images: args.images,
            },
            contract,
            { guidance, deliver: deliverFiles },
          ),
        onSession: (sessionId) => {
          seenSessionIds.add(sessionId);
          for (const ref of turnRefs) ref.sessionId = sessionId;
        },
        onGhostTurn: () => {
          ghostTurn = true;
        },
        ...(args.held
          ? {
              signal: args.held.signal,
              onUpdate: (update: PromptUpdate) => {
                if (update.kind === "tool")
                  args.held?.turn.noteTool(update.title);
              },
            }
          : {}),
      });
    const superseded = () => args.held?.signal.aborted === true;

    try {
      for (const ref of turnRefs) {
        beginTurn(args.instanceName, ref);
      }
      await runWhileAgentStarts(runTurn, wakeWait);
      outcome = "success";
    } catch (err) {
      if (superseded()) {
        outcome = "success";
        noteCarriedByThread(
          args.instanceName,
          args.threadKey,
          args.messages.map((m) => m.eventTs),
        );
        getLogger().info(
          { agentId: args.instanceName, error: formatError(err) },
          "slack.ambient_turn.superseded",
        );
        return { posted: false, replyText: null, replies: [] };
      }
      const failure = classifyTurnFailure(err);
      failureReason = failure.reason;
      getLogger().warn(
        {
          agentId: args.instanceName,
          reason: failureReason,
          error: formatError(err),
        },
        "slack.ambient_turn.failed",
      );
      if (failure.kind === "provider-unavailable")
        failureTemplateId =
          (
            await lookUpProviderOutage(providerOutage, args.instanceName, {
              type: "slack",
              id: args.channel,
            })
          )?.templateId ?? undefined;
    } finally {
      for (const ref of turnRefs) {
        endTurn(args.instanceName, ref, {
          harnessMayStillRun: mayLeaveHarnessRunning(ghostTurn, failureReason),
        });
      }
      if (outcome === "success") {
        for (const sid of seenSessionIds)
          turnRecovery.dismiss(args.instanceName, sid);
      }
      args.held?.turn.noteReplies(
        turnRefs.flatMap((ref) => ref.replyTexts ?? []),
      );
      annotateSpan({
        "platform.channel.outcome": outcome,
        ...(failureReason !== undefined && {
          "platform.channel.failure_reason": failureReason,
        }),
      });
      emit({
        type: EventType.ChannelTurnRelayed,
        channel: "slack",
        agentId: args.instanceName,
        actorSub: null,
        externalActorId: args.externalActorId,
        outcome,
        ...(failureReason !== undefined
          ? { reason: failureReason }
          : superseded()
            ? { reason: "superseded" }
            : {}),
        ...(failureTemplateId !== undefined
          ? { templateId: failureTemplateId }
          : {}),
        ambient: true,
      });
    }
    const spoken = turnRefs
      .map((ref) => ref.replyText)
      .filter((said): said is string => said !== undefined)
      .join("\n");
    return {
      posted: turnRefs.some((ref) => ref.messaged === true),
      replyText: spoken === "" ? null : spoken,
      replies: turnRefs.flatMap((ref) => ref.replyTexts ?? []),
    };
  }

  type PendingMessage = {
    text: string;
    eventTs: string;
    slackUserId: string;
    sender: SlackSender;
    speaker: string;
    images: FetchedImage[];
    files: FetchedFile[];
    release: () => void;
    ownedBy?: string;
  };

  function batchFiles(batch: PendingMessage[]): {
    kept: FetchedFile[];
    dropped: FetchedFile[];
  } {
    const kept: FetchedFile[] = [];
    const dropped: FetchedFile[] = [];
    let bytes = 0;
    for (const f of batch.flatMap((m) => m.files)) {
      if (bytes + f.bytes.length > TOTAL_FILE_BYTES_CAP) {
        getLogger().warn(
          { file: f.name, bytes: f.bytes.length },
          "slack.file.over_batch_cap",
        );
        dropped.push(f);
        continue;
      }
      bytes += f.bytes.length;
      kept.push(f);
    }
    return { kept, dropped };
  }

  const HELD_BYTES_CAP = stagedFootprint(3 * TOTAL_FILE_BYTES_CAP);

  const heldBudget = createAttachmentBudget(HELD_BYTES_CAP);

  const ambientQueues = new Map<string, ConversationQueue<PendingMessage>>();

  function ambientQueueKey(channelId: string, threadTs: string | null): string {
    return threadTs === null
      ? `top:${channelId}`
      : `thread:${channelId}:${threadTs}`;
  }

  function createAmbientQueue(
    key: string,
    channelId: string,
    threadTs: string | null,
  ): ConversationQueue<PendingMessage> {
    return createConversationQueue<PendingMessage>({
      settleMs,
      runTurn: async (batch) => {
        if (batch.length === 0) return;
        const roster = await resolveRoster(channelId);
        const readers: RosterEntry[] = [];
        for (const entry of roster) {
          if (!entry.ambient) continue;
          if (!(await isTermsAccepted(entry.owner))) {
            getLogger().debug(
              { agentId: entry.instanceName, channelId },
              "slack.ambient_turn.skipped_terms",
            );
            continue;
          }
          const held = await spendHold?.(entry.instanceName, {
            kind: "ambient",
            channel: "slack",
          });
          if (held) {
            getLogger().debug(
              { agentId: entry.instanceName, channelId, reason: held },
              "slack.ambient_turn.skipped_spend",
            );
            continue;
          }
          readers.push(entry);
        }
        if (readers.length === 0) return;

        const inThread = threadTs !== null;
        const answeredAlready: AmbientPeerReply[] = [];
        const tagged = new Set<string>();
        let botUserId: string | null | undefined;
        for (const reader of orderAmbientReaders(readers)) {
          if (tagged.has(reader.instanceName)) {
            getLogger().debug(
              { agentId: reader.instanceName, channelId },
              "slack.ambient_turn.skipped_tagged",
            );
            continue;
          }
          const reached = batch.filter(
            (m) =>
              senderReaches(m.sender, reader) &&
              m.ownedBy !== reader.instanceName,
          );
          const isCarriedByThread = (m: PendingMessage) =>
            !inThread &&
            threadSupersede.isSuperseded(
              reader.instanceName,
              channelId,
              m.eventTs,
            );
          noteCarriedByThread(
            reader.instanceName,
            ambientThreadKey(channelId),
            reached.filter(isCarriedByThread).map((m) => m.eventTs),
          );
          const shown = reached.filter((m) => !isCarriedByThread(m));
          const last = shown.at(-1);
          if (!last) continue;
          const earlierTurn = inThread
            ? await waitForSupersededTurns(
                reader.instanceName,
                channelId,
                threadTs,
              )
            : "";
          const { kept, dropped } = batchFiles(shown);
          securityLog("info", "channel.authz", {
            category: "channel",
            actor: null,
            actorKind: "external",
            surface: "slack",
            agentId: reader.instanceName,
            decision: "allow",
            detail: {
              basis: "place",
              trigger: "ambient",
              slackUserId: last.slackUserId,
              ...senderDetail(last.sender),
              channelId,
            },
          });
          const held = inThread
            ? null
            : holdSupersedable(
                reader.instanceName,
                channelId,
                ambientThreadKey(channelId),
                () => shown.map((m) => m.eventTs),
              );
          const { posted, replyText, replies } = await relayAmbientTurn({
            ...(earlierTurn ? { earlierTurn } : {}),
            ...(held ? { held } : {}),
            teamId: reader.teamId,
            roster,
            readers,
            answeredAlready: [...answeredAlready],
            instanceName: reader.instanceName,
            channel: channelId,
            threadKey: inThread
              ? slackThreadKey(channelId, threadTs)
              : ambientThreadKey(channelId),
            ...(inThread ? { legacyThreadKey: threadTs } : {}),
            replyThreadTs: inThread ? threadTs : last.eventTs,
            eventTs: last.eventTs,
            hasThread: inThread,
            title: sessionTitleOf(shown[0]!.text),
            messages: shown.map(({ text, speaker, eventTs, slackUserId }) => ({
              text: `${speaker}: ${text}`,
              eventTs,
              slackUserId,
            })),
            images: shown.flatMap((m) => m.images),
            files: kept,
            droppedFiles: dropped.map((f) => f.name),
            externalActorId: last.slackUserId,
          }).finally(() => held?.end());
          if (posted)
            answeredAlready.push({ name: reader.name, text: replyText });
          botUserId ??= await gateway
            ?.getBotUserId(reader.teamId)
            .catch(() => null);
          for (const said of replies) {
            const peer = peerTaggedBy(
              said,
              reader.instanceName,
              roster,
              botUserId ?? null,
            );
            if (peer) tagged.add(peer.instanceName);
          }
        }
      },
      steer: async () => "refused",
      onTurnSettled: (batch) => {
        for (const msg of batch) msg.release();
      },
      onEmpty: () => {
        ambientQueues.delete(key);
      },
      onError: (err) => {
        getLogger().warn(
          { channelId, error: formatError(err) },
          "slack.ambient_drain.failed",
        );
      },
    });
  }

  function enqueueAmbient(
    channelId: string,
    threadTs: string | null,
    msg: PendingMessage,
  ) {
    const key = ambientQueueKey(channelId, threadTs);
    void getOrCreateQueue(ambientQueues, key, () =>
      createAmbientQueue(key, channelId, threadTs),
    ).submit(msg);
  }

  async function noticeUntaggedReply(
    event: SlackChannelMessageEvent,
    user: string,
    threadTs: string,
    bindings: SlackBindingInfo[],
  ): Promise<void> {
    const inThread = bindings.find((binding) =>
      isAgentThread(binding.instanceName, event.channel, threadTs),
    );
    if (!inThread) return;
    const shownKey = `${event.channel} ${threadTs} ${user}`;
    if (isLive(untaggedNoticesShown, shownKey)) return;
    noteExpiring(untaggedNoticesShown, shownKey);
    const name = await resolveAgentName(inThread.instanceName);
    const botUserId = await gateway
      ?.getBotUserId(event.teamId)
      .catch(() => null);
    const tag = botUserId ? `<@${botUserId}>` : `@${brand.name}`;
    const named =
      bindings.length > 1 && !inThread.isDefault ? " followed by its name" : "";
    await ephemeral(
      event.channel,
      user,
      threadTs,
      `${name} won't see this reply unless you tag ${tag}${named}. Only you can see this note, and it won't show again in this thread.`,
      event.teamId,
    );
  }

  async function handleChannelMessage(
    signedEvent: SlackChannelMessageEvent,
    rerouted = false,
  ) {
    if (!gateway) return;
    const event = await withoutAgentSignature(gateway, signedEvent);
    const sender = event.sender;
    const slackUserId = sender.kind === "person" ? sender.user : "";

    if (sender.kind === "agent" && sender.ambientRound) {
      getLogger().debug(
        { agentId: sender.agentId, channelId: event.channel },
        "slack.ambient.round_reply_skipped",
      );
      return;
    }
    const owned = rerouted
      ? { owner: null }
      : await routeOwnedThreadMessage(event, () =>
          handleChannelMessage(signedEvent, true),
        );
    if (owned.owner !== null && owned.dropped) return;
    if (await isIgnoredApp(sender, event.channel)) return;

    const bindings = (
      await channelRegistry.resolveSlackBindings(event.channel)
    ).filter((binding) => binding.instanceName !== owned.owner);
    const reached = bindings.some(
      (binding) => binding.ambient && senderReaches(sender, binding),
    );
    if (!reached) {
      if (sender.kind === "person" && event.threadTs && owned.owner === null)
        await noticeUntaggedReply(event, sender.user, event.threadTs, bindings);
      return;
    }
    const rateChecked = rerouted || (owned.owner !== null && owned.rateChecked);
    if (!rateChecked && !(await admitBotPost(sender, event))) return;

    const { images, files, failures, release } = await fetchSlackAttachments(
      gateway,
      event.files,
      slackUserId,
      heldBudget,
      event.teamId,
    );
    const withheldNote = renderWithheldNote(failures);

    const speaker = await speakerOf(sender);
    enqueueAmbient(event.channel, event.threadTs ?? null, {
      text: event.text + withheldNote,
      eventTs: event.ts,
      slackUserId,
      sender,
      speaker,
      images,
      files,
      release,
      ...(owned.owner !== null && { ownedBy: owned.owner }),
    });
  }

  let serving = false;
  let gatewayFailed = false;
  let gatewayStarting: Promise<SlackGateway | null> | null = null;

  async function ensureGateway(): Promise<SlackGateway | null> {
    if (gateway) return gateway;
    if (!serving || gatewayFailed) return null;
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
        onBotJoinedChannel: handleBotJoinedChannel,
        onViewSubmission: handleViewSubmission,
        onSessionStopped: handleSessionStopped,
      });
      if (!connected) {
        gatewayFailed = true;
        process.stderr.write("[slack] Slack bot not connected\n");
        return null;
      }
      if (!serving) {
        await gw.stop().catch(() => {});
        return null;
      }

      gateway = gw;
      process.stderr.write("Slack bot started (single app)\n");
      for (const teamId of await listWorkspaces().catch(() => [])) {
        await reportMissingPermissions(gw, teamId);
      }
      return gateway;
    } finally {
      gatewayStarting = null;
    }
  }

  const worker: SlackWorker = {
    type: ChannelType.Slack,

    async connect() {
      serving = true;
      gatewayFailed = false;
      if (!(await ensureGateway()))
        throw new Error("Slack gateway failed to connect");
    },

    async notifyClosedBind(instanceName: string, slackChannelId: string) {
      const closed =
        (await dmBridges?.closedFor(instanceName, slackChannelId)) ?? [];
      const record = closed[0];
      const gw = await ensureGateway();
      if (!record || !gw) return;
      const info = await gw
        .getConversationInfo(record.dmChannelId, record.teamId)
        .catch(() => null);
      const user = info?.kind === "found" ? info.directMessageUser : null;
      if (!user) return;
      /* UNIT_BOUNDARY_DESCRIPTION: the platform speaking, not the Agent — the
       * one message a released DM may still receive, because it is how the
       * person who just ran the ordinary bind learns that it stays closed. */
      await gw
        .postEphemeral({
          channel: record.dmChannelId,
          user,
          teamId: record.teamId,
          text:
            "This DM is connected to the agent, but its DM Bridge release has not been undone, " +
            "so the agent still does not read or answer here. Its owner can pair it again from the platform.",
        })
        .catch((err: unknown) => {
          getLogger().warn(
            { agentId: instanceName, error: formatError(err) },
            "slack.bind.closed_notice_failed",
          );
        });
    },

    async start(instanceName: string) {
      serving = true;
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
      serving = false;
      await turnRecovery.stop();
      if (gatewayStarting) await gatewayStarting.catch(() => null);
      const gw = gateway;
      gatewayFailed = false;
      if (gw) await gw.stop();
      gateway = null;
    },

    async conversationStanding(
      slackChannelId: string,
      teamId: SlackWorkspace,
    ): Promise<SlackConversationStanding> {
      const gw = await ensureGateway();
      if (!gw) throw new Error("slack gateway is not connected here");
      const lookup = await gw.getConversationInfo(slackChannelId, teamId);
      return match(lookup)
        .with({ kind: "found" }, (info) =>
          info.isMember ? ("member" as const) : ("known" as const),
        )
        .with(
          { kind: "not-found" },
          { kind: "no-credential" },
          () => "unknown" as const,
        )
        .exhaustive();
    },

    async channelChoices(keycloakSub: string): Promise<SlackChannelChoices> {
      const links = await identityLinks.externalLinksOf("slack", keycloakSub);
      if (links.length === 0) return { linked: false };
      const gw = await ensureGateway();
      if (!gw) throw new Error("slack gateway is not connected here");
      const userIds = [...new Set(links.map((l) => l.externalUserId))];
      const reach = await Promise.all(
        (await linkedWorkspaces(links)).map(
          async (teamId): Promise<SlackWorkspaceReach> => {
            const [botChannels, ...shared] = await Promise.all([
              gw.listBotChannels(teamId),
              ...userIds.map((userId) => gw.listSharedChannels(userId, teamId)),
            ]);
            return {
              teamId,
              botChannels,
              sharedChannelIds: new Set(shared.flat()),
            };
          },
        ),
      );
      return { linked: true, channels: pickableSlackChannels(reach) };
    },

    async channelMembership(
      keycloakSub: string,
      slackChannelId: string,
      teamId: SlackWorkspace,
    ): Promise<SlackChannelMembership> {
      const links = await identityLinks.externalLinksOf("slack", keycloakSub);
      if (links.length === 0) return { kind: "unlinked" };
      const gw = await ensureGateway();
      if (!gw) throw new Error("slack gateway is not connected here");
      const userIds = [...new Set(links.map((l) => l.externalUserId))];
      if (isDirectMessageId(slackChannelId)) {
        const lookup = await gw.getConversationInfo(slackChannelId, teamId);
        return lookup.kind === "found" &&
          lookup.directMessageUser !== null &&
          userIds.includes(lookup.directMessageUser)
          ? { kind: "member", slackUserId: lookup.directMessageUser }
          : { kind: "not-member" };
      }
      const workspaces = [
        ...new Set([teamId, ...(await linkedWorkspaces(links))]),
      ];
      for (const workspace of workspaces) {
        for (const userId of userIds) {
          const shared = await gw.listSharedChannels(userId, workspace);
          if (shared.includes(slackChannelId))
            return { kind: "member", slackUserId: userId };
        }
      }
      return { kind: "not-member" };
    },

    async emailUserByEmail(email, teamId) {
      const gw = await ensureGateway();
      if (!gw) throw new Error("slack gateway is not connected here");
      return gw.lookupUserByEmail(email, teamId);
    },

    async openDirectMessageWith(slackUserId, teamId) {
      const gw = await ensureGateway();
      if (!gw) throw new Error("slack gateway is not connected here");
      const channelId = await gw.openDirectMessage(slackUserId, teamId);
      const info = await gw.getConversationInfo(channelId, teamId);
      return info.kind === "found" ? { ...info, channelId } : info;
    },

    async conversationInfoOf(channelId, teamId) {
      const gw = await ensureGateway();
      if (!gw) return { kind: "no-credential" };
      return gw.getConversationInfo(channelId, teamId);
    },

    async grantedScopesOf(teamId) {
      const gw = await ensureGateway();
      if (!gw) return null;
      const scopes = await grantedScopes(gw, teamId);
      return scopes ? [...scopes] : null;
    },

    async listConversations(instanceName: string) {
      const bound =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (bound.length === 0) return [];
      const boundIds = bound.map((c) => c.id);

      let botChannels: SlackChannelInfo[] = [];
      const gw = await ensureGateway();
      if (gw) {
        const workspaces = [...new Set(bound.map((c) => c.teamId))];
        for (const teamId of workspaces) {
          try {
            botChannels.push(...(await gw.listBotChannels(teamId)));
          } catch (err) {
            process.stderr.write(
              `[slack] listBotChannels failed: ${formatError(err)}\n`,
            );
          }
        }
      }
      const boundConversations = bound.map(({ id }) => {
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
      const reachable = new Set<string>();
      if (gw) {
        for (const teamId of new Set(bound.map((c) => c.teamId))) {
          try {
            const reach = await ownerReach(gw, instanceName, teamId);
            if (reach !== "unlinked") reach.forEach((id) => reachable.add(id));
          } catch (err) {
            process.stderr.write(
              `[slack] owner channel lookup failed: ${formatError(err)}\n`,
            );
          }
        }
      }
      const others = botChannels
        .filter((c) => !boundIds.includes(c.id) && reachable.has(c.id))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ id: c.id, title: `#${c.name}` }));
      return [...boundConversations, ...others];
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

      const { conversationId, attachment, card, unfurlLinks, unfurlMedia } =
        options ?? {};
      if (!text && !card && !attachment) {
        return {
          error: "nothing to send — pass text, a card or an attachment",
        };
      }
      const target = await resolveOutboundTarget(
        gw,
        boundChannelIds,
        conversationId,
        turnWorkspace(instanceName),
        (id, teamId, dm) =>
          refuseOutsideOwnerReach(gw, instanceName, id, teamId, dm),
        (teamId, id) => bridgeClosed(instanceName, teamId, id),
      );
      if ("error" in target) {
        return target;
      }

      const [base, { persona, sign, emoji }] = await Promise.all([
        agentFooter(instanceName),
        agentPersona(gw, instanceName, target),
      ]);
      const footer = { ...base, emoji };
      const contextBlock = agentContextBlock(footer);
      const engaged = findTurnRef(
        instanceName,
        (ref) => ref.channel === target.id,
      );

      const post = agentPost(text, card, footer, sign);
      const refused = postRefusal(post);
      if (refused) return refused;

      try {
        let attachmentError: string | null = null;
        let ts: string | undefined;
        if (text || card) {
          ({ uploadError: attachmentError, ts } = await postWithAttachment(
            gw,
            target,
            attachment,
            undefined,
            persona,
            (fileIds) =>
              sendAgentPost(target.id, post, (blocks) =>
                gw.postMessage({
                  channel: target.id,
                  teamId: target.teamId,
                  text: post.text,
                  ...persona,
                  blocks,
                  metadata: agentPostMetadata(fileIds),
                  ...(unfurlLinks !== undefined ? { unfurlLinks } : {}),
                  ...(unfurlMedia !== undefined ? { unfurlMedia } : {}),
                }),
              ),
            unfurlLinks === false || unfurlMedia === false
              ? null
              : fileShareBlocks(
                  sign(text, "**"),
                  contextBlock,
                  post.cardBlocks,
                ),
          ));
        } else if (attachment) {
          try {
            await gw.uploadFile({
              channelId: target.id,
              teamId: target.teamId,
              file: attachment.data,
              filename: attachment.filename,
              title: attachment.title,
              blocks: [contextBlock],
            });
          } catch (err) {
            return { error: formatError(err) };
          }
        }
        noteEngaged(engaged, {
          messaged: true,
          ...(post.replyText ? { replyText: post.replyText } : {}),
        });
        return {
          ok: true as const,
          conversationId: target.id,
          ...(ts !== undefined ? { ts } : {}),
          ...(attachmentError ? { attachmentError } : {}),
        };
      } catch (err) {
        return { error: formatError(err) };
      }
    },

    async handOffTurn(
      instanceName: string,
      threadTs: string,
      targetName: string,
      note?: string,
    ) {
      if (!gateway) return { error: "Slack is not connected." };
      const inThread = (candidate: TurnRef) => candidate.threadTs === threadTs;
      const inFlight = [...(inFlightTurns.get(instanceName) ?? [])].filter(
        inThread,
      );
      const refs = inFlight.length
        ? inFlight
        : lingeringFor(instanceName).filter(inThread);
      if (refs.length === 0)
        return {
          error:
            `No turn of yours is answering thread "${threadTs}", so there is ` +
            "nothing there to hand off. Pass the threadTs shown in this " +
            "turn's instructions.",
        };
      if (refs.some((ref) => ref.whisper))
        return {
          error:
            "This was whispered to you privately, and handing it on would " +
            "put it in front of another agent's conversation. Answer it " +
            "yourself, or say why you can't.",
        };
      if (refs.some((ref) => ref.forwarded))
        return {
          error:
            "This message was already handed to you by another agent, so it " +
            "cannot be handed on again. Answer it, or say why you can't.",
        };
      if (refs.some((ref) => ref.handedOff))
        return {
          error:
            "You already handed this message to another agent — it cannot be " +
            "handed on twice.",
        };
      const handed = refs.filter((ref): ref is TurnRef & { text: string } =>
        Boolean(ref.text),
      );
      if (handed.length === 0)
        return {
          error:
            "This turn carries no message text to hand over. Answer it " +
            "yourself, or reply explaining who should.",
        };
      const ref = handed.at(-1)!;

      const roster = await resolveRoster(ref.channel);
      const { matches } = matchRosterName(roster, targetName);
      const connected = roster.map((entry) => entry.name).join(", ");
      if (matches.length === 0)
        return {
          error:
            `No agent called "${targetName}" is connected to this ` +
            `conversation. Connected here: ${connected || "none"}.`,
        };
      if (matches.length > 1)
        return {
          error:
            `More than one agent connected here is called "${targetName}", ` +
            "so I cannot tell which you mean.",
        };
      const target = matches[0]!;
      if (target.instanceName === instanceName)
        return {
          error: "That is you. Hand off to a different agent, or answer it.",
        };
      if (!(await isTermsAccepted(target.owner)))
        return {
          error:
            `"${target.name}" cannot take turns yet — whoever connected it ` +
            "must accept the Terms of Use first. Answer it yourself, or say " +
            "you can't.",
        };
      const held = await spendHold?.(target.instanceName, {
        kind: "mention",
        channel: "slack",
      });
      if (held)
        return {
          error:
            `"${target.name}" reached ` +
            (held === "limit"
              ? "its spend limit"
              : "its owner's spend ceiling") +
            " for today, so it cannot take turns. Answer it yourself, or " +
            "say you can't.",
        };

      const self = await resolveAgentName(instanceName);
      for (const each of refs) {
        each.handedOff = true;
        each.declined = true;
      }

      const droppedAttachments = refs.some(
        (each) => each.hadAttachments === true,
      );
      const handedNote = [
        ...(note ? [`${self} handed this to you: ${note}`] : []),
        ...(droppedAttachments
          ? [
              `${self} was sent files or images with this message; they are not carried over, so ask for them if you need them`,
            ]
          : []),
      ];
      const handedSuffix = handedNote.length
        ? `\n\n[${handedNote.join(". ")}]`
        : "";

      void relaySharedTurn({
        channel: ref.channel,
        teamId: ref.teamId,
        threadTs: ref.threadTs,
        messages: handed.map((each) => ({
          text: each === ref ? `${each.text}${handedSuffix}` : each.text,
          eventTs: each.eventTs,
          slackUserId: each.slackUserId ?? "",
          inThread: each.hasThread === true,
        })),
        slackUserId: ref.slackUserId ?? "",
        instanceName: target.instanceName,
        owner: target.owner,
        images: [],
        files: [],
        speakerLabel: false,
        ambient: target.ambient,
        roster,
        forwardedFrom: self,
      }).catch(async (err) => {
        getLogger().warn(
          {
            agentId: target.instanceName,
            from: instanceName,
            channelId: ref.channel,
            error: formatError(err),
          },
          "slack.hand_off.failed",
        );
        if (!ref.slackUserId) return;
        await gateway
          ?.postEphemeral({
            channel: ref.channel,
            user: ref.slackUserId,
            teamId: ref.teamId,
            threadTs: ref.threadTs,
            text: `\`${self}\` passed your message to \`${target.name}\`, but it couldn't pick it up. Try again, or address \`${self}\` directly.`,
          })
          .catch(() => {});
      });

      getLogger().info(
        {
          agentId: instanceName,
          to: target.instanceName,
          channelId: ref.channel,
          threadTs: ref.threadTs,
        },
        "slack.turn.handed_off",
      );
      return { ok: true as const, agent: target.name };
    },

    async declineTurn(instanceName: string, threadTs?: string) {
      let ref: TurnRef | undefined;
      if (threadTs) {
        const id = threadTs;
        ref = findTurnRef(
          instanceName,
          (candidate) => candidate.threadTs === id,
        );
        if (!ref)
          return {
            error:
              `No turn of yours is answering thread "${id}", so there is ` +
              "nothing there to end. Pass the threadTs shown in this turn's " +
              "instructions, so the turn recorded as silent is the one you " +
              "are ending.",
          };
      } else if (liveTurnRefs(instanceName).length > 0) {
        return {
          error:
            "Pass the threadTs shown in this turn's instructions, so the " +
            "turn recorded as silent is the one you are ending.",
        };
      }
      if (!ref) return { ok: true as const };
      ref.declined = true;
      getLogger().info(
        {
          agentId: instanceName,
          channelId: ref.channel,
          threadTs: ref.threadTs,
        },
        "slack.turn.declined: the agent chose not to answer",
      );
      return { ok: true as const };
    },

    async reply(instanceName: string, args: ChannelReply) {
      const boundChannelIds =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (boundChannelIds.length === 0)
        return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };
      const hasBody = args.text.trim() !== "" || args.card !== undefined;
      const attachmentOnly = hasBody ? undefined : args.attachment;
      if (!hasBody && !attachmentOnly)
        return {
          error: "nothing to send — reply needs text, a card or an attachment",
        };
      if (attachmentOnly && args.alsoSendToChannel)
        return {
          error:
            "a file-only reply cannot also be sent to the channel — add text " +
            "or drop alsoSendToChannel",
        };

      let threadTs = args.threadTs;
      let turn: TurnRef | undefined;
      if (!threadTs) {
        const resolved = resolveTurn(instanceName, "reply");
        if ("ambiguous" in resolved) return { error: AMBIGUOUS_THREAD_ERROR };
        if ("none" in resolved) {
          return {
            error:
              "no active thread to reply to — if you are answering a thread, pass " +
              "the threadTs shown in that turn's instructions; for a top-level " +
              "post use post",
          };
        }
        threadTs = resolved.ref.threadTs;
        turn = resolved.ref;
      } else {
        const id = threadTs;
        turn = findTurnRef(instanceName, (ref) => ref.threadTs === id);
      }
      const bridgeRefusal = turn
        ? await bridgeClosed(
            instanceName,
            turn.teamId,
            args.conversationId ?? turn.channel,
          )
        : null;
      if (bridgeRefusal) return bridgeRefusal;
      const whisper =
        turn?.whisper && (args.conversationId ?? turn.channel) === turn.channel
          ? turn.whisper
          : null;
      if (turn && whisper?.privateReply)
        return replyToWhisper(gw, instanceName, turn, whisper, args);
      const target =
        turn && whisper
          ? { id: turn.channel, teamId: turn.teamId }
          : await resolveOutboundTarget(
              gw,
              boundChannelIds,
              args.conversationId ?? turn?.channel,
              turnWorkspace(instanceName),
              async (id, teamId, dm) =>
                id === turn?.channel
                  ? null
                  : refuseOutsideOwnerReach(gw, instanceName, id, teamId, dm),
            );
      if ("error" in target) return target;
      const bridged = await bridgeClosed(
        instanceName,
        target.teamId,
        target.id,
      );
      if (bridged) return bridged;

      const [base, { persona, sign, emoji }] = await Promise.all([
        agentFooter(instanceName, turn?.sessionId, turn?.ambient),
        agentPersona(gw, instanceName, target),
      ]);
      const footer = { ...base, emoji };
      const engaged = findTurnRef(
        instanceName,
        (ref) => ref.threadTs === threadTs && ref.channel === target.id,
      );
      if (attachmentOnly) {
        try {
          await gw.uploadFile({
            channelId: target.id,
            teamId: target.teamId,
            threadTs,
            file: attachmentOnly.data,
            filename: attachmentOnly.filename,
            title: attachmentOnly.title,
            blocks: [agentContextBlock(footer)],
          });
        } catch (err) {
          return { error: formatError(err) };
        }
        noteEngaged(engaged, { messaged: true });
        return { ok: true as const, conversationId: target.id };
      }
      const post = agentPost(args.text, args.card, footer, sign);
      const refused = postRefusal(post);
      if (refused) return refused;
      try {
        const { uploadError, ts } = await postWithAttachment(
          gw,
          target,
          args.attachment,
          threadTs,
          persona,
          (fileIds) =>
            sendAgentPost(target.id, post, (blocks) =>
              gw.postMessage({
                channel: target.id,
                teamId: target.teamId,
                threadTs,
                text: post.text,
                ...persona,
                blocks,
                metadata: agentPostMetadata(fileIds),
                ...(args.alsoSendToChannel ? { replyBroadcast: true } : {}),
                ...(args.unfurlLinks !== undefined
                  ? { unfurlLinks: args.unfurlLinks }
                  : {}),
                ...(args.unfurlMedia !== undefined
                  ? { unfurlMedia: args.unfurlMedia }
                  : {}),
              }),
            ),
          args.alsoSendToChannel ||
            args.unfurlLinks === false ||
            args.unfurlMedia === false
            ? null
            : fileShareBlocks(
                sign(args.text, "**"),
                agentContextBlock(footer),
                post.cardBlocks,
              ),
        );
        noteEngaged(engaged, { messaged: true, replyText: post.replyText });
        return {
          ok: true as const,
          conversationId: target.id,
          ...(ts !== undefined ? { ts } : {}),
          ...(uploadError ? { attachmentError: uploadError } : {}),
        };
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
      let turnRef: TurnRef | undefined;
      if (!messageTs) {
        const turn = resolveTurn(instanceName, "react");
        if ("ambiguous" in turn) return { error: AMBIGUOUS_THREAD_ERROR };
        if ("none" in turn) return { error: "no message to react to" };
        messageTs = turn.ref.eventTs;
        turnRef = turn.ref;
      } else {
        const id = messageTs;
        turnRef = findTurnRef(instanceName, (ref) => ref.eventTs === id);
      }
      if (turnRef?.whisper?.privateReply)
        return {
          error:
            "A whisper is not a message in the channel, so there is nothing " +
            "to react to. Answer it with reply — only the person who " +
            "whispered sees it.",
        };
      const turnChannel = turnRef?.channel;
      const name = args.emoji.trim().replace(/^:+|:+$/g, "");
      if (!name) {
        return { error: 'emoji is required (a Slack short name like "eyes")' };
      }
      const target = await resolveOutboundTarget(
        gw,
        boundChannelIds,
        args.conversationId ?? turnChannel,
        turnWorkspace(instanceName),
        async (id, teamId, dm) =>
          id === turnChannel
            ? null
            : refuseOutsideOwnerReach(gw, instanceName, id, teamId, dm),
      );
      if ("error" in target) return target;

      try {
        await gw.addReaction({
          channel: target.id,
          ts: messageTs,
          name,
          teamId: target.teamId,
        });
        noteEngagedTurn(
          instanceName,
          (ref) => ref.eventTs === messageTs && ref.channel === target.id,
        );
        return { ok: true as const };
      } catch (err) {
        return { error: formatError(err) };
      }
    },

    async describeUsers(
      instanceName: string,
      userIds: string[],
      conversationId?: string,
    ) {
      const bound =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (bound.length === 0) return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };

      const workspace = workspaceOf(
        bound,
        conversationId,
        turnWorkspace(instanceName),
      );
      if (workspace === undefined) {
        return {
          error: conversationId
            ? `${conversationId} does not say which workspace to look in: pass ` +
              "a conversation this agent is connected to, or the one you are " +
              "answering, in the person's workspace"
            : "this agent is connected to more than one Slack workspace, and a " +
              "user id only means something inside one: pass chatId for a " +
              "conversation this agent is connected to, or the one you are " +
              "answering, in the person's workspace",
        };
      }

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

      const lookupGranted = await hasScope(gw, workspace, "users:read");
      const users = await Promise.all(
        requested.map(async ({ raw, id }): Promise<ChannelUser> => {
          if (id && !lookupGranted) {
            return { id, error: SCOPE_WITHHELD_USERS };
          }
          if (!id) {
            return {
              id: raw,
              error:
                "not a Slack user id — pass the U… id as it appears in the conversation",
            };
          }
          let info: SlackUserInfo | null;
          try {
            info = await lookupUser(gw, workspace, id);
          } catch (err) {
            return { id, error: formatError(err) };
          }
          return info
            ? { ...info }
            : { id, error: "no such user in this workspace" };
        }),
      );
      return { users };
    },

    async resolveConversationLabels(refs: SlackConversationRef[]) {
      const wanted = new Map<string, SlackConversationRef>();
      for (const ref of refs) wanted.set(conversationKey(ref), ref);

      const resolved: SlackLabelledConversation[] = [];
      const unresolved: SlackConversationRef[] = [];
      for (const [key, ref] of wanted) {
        const cached = conversationLabelCache.get(key);
        if (cached !== undefined) {
          resolved.push({ ...ref, label: cached });
        } else {
          unresolved.push(ref);
        }
      }
      if (unresolved.length === 0) return resolved;

      const gw = await ensureGateway();
      if (!gw) {
        return [
          ...resolved,
          ...unresolved.map((ref) => ({ ...ref, label: null })),
        ];
      }

      const looked = await Promise.all(
        unresolved.map(async (ref) => ({
          ...ref,
          label: await resolveConversationLabel(gw, ref),
        })),
      );
      return [...resolved, ...looked];
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
        turnWorkspace(instanceName),
        async (id, teamId, dm) =>
          id === turnChannel
            ? null
            : refuseOutsideOwnerReach(gw, instanceName, id, teamId, dm),
      );
      if ("error" in target) return target;

      if (!(await hasScope(gw, target.teamId, "reactions:read")))
        return { error: SCOPE_WITHHELD_REACTIONS };

      try {
        const reactions = await gw.getMessageReactions(
          target.id,
          messageTs,
          target.teamId,
        );
        if (!reactions) return { error: "message not found" };
        return { reactions, conversationId: target.id, messageTs };
      } catch (err) {
        return { error: formatError(err) };
      }
    },

    async getMessageLink(instanceName: string, query: MessageLinkQuery) {
      const boundChannelIds =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (boundChannelIds.length === 0)
        return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };

      const { messageTs } = query;
      const liveChannels = new Set(
        liveTurnRefs(instanceName).map((ref) => ref.channel),
      );
      const turnChannel =
        findTurnRef(instanceName, (ref) => ref.eventTs === messageTs)
          ?.channel ??
        (liveChannels.size === 1 ? [...liveChannels][0] : undefined);
      const target = await resolveOutboundTarget(
        gw,
        boundChannelIds,
        query.conversationId ?? turnChannel,
        turnWorkspace(instanceName),
        async (id, teamId, dm) =>
          id === turnChannel
            ? null
            : refuseOutsideOwnerReach(gw, instanceName, id, teamId, dm),
      );
      if ("error" in target) return target;

      try {
        const link = await gw.getPermalink(target.id, messageTs, target.teamId);
        if (!link) {
          return {
            error:
              `Slack gave no link for message ${messageTs} in ` +
              `${target.id} — check messageTs, and pass chatId when the ` +
              "message is in another conversation",
          };
        }
        return { link, conversationId: target.id, messageTs };
      } catch (err) {
        return { error: formatError(err) };
      }
    },

    async readThread(instanceName: string, query: ThreadQuery) {
      const bound =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (bound.length === 0) return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };

      const owned = await ownedThreads
        .findForAgent(instanceName, query.threadTs)
        .catch(() => null);
      const offered = owned
        ? { channel: owned.channelId }
        : readOfferedThread(instanceName, query.threadTs, bound);
      if (!offered) {
        return {
          error:
            "not a thread you were shown — you can read the thread you are " +
            "answering in, a thread you started with start_thread, and a " +
            "thread from a [thread: ...] tag in the conversation history " +
            "handed to you, and such a tag ages out after 48 hours. To read " +
            "any other thread, ask a person to tag you in it, which makes " +
            "it readable",
        };
      }
      const target = owned
        ? { id: owned.channelId, teamId: owned.teamId }
        : bound.find((c) => c.id === offered.channel);
      if (!target) {
        return {
          error:
            "the conversation this thread was shown in is no longer " +
            "connected to this agent",
        };
      }

      const asked =
        query.cursor !== undefined ? parseThreadCursor(query.cursor) : null;
      if (query.cursor !== undefined && asked?.threadTs !== query.threadTs)
        return { error: STALE_THREAD_CURSOR };

      try {
        const end = await readThreadWindow(gw, {
          channel: target.id,
          threadTs: query.threadTs,
          teamId: target.teamId,
          ...(asked !== null ? { before: asked.before } : {}),
        });
        if (end.messages.length === 0) {
          return {
            error:
              "no messages came back for that thread — it may not exist in " +
              "this conversation, or this workspace's Slack credential may " +
              "no longer be valid",
          };
        }
        const offsets = end.messages.map(
          (message) => end.offsets.get(message) ?? 0,
        );
        const reached = offsets.some((offset) => offset > 0);
        if (asked !== null && !reached) return { error: STALE_THREAD_CURSOR };
        const bot = {
          userId: await gw.getBotUserId(target.teamId).catch(() => null),
          label: botHistoryLabel(brand),
        };
        const entries = end.messages.map((message) => ({
          message,
          footer: parseAgentFooter(message),
        }));
        const names = await resolveAuthorNames(entries, resolveAgentName);
        const labelled = labelMessages(entries, names, instanceName, bot, {
          showThreadMarkers: false,
          showTs: true,
        });
        return {
          messages: markThreadWindow(labelled, offsets, {
            threadTs: query.threadTs,
            repliesBefore: end.repliesBefore,
            hasEarlier: end.hasEarlier,
            cursor: end.cursor,
            alwaysLabel: asked !== null,
          }).lines,
          conversationId: target.id,
          threadTs: query.threadTs,
          hasMore: end.hasEarlier,
          ...(end.cursor !== null ? { cursor: end.cursor } : {}),
        };
      } catch (err) {
        return { error: formatError(err) };
      }
    },

    async readChannelHistory(instanceName: string, query: ChannelHistoryQuery) {
      const bound =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (bound.length === 0) return { error: "no channel connected" };
      const reach = await historyReachOf(instanceName, query.sessionId);
      if ("error" in reach) return reach;
      const readable = bound.filter((c) => c.history === true);

      const asked =
        query.cursor !== undefined
          ? parseChannelHistoryCursor(query.cursor)
          : null;
      if (query.cursor !== undefined && asked === null)
        return { error: STALE_CHANNEL_CURSOR };
      if (
        asked !== null &&
        query.conversationId !== undefined &&
        asked.conversationId !== query.conversationId
      )
        return { error: STALE_CHANNEL_CURSOR };

      const wanted =
        query.conversationId ??
        asked?.conversationId ??
        (reach.only || undefined) ??
        (readable.length === 1 ? readable[0]!.id : undefined);
      if (reach.only !== null && wanted !== reach.only)
        return {
          error: channelTurnReachRefusal(
            reach.only,
            wanted ?? "another conversation",
          ),
        };
      if (wanted === undefined) {
        return {
          error:
            readable.length === 0
              ? channelHistoryNotOn("any conversation", readable)
              : "pass chatId: channel history is on for you in " +
                readable.map((c) => c.id).join(", "),
        };
      }
      const target = readable.find((c) => c.id === wanted);
      if (!target) return { error: channelHistoryNotOn(wanted, readable) };

      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };

      const latest = asked?.before ?? query.until;
      const since = asked?.since ?? query.since;
      try {
        const read = await gw.getChannelHistory({
          channel: target.id,
          teamId: target.teamId,
          limit: CHANNEL_LOOKBACK,
          ...(since !== undefined ? { oldest: since } : {}),
          ...(latest !== undefined ? { latest } : {}),
        });
        const oldestFirst = read.messages.slice().reverse();
        const bot = {
          userId: await gw.getBotUserId(target.teamId).catch(() => null),
          label: botHistoryLabel(brand),
        };
        const entries = oldestFirst.map((message) => ({
          message,
          footer: parseAgentFooter(message),
        }));
        const names = await resolveAuthorNames(entries, resolveAgentName);
        const lines = labelMessages(entries, names, instanceName, bot, {
          showThreadMarkers: true,
          showTs: true,
        });
        noteOfferedThreads(
          instanceName,
          target.id,
          oldestFirst.flatMap((message) =>
            marksThread(message) && message.ts !== undefined
              ? [message.ts]
              : [],
          ),
          "history",
        );
        const earliest = oldestFirst[0]?.ts;
        return {
          messages: lines,
          conversationId: target.id,
          hasMore: read.hasMore,
          ...(read.hasMore && earliest !== undefined
            ? {
                cursor: formatChannelHistoryCursor({
                  conversationId: target.id,
                  before: earliest,
                  ...(since !== undefined ? { since } : {}),
                }),
              }
            : {}),
        };
      } catch (err) {
        return { error: formatError(err) };
      }
    },

    async startThread(instanceName: string, start: ThreadStart) {
      if (!start.text.trim())
        return { error: "nothing to send — start_thread needs text" };
      const posted = await worker.postMessage(instanceName, start.text, {
        conversationId: start.conversationId,
        ...(start.card ? { card: start.card } : {}),
      });
      if ("error" in posted) return posted;
      if (posted.conversationId === undefined || posted.ts === undefined)
        return { error: "Slack did not say where the post landed" };
      const target = (
        await channelRegistry.resolveSlackChannelsByInstance(instanceName)
      ).find((c) => c.id === posted.conversationId);
      const teamId =
        target?.teamId ??
        turnWorkspace(instanceName)(posted.conversationId) ??
        turnWorkspace(instanceName)();
      if (teamId === undefined)
        return {
          error:
            "the message was posted, but its workspace is unknown, so " +
            "replies under it are not followed",
        };
      const released = await bridgeClosed(
        instanceName,
        teamId,
        posted.conversationId,
      );
      if (released) {
        return {
          error: `${released.error} The thread was posted but its replies are not followed.`,
        };
      }
      try {
        await ownedThreads.own({
          channelId: posted.conversationId,
          threadTs: posted.ts,
          teamId,
          agentId: instanceName,
          sessionId: start.sessionId,
          firstLine: sessionTitleOf(start.text).slice(0, FIRST_LINE_MAX),
        });
      } catch (err) {
        return {
          error: `the message was posted, but replies under it are not followed: ${formatError(err)}`,
        };
      }
      getLogger().info(
        {
          agentId: instanceName,
          sessionId: start.sessionId,
          channelId: posted.conversationId,
          threadTs: posted.ts,
        },
        "slack.owned_thread.started",
      );
      return {
        ok: true as const,
        conversationId: posted.conversationId,
        threadTs: posted.ts,
      };
    },

    async listThreads(instanceName: string, sessionId: string) {
      let owned: SlackOwnedThread[];
      try {
        owned = await ownedThreads.listForSession(instanceName, sessionId);
      } catch (err) {
        return { error: formatError(err) };
      }
      const gw = await ensureGateway();
      const threads = await Promise.all(
        owned.map(async (thread) => {
          const base = {
            conversationId: thread.channelId,
            threadTs: thread.threadTs,
            firstLine: thread.firstLine,
            startedAt: thread.createdAt.toISOString(),
          };
          if (!gw) return base;
          const read = await gw
            .getThreadReplies({
              channel: thread.channelId,
              threadTs: thread.threadTs,
              teamId: thread.teamId,
              limit: THREAD_LOOKBACK,
              oldest: thread.deliveredUpTo,
            })
            .catch(() => null);
          const parent = read?.messages.find(
            (message) => message.ts === thread.threadTs,
          );
          if (!read || !parent) return base;
          const latest = parent.latestReplyTs ?? thread.threadTs;
          return {
            ...base,
            replies: parent.replyCount ?? 0,
            lastActivityAt: new Date(Number(latest) * 1000).toISOString(),
            replyWaiting: read.messages.some(
              (message) =>
                message.ts !== undefined &&
                isAfterTs(message.ts, thread.deliveredUpTo) &&
                parseAgentFooter(message)?.agentId !== instanceName,
            ),
          };
        }),
      );
      return { threads };
    },

    async leaveThread(instanceName: string, leave: ThreadLeave) {
      try {
        const left = await ownedThreads.leave(
          instanceName,
          leave.sessionId,
          leave.conversationId,
          leave.threadTs,
        );
        if (!left)
          return {
            error:
              "this session does not follow that thread — list_threads " +
              "shows the ones it does",
          };
      } catch (err) {
        return { error: formatError(err) };
      }
      getLogger().info(
        {
          agentId: instanceName,
          sessionId: leave.sessionId,
          channelId: leave.conversationId,
          threadTs: leave.threadTs,
        },
        "slack.owned_thread.left",
      );
      return { ok: true as const };
    },

    async fetchAttachment(instanceName: string, query: AttachmentQuery) {
      const bound =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (bound.length === 0) return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };

      let found: {
        info: SlackFileInfo;
        target: SlackBoundConversation;
      } | null = null;
      let lookupError: string | null = null;
      for (const teamId of new Set(bound.map((c) => c.teamId))) {
        try {
          const info = await gw.getFileInfo(query.fileId, teamId);
          const target = bound.find(
            (c) => c.teamId === teamId && info?.sharedIn.includes(c.id),
          );
          if (info && target) {
            found = { info, target };
            break;
          }
        } catch (err) {
          lookupError = formatError(err).includes("missing_scope")
            ? "this workspace's install lacks the `files:read` permission, " +
              "so it cannot read attachments. Ask the owner to reinstall the " +
              "app with that scope"
            : formatError(err);
        }
      }
      if (!found && lookupError !== null) return { error: lookupError };
      if (!found) {
        return {
          error:
            "not a file shared in a conversation connected to this agent — " +
            "pass the fileId from an [attachment: ...] tag in your " +
            "conversation history",
        };
      }
      const { info, target } = found;

      const fetched = await fetchSlackAttachments(
        gw,
        [info.file],
        info.uploader ?? "unknown",
        heldBudget,
        target.teamId,
        "handed",
      );
      try {
        const [failure] = fetched.failures;
        if (failure)
          return { error: `couldn't fetch ${failure.name}: ${failure.reason}` };
        let withheld: FetchedFailure | undefined;
        const delivery = await deliverTurnFiles({
          agentId: instanceName,
          conversation: target.id,
          files: fetched.files,
          onWithheld: async (f) => {
            withheld = f;
          },
        });
        const [file] = delivery.files;
        if (!file) {
          return {
            error: `couldn't fetch ${withheld?.name ?? attachmentName(info.file)}: ${withheld?.reason ?? "nothing came back. Try again."}`,
          };
        }
        return {
          path: file.path,
          name: file.name,
          size: file.size,
          ...(file.contentType ? { contentType: file.contentType } : {}),
          conversationId: target.id,
        };
      } finally {
        fetched.release();
      }
    },

    async notifyPerson(keycloakSub: string, text: string) {
      const links = await identityLinks.externalLinksOf("slack", keycloakSub);
      if (links.length === 0) return { sent: 0 };
      const gw = await ensureGateway();
      if (!gw) return { sent: 0 };
      const active = await listWorkspaces();
      let sent = 0;
      for (const link of links) {
        const teamId =
          link.teamId ?? (active.length === 1 ? active[0] : undefined);
        if (
          teamId === undefined ||
          (teamId !== "" && !active.includes(teamId))
        ) {
          process.stderr.write(
            `[slack] no workspace to notify ${link.externalUserId} in\n`,
          );
          continue;
        }
        if (!(await hasScope(gw, teamId, "im:write"))) {
          process.stderr.write(
            `[slack] workspace ${teamId} did not grant im:write; cannot notify ${link.externalUserId}\n`,
          );
          continue;
        }
        try {
          const channel = await gw.openDirectMessage(
            link.externalUserId,
            teamId,
          );
          if (await gw.postMessage({ channel, text, teamId })) sent++;
        } catch (err) {
          process.stderr.write(
            `[slack] could not notify ${link.externalUserId}: ${formatError(err)}\n`,
          );
        }
      }
      return { sent };
    },
  };
  return worker;
}
