import { randomUUID } from "node:crypto";
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
import {
  inboundFilePath,
  looksLikeSignInPage,
  mayContainMarkup,
  wasSentAsImage,
  MAX_FILE_BYTES,
  TOTAL_FILE_BYTES_CAP,
} from "../inbound-file.js";
import type { AgentWorkspaceFilesFactory } from "./agent-workspace-files.js";
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
import { FileTooLargeError } from "./slack-gateway.js";
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

/** Per-turn contract prepended to every relayed Slack message. Plain assistant
 *  text is never delivered — the agent reaches the channel only by calling a
 *  tool. The concrete thread/message ids are injected so the agent can echo
 *  them back; the tools also fall back to the turn's most-recent ids when they
 *  are omitted. Re-stated every turn because mention and ambient turns
 *  interleave in the same sessions — the contract can't live in a session
 *  alone. The install's bot identity comes from the brand config; the agent's
 *  own name belongs to its workspace setup and is deliberately not injected. */
function slackTurnContract(ctx: {
  replyThreadTs: string;
  eventTs: string;
  brand: { name: string; short: string };
  /** Whether describe_channel_users is registered on this Agent's MCP
   *  session — omit its mention when it isn't, so the contract never points
   *  at a tool the agent won't find. */
  canLookupUsers: boolean;
  /** Set when several coalesced read-along messages share this turn: each is
   *  tagged `[ts …]` in the prompt so the agent can target the one it means.
   *  `inThread` batches still reply into their one thread; top-level batches
   *  must name the message a reply threads under. */
  batch?: { count: number; inThread: boolean };
  /** Whether the triggering message arrived in a 1:1 DM rather than a shared
   *  channel or group DM — changes who else can see the exchange. */
  isDirectMessage: boolean;
  /** A permanent link to the triggering message, or null when Slack couldn't
   *  resolve one (never fails the turn over this). */
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
    // A coalesced batch has no single send time or permalink to name — each
    // message carries its own [ts …] tag instead.
    multi
      ? `You're reading ${batchCount} messages from ` +
        `${ctx.isDirectMessage ? "a 1:1 direct message" : "a shared channel or group DM"}. ` +
        "Each [ts …] tag above is that message's own send time, in seconds " +
        "since the Unix epoch."
      : `You're answering a message sent ${formatSlackTs(ctx.eventTs)}, in ` +
        `${ctx.isDirectMessage ? "a 1:1 direct message" : "a shared channel or group DM"}` +
        (ctx.permalink ? ` (permalink: ${ctx.permalink})` : "") +
        ".",
    // Sessions outlive the surface they started on: this same conversation can
    // be continued from the platform UI, where an unqualified "only tool calls
    // reach the channel" has the agent answer the person typing there by
    // posting into Slack instead. A turn from a surface that names itself
    // carries its own block; the rest are covered by the second sentence.
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
 *  the user's message — carrying any images as content blocks, and any file
 *  delivered for this turn as a link to where it now sits in the workspace. */
function framePrompt(opts: {
  contract: string;
  guidance?: string;
  context?: string[];
  /** Explains the history attribution prefixes; emitted right before the
   *  `<context>` block when that history contains agent-authored lines. */
  contextLegend?: string;
  text: string;
  images: FetchedImage[];
  /** Files already written into the agent's workspace for this turn. */
  files?: DeliveredFile[];
}): string | ContentBlock[] {
  const parts: string[] = [opts.contract];
  if (opts.guidance) parts.push(opts.guidance);
  if (opts.context && opts.context.length > 0) {
    if (opts.contextLegend) parts.push(opts.contextLegend);
    parts.push(`<context>\n${opts.context.join("\n")}\n</context>`);
  }
  parts.push(opts.text);
  const delivered = opts.files ?? [];
  if (delivered.length > 0) parts.push(renderDeliveredFiles(delivered));
  const text = parts.join("\n\n");
  if (opts.images.length === 0 && delivered.length === 0) return text;
  return [
    { type: "text", text },
    ...opts.images.map((i) => i.block),
    ...delivered.map(
      (f): ContentBlock => ({
        type: "resource_link",
        uri: `file://${f.path}`,
        name: f.name,
        size: f.size,
        ...(f.contentType ? { mimeType: f.contentType } : {}),
      }),
    ),
  ];
}

/** A filename as it may appear in anything the platform emits — its own prompt
 *  framing, an ACP link a harness may splice into the model's text, a message
 *  posted into the channel. A name carrying `<`, `>` or a newline could
 *  otherwise close the block it sits in and open a forged one in the same
 *  vocabulary the turn contract uses, or hand Slack a `<!channel>` to act on.
 *  Length-capped for the same reason. Applied once, at {@link attachmentName},
 *  so every reader downstream can take the name as it finds it. */
function promptSafeName(name: string): string {
  return (
    name
      .replace(/[<>\r\n\t]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "file"
  );
}

/** Names the turn's files and where they landed. The link blocks carry the same
 *  paths, but a Slack turn's prompt is machine-framed: saying it in words is
 *  what ties the files to *this* message, rather than leaving the agent to infer
 *  that a path it was handed is the thing being asked about. */
function renderDeliveredFiles(files: DeliveredFile[]): string {
  const list = files.map((f) => `- ${f.name} → ${f.path}`).join("\n");
  return `<attached-files>\nSaved in your workspace, attached to this message:\n${list}\n</attached-files>`;
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

/** A downloaded attachment the agent is handed as a file. The bytes wait here
 *  until the turn's pod is awake, because writing them is something only a
 *  running pod can do. */
export type FetchedFile = {
  name: string;
  bytes: Buffer;
  /** Who attached it. Kept on the file, not the turn: a coalesced read-along
   *  batch carries several people's attachments into one turn, and the audit
   *  trail answers "who put this in the workspace". */
  uploader: string;
  contentType?: string;
};

/** A file that made it into the agent's workspace: the name the sender knows it
 *  by, and the absolute path it can now be opened from. */
type DeliveredFile = {
  name: string;
  path: string;
  size: number;
  contentType?: string;
};

/** The outcome of handing a turn's files over: what the agent can open, and a
 *  note about any that never got there. */
type TurnDelivery = { files: DeliveredFile[]; withheldNote: string };

/** A withheld attachment, and why — `kind` picks the noun the sender's notice
 *  uses, since "image" would be wrong for a spreadsheet. `plural` marks the one
 *  case where several are withheld together: a message-level limit is a property
 *  of the message, so it is explained once and names them all. */
type FetchedFailure = {
  name: string;
  kind: "image" | "file";
  plural?: true;
  reason: string;
};

/** The worker's attachment-memory budget, as the download loop sees it.
 *
 *  Admission and charge are one call, deliberately: a `fits()` a caller acts on
 *  later is read across the download's `await`, so every concurrent fetch would
 *  pass the same snapshot and only then charge — bounding settled bytes while the
 *  bytes actually in flight go uncounted. Reserving up front means an admitted
 *  fetch is already paid for. */
interface HeldBudget {
  /** Reserve `bytes` before reading them, or refuse. */
  reserve(bytes: number): HeldClaim | null;
}

interface HeldClaim {
  /** Lower the reservation to what actually arrived. Only ever lowers, so it
   *  cannot fail and cannot exceed what admission already granted. */
  settle(bytes: number): void;
  release(): void;
}

type FetchAttachmentsResult = {
  images: FetchedImage[];
  files: FetchedFile[];
  failures: FetchedFailure[];
  /** Releases every byte this fetch charged. The turn carrying the files owns
   *  it, and must call it on every settlement path. */
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

/** Why a downloaded attachment never reached the agent, in words the sender can
 *  act on. A rejected attachment is worth explaining rather than dropping: the
 *  harness would otherwise hand the model an unreadable blob and the agent
 *  would answer with an internal resize error (#3008). `noun` is what the
 *  sender sent — a picture the agent looks at, or a file it opens. */
async function withheldCopy(
  gw: SlackGateway,
  attachment: Exclude<InboundAttachment, { kind: "image" }>,
  noun: "image" | "file",
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
        `the app with that scope and send the ${noun} again.`
    : "Slack returned a web page instead of the file, so the agent never saw " +
        `the ${noun}. That usually means the app cannot download attachments in ` +
        "this conversation — check that it is still installed and can read files.";
}

/** Slack's own claims about an attachment, as the shared descriptor the
 *  image/file fork reads. Both fields are typed as present but Slack omits them
 *  on some clients. */
function describeSlackFile(f: SlackImageFile) {
  return { name: f.name, mimeType: f.mimetype };
}

/** The attachment's name, as everything downstream may use it. Two problems are
 *  settled once here rather than at each of the many readers: Slack omits `name`
 *  on some clients despite typing it as present, and the name is chosen by the
 *  uploader — who, in a shared channel, is anyone the workspace admits. It
 *  reaches the prompt's file list, the ACP link (which some harnesses splice
 *  straight into the model's text), the withheld note, and messages this bot
 *  posts into the channel, where Slack would act on `<!channel>`. */
function attachmentName(f: SlackImageFile): string {
  return promptSafeName(f.name || "file");
}

/** Said to the sender when the worker is already holding all the attachment
 *  bytes it will hold at once. Not about this file's size — about how much is in
 *  flight — so it asks for a retry rather than a smaller file. */
const OVER_HELD_BUDGET =
  "the agent is already holding as many attachments as it can at once. " +
  "Send it again in a moment.";

function megabytes(bytes: number): string {
  return (bytes / 1_000_000).toFixed(1);
}

/** Download a message's attachments and sort them into what the agent can be
 *  shown and what it can be handed. Pictures ride the prompt, so they are
 *  bounded by what a model accepts and are dropped when the bytes turn out not
 *  to be a picture at all. Everything else is a file: it is delivered whatever
 *  format it is, and only withheld when the download plainly didn't return the
 *  file (a messenger serves a sign-in page with a 200) or it is too big to
 *  write.
 *
 *  `uploader` is the sender the bytes are attributed to — carried per file
 *  because a coalesced read-along batch mixes several people's attachments into
 *  one turn. */
async function fetchSlackAttachments(
  gateway: SlackGateway,
  files: SlackImageFile[] | undefined,
  uploader: string,
  budget: HeldBudget,
): Promise<FetchAttachmentsResult> {
  const attachments = files ?? [];
  const pictures = attachments.filter((f) =>
    wasSentAsImage(describeSlackFile(f)),
  );
  const documents = attachments.filter(
    (f) => !wasSentAsImage(describeSlackFile(f)),
  );

  const release = await imageFetchSemaphore.acquire();
  try {
    const images: FetchedImage[] = [];
    const staged: FetchedFile[] = [];
    const failures: FetchedFailure[] = [];
    const claims: HeldClaim[] = [];

    // The picture cap is about what one prompt may carry, so it withholds the
    // pictures and nothing else: a file on the same message is written to disk,
    // never sent as bytes, and dropping it here was the silent drop this whole
    // path exists to end. One notice for the message, not one per picture — the
    // cap is a property of the message, and a dozen identical ephemerals would
    // be a wall of copy for the sender and a dozen calls at Slack.
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

    // The declared sizes above are Slack's claim and are sometimes missing, so
    // the budget is also spent as the bytes actually arrive: each download is
    // bounded by what is left of it, and pictures past the cap are withheld like
    // any other unusable attachment rather than swelling one prompt.
    let pictureBytesTaken = 0;
    for (const f of picturesOverCap ? [] : pictures) {
      const remaining = TOTAL_IMAGE_BYTES_CAP - pictureBytesTaken;
      // A picture costs the worker more than a file, not less: it is held to the
      // same turn settlement and base64 inflates it by a third on the way into
      // the prompt. Reserved on the declared size, or on the whole remaining
      // share when the sender's client did not say.
      const claim = budget.reserve(f.size || remaining);
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
          await gateway.downloadFile(f.url_private, remaining),
        );
        pictureBytesTaken += bytes.length;
        // A 2xx download is not proof it returned the file, and `image/*`
        // covers formats no harness decodes. Trust the bytes — and their
        // sniffed type, so a mislabelled upload still reaches the agent.
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
            reason: await withheldCopy(gateway, attachment, "image"),
          });
          continue;
        }
        const data = bytes.toString("base64");
        // What is retained is the encoded block, not the buffer it came from.
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
          // The ceiling handed to the download is what is *left* of the budget,
          // so the sender hears the budget itself — a residual would be a
          // number they cannot act on, and it would move with attachment order.
          reason:
            err instanceof FileTooLargeError
              ? `it is over the ${megabytes(TOTAL_IMAGE_BYTES_CAP)} MB of ` +
                "images a single message can carry."
              : `${formatError(err)}. Try resending.`,
        });
      }
    }

    let stagedBytes = 0;
    /** Why this file doesn't fit, or null. Asked twice per file: of Slack's
     *  declared size, so 200 MB is refused before it is pulled into memory, and
     *  of the bytes that actually arrived, because the declared size is the
     *  uploading client's claim like everything else on the file. */
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
      // Reserved before the download, so bytes the worker has no room for are
      // never read, and a fetch already on the wire counts against the next one —
      // which a per-message cap cannot do, nothing limiting how many messages
      // arrive at once.
      const claim = budget.reserve(f.size || MAX_FILE_BYTES);
      if (!claim) {
        failures.push({ name, kind: "file", reason: OVER_HELD_BUDGET });
        continue;
      }
      try {
        // The declared size is a claim and is sometimes missing, so the transfer
        // carries the ceiling too — this process holds the bytes.
        const bytes = Buffer.from(
          await gateway.downloadFile(f.url_private, MAX_FILE_BYTES),
        );
        const tooBig = overCap(bytes.length);
        if (tooBig) {
          claim.release();
          failures.push({ name, kind: "file", reason: tooBig });
          continue;
        }
        const attachment = classifyInboundAttachment(bytes);
        // A file's format is its own business — the agent opens it with the
        // tools it opens anything with. Only two verdicts mean the file itself
        // never arrived: nothing at all, or the markup Slack answers with when
        // it won't release a file. Markup can *be* the file (an .html, a
        // transcript), so the declared type is allowed to clear that verdict —
        // but not when the markup is recognisably a sign-in page, or when the
        // install is confirmed to lack the scope that downloads files. Both
        // matter: a login screen written down as `rows.csv` is worse than a
        // withheld file, because the agent answers from it.
        // 8 KB, not the 1 KB the classifier sniffs with: a served page's
        // <title> can sit behind a stylesheet, and the bytes are already here.
        const head = bytes.subarray(0, 8192).toString("latin1");
        const markupIsTheFile =
          mayContainMarkup(describeSlackFile(f)) &&
          !looksLikeSignInPage(head) &&
          (await canReadFiles(gateway));
        const arrived =
          bytes.length > 0 &&
          (attachment.kind !== "web_page" || markupIsTheFile);
        if (!arrived) {
          getLogger().warn(
            {
              file: name,
              claimedMimeType: f.mimetype,
              bytes: bytes.length,
              verdict: bytes.length === 0 ? "empty" : attachment.kind,
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
                : await withheldCopy(gateway, { kind: "web_page" }, "file"),
          });
          continue;
        }
        stagedBytes += bytes.length;
        claim.settle(bytes.length);
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
          // A refusal for size names the limit and does not ask for a retry —
          // resending the same file gets the same answer. Reached when Slack
          // understated the size or omitted it, so the transfer caught what the
          // declared size did not.
          // Same rule as the picture path: the copy names the cap, never
          // whatever ceiling this particular call was given.
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

/** A turn's accepted attachments — pictures to show, files to hand over — plus
 *  a line naming any that was withheld. The note goes into the prompt, not just
 *  the sender's notice: an agent that is asked about a picture it never received
 *  would otherwise answer blind, which reads as a worse failure than saying it
 *  couldn't see the file. */
type TurnAttachments = {
  images: FetchedImage[];
  files: FetchedFile[];
  withheldNote: string;
  /** Frees the worker's budget for these bytes. The turn owns it. */
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

/** Names what a failed turn went down with, so the sender knows the attachments
 *  went with it. */
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
  /** The binding (if any) for a Slack channel: agent, binding owner, and
   *  whether ambient mode is on (absent = off). */
  resolveSlackBinding(slackChannelId: string): Promise<{
    instanceName: string;
    owner: string;
    ambient?: boolean;
  } | null>;
  /** Every Slack conversation bound to the agent (#3086), in a stable order.
   *  Empty means the agent has no Slack reach at all. */
  resolveSlackChannelsByInstance(agentId: string): Promise<string[]>;
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
  /** Resolve Slack user ids to the people behind them. The agent meets people
   *  as bare `U…` ids — in speaker labels, injected history, and mentions
   *  inside message text — and has no other way to learn who they are. */
  describeUsers(
    instanceName: string,
    userIds: string[],
  ): Promise<{ users: ChannelUser[] } | { error: string }>;
  /** Whether a lookup could plausibly succeed right now — false only when the
   *  app's granted scopes are confirmed to lack `users:read`. An unreachable
   *  bot or an unprobed gateway reports true: an unknown state should never
   *  hide a tool that might in fact work. */
  supportsUserLookup(): Promise<boolean>;
  /** Who reacted to a message, and with what emoji — invisible to the agent
   *  otherwise, since nothing in the message text or injected history reveals
   *  it. Unlike describeUsers this is never cached: a reaction count is live
   *  state, not stable identity, and the point of asking is the current tally. */
  describeMessageReactions(
    instanceName: string,
    query: ReactionsQuery,
  ): Promise<MessageReactionsResult | { error: string }>;
  /** Whether a lookup could plausibly succeed right now — false only when the
   *  app's granted scopes are confirmed to lack `reactions:read`. Same
   *  fail-open rule as supportsUserLookup. */
  supportsMessageReactions(): Promise<boolean>;
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
 *  A bound conversation passes untouched; a user id opens a DM; any other
 *  channel must have the bot as a member. The one workspace bot is shared by
 *  all Agents, so its membership — governed Slack-side via /invite — is the
 *  reach boundary.
 *
 *  With no conversationId there is a default only while the Agent holds a
 *  single binding. Bound to several (#3086), the call is refused rather than
 *  posted into an arbitrary one — the same refuse-don't-guess rule the id-less
 *  `reply`/`react` follow when several turns are in flight. */
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

/** How long a turn whose relay settled with a transport-ish error stays
 *  resolvable for id-less `reply`/`react`. The runtime keeps a running prompt
 *  alive when its relay channel drops, so the harness may work on such a turn
 *  long after the worker saw it fail — up to the ACP turn ceiling, whose
 *  default this mirrors. An entry outstaying a longer configured ceiling only
 *  reopens the last-active-thread fallback, never a crash. */
export const TURN_LINGER_MS = 60 * 60_000;

/** How long a looked-up profile (or a confirmed miss) stays good. Names,
 *  titles and time zones change rarely, and an agent reading a busy channel
 *  asks about the same handful of people turn after turn. */
const USER_CACHE_TTL_MS = 10 * 60_000;

/** Concurrent `users.info` calls across all agents: the one install-wide bot
 *  shares a single Slack rate limit, and a lookup is already batched. */
const userLookupSemaphore = createSemaphore(5);

/** Reduce what the agent actually sees — `<@U123>`, `<@U123|tom>` or a bare
 *  id — to the id Slack takes. Anything else (a handle, a channel id) returns
 *  null, so a typo costs a per-id error rather than a Slack round trip. */
function normalizeSlackUserId(input: string): string | null {
  const bare = input.trim().replace(/^<@/, "").replace(/>$/, "").split("|")[0]!;
  return /^[UW][A-Z0-9]+$/i.test(bare) ? bare.toUpperCase() : null;
}

/** The granted-scope set, or null for "unknown". The port already promises
 *  null rather than a throw on a failed probe, but these checks gate the MCP
 *  session build: a rejection escaping here would cost the agent *every* tool
 *  instead of the one affordance a withheld scope backs, so an unexpectedly
 *  throwing gateway is also read as unknown. */
async function grantedScopes(gw: SlackGateway): Promise<Set<string> | null> {
  try {
    return await gw.getGrantedScopes();
  } catch {
    return null;
  }
}

/** Whether the running gateway's granted scopes are confirmed to include
 *  `users:read`. An unprobed or unreachable gateway reports true — an
 *  unknown state fails open rather than hiding a tool that might work. */
async function canLookupUsers(gw: SlackGateway): Promise<boolean> {
  const scopes = await grantedScopes(gw);
  return !scopes || scopes.has("users:read");
}

/** Whether the install can download attachments at all. Unlike the tool gates
 *  above, this one decides whether to believe a *download*: markup arriving
 *  where markup is a plausible format is the file itself only if the app could
 *  have fetched a file in the first place. Unknown scopes fail open. */
async function canReadFiles(gw: SlackGateway): Promise<boolean> {
  const scopes = await grantedScopes(gw);
  return !scopes || scopes.has("files:read");
}

/** Whether the running gateway's granted scopes are confirmed to include
 *  `reactions:read`. An unprobed or unreachable gateway reports true — an
 *  unknown state fails open rather than hiding a tool that might work. */
async function canReadReactions(gw: SlackGateway): Promise<boolean> {
  const scopes = await grantedScopes(gw);
  return !scopes || scopes.has("reactions:read");
}

/** What each scope the Slack features rely on actually buys, in the words an
 *  operator would use to describe the capability going missing. Declared here
 *  rather than read from the app manifest because the manifest describes a
 *  *fresh* install: a scope added to it later never reaches a workspace that
 *  installed earlier — the app keeps the scopes it was installed with — so the
 *  two drift apart silently, and this is the side that knows what the running
 *  features need. */
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

/** Say once, at startup, which granted permissions are missing and what stops
 *  working without them. A withheld scope otherwise has no symptom of its own:
 *  the capability simply behaves as though it were broken, and the agent is the
 *  one that looks wrong. Nothing here changes behaviour — an unknown or
 *  unreachable probe stays silent rather than guessing at a gap. */
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

/** The two Slack-dependent turn-contract inputs, resolved together. The scope
 *  probe is cached for the gateway's lifetime, but the permalink is a live
 *  `chat.getPermalink` round trip on the relay's critical path — so they run in
 *  parallel rather than back to back, and a coalesced batch (which names no
 *  single message, so renders no permalink) skips the call entirely instead of
 *  paying for a result it discards. */
async function turnContractContext(
  gw: SlackGateway,
  channel: string,
  eventTs: string,
  opts?: { batched?: boolean },
): Promise<{ canLookupUsers: boolean; permalink: string | null }> {
  const [lookup, permalink] = await Promise.all([
    canLookupUsers(gw),
    // A permalink is one decorative line of the prompt, so it must never be
    // able to fail the turn that carries it — an unanswered Slack message is
    // a far worse outcome than a contract missing its link. The port promises
    // null over a throw and Bolt honors it; this enforces the promise rather
    // than trusting every future gateway to keep it.
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
  /** Marks the agent as driven from a channel for the length of each turn, so
   *  the egress gate can refuse a request that would otherwise hold for a
   *  verdict nobody in a Slack conversation can give. Required: a missing
   *  wiring here would silently restore the stall this exists to prevent, so
   *  whether the marker does anything is the store's own business, decided
   *  where it is built. */
  attendance: ChannelTurnAttendance,
  /** Writes the files people attach into the agent's own workspace, so it can
   *  open them. Required, not optional: an unwired factory would silently
   *  restore the drop this exists to end — a file would arrive and go nowhere,
   *  which is indistinguishable from the agent ignoring it. */
  workspaceFiles: AgentWorkspaceFilesFactory,
  emit: (event: DomainEvent) => void = defaultEmit,
): SlackWorker {
  const brandShort = brand.short;
  let gateway: SlackGateway | null = null;

  /** A turn the `reply`/`react` tools can target when the agent doesn't echo
   *  ids: the thread to reply into and the message to react to. `sessionId` is
   *  filled in once the turn's session is resolved — later than the ref itself,
   *  since resolving it means waking the pod and matching the thread key — and
   *  is what lets a posted reply link back to the conversation in the UI. */
  type TurnRef = {
    channel: string;
    threadTs: string;
    eventTs: string;
    sessionId?: string;
    /** Releases this turn's channel-turn attendance marker; set by
     *  {@link beginTurn} and paired in {@link endTurn}, so concurrent turns on
     *  one agent each hold their own and the marker outlives all of them. */
    releaseAttendance?: () => void;
  };

  /** Turns currently driving the harness per agent. A single agent pod
   *  multiplexes every thread over one harness process and one MCP identity,
   *  so the outbound `reply`/`react` call carries no turn id — only the
   *  prompt-injected `threadTs` argument distinguishes them. This set is the
   *  fallback for when the agent omits it: with one candidate thread the
   *  target is unambiguous; with several, guessing would post one thread's
   *  reply into another (#2952), so the tools refuse and ask for the id the
   *  prompt already gave. A turn joins when it starts driving the harness and
   *  leaves when its prompt settles. */
  const inFlightTurns = new Map<string, Set<TurnRef>>();

  /** Turns whose relay settled with an error that says nothing about the
   *  harness: on a relay drop, a heartbeat abort or the turn ceiling the
   *  runtime keeps the running prompt alive, so the pod may still be working
   *  the turn and its late `reply`/`react` calls still arrive over the MCP
   *  path. Deleting the ref then would resolve those calls against whatever
   *  turn is live by that time — the residual #2952 cross-route. Instead the
   *  ref lingers (value + expiry) and keeps counting toward resolution until
   *  {@link TURN_LINGER_MS} passes; swept lazily, no timers. */
  const lingeringTurns = new Map<string, Map<TurnRef, number>>();

  /** The most recent turn per agent, never cleared — the last-active-thread
   *  fallback for a proactive `reply`/`react` made outside any live turn (e.g.
   *  from a scheduled session), mirroring Telegram. Consulted only when no turn
   *  is live or lingering. Addressed turns (mention, DM) advance it when
   *  they start; ambient read-along turns do not — most end silent, and a
   *  proactive reply must not target whatever channel message last drifted by.
   *  An ambient turn advances it only through engagement: when a `reply`/
   *  `react` actually lands on the turn's thread or message. */
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

  /** `harnessMayStillRun`: the turn settled on a path that says nothing about
   *  the pod (relay drop, ceiling, generic ACP error) — keep the ref lingering
   *  so the harness's late tool calls can't resolve against another thread.
   *  Settlements that prove the harness is done (success) or never ran the
   *  prompt (wake failure, agent stopped) pass false and drop the ref. */
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
    // Released even when the harness may still be running: a late request from
    // a turn whose relay dropped falls back to the ordinary hold rather than
    // being refused on the strength of a marker nothing is refreshing.
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

  /** Unexpired lingering refs for the agent, sweeping expired ones out. */
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

  /** Resolve the turn a reply/react targets when the agent passed no ids.
   *  Candidates are the live turns plus the lingering ones (either may be the
   *  caller). What must be unambiguous is the *target*, not the turn: a reply
   *  needs one thread, a react one message — so several candidates that agree
   *  on it still resolve (e.g. a retried relay of the same thread), while
   *  distinct targets refuse and the agent must name the id its prompt
   *  injected. No candidates → the last-active-thread fallback. */
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

  /** The newest live ref matching `match`, then the newest lingering one —
   *  newest first so a multi-message batch resolves to its most recent
   *  matching message, not an arbitrary older one. */
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

  /** The turn ref (live or lingering) a successful `reply`/`react` engaged,
   *  matched by the ids it actually posted with. Engagement advances the
   *  last-active-thread fallback — the one way an ambient turn ever does. */
  function noteEngagedTurn(
    instanceName: string,
    match: (ref: TurnRef) => boolean,
  ) {
    const engaged = findTurnRef(instanceName, match);
    if (engaged) lastTurn.set(instanceName, engaged);
  }

  /** Looked-up profiles keyed by user id. The directory is workspace-wide and
   *  so is the bot, so one cache serves every agent. Misses are cached too — a
   *  wrong id stays wrong, and re-asking Slack about it each turn buys nothing.
   *  Expired entries are swept lazily once the map grows past a workspace-sized
   *  handful. */
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

  /** The read-only sibling of AMBIGUOUS_THREAD_ERROR: a lookup delivers
   *  nowhere, so the "lands in the right thread" framing would misdescribe
   *  what is at stake — reading the wrong message, not posting to it. */
  const AMBIGUOUS_MESSAGE_ERROR =
    "This agent is handling more than one Slack thread right now — pass the " +
    "messageTs shown in your turn instructions so this inspects the message " +
    "you mean.";

  /** Attribution footer for a post by `instanceName`: the agent's name linked
   *  into the UI, with the id carried in the URL so the author can be recovered
   *  from injected history. `sessionId` (a turn's own session) makes the link
   *  open that conversation, so a reader can pick the thread up in the UI. The
   *  name lookup is best-effort — a lookup failure or a nameless agent degrades
   *  to the id as the (still clickable) link label. */
  async function resolveAgentFooter(
    instanceName: string,
    sessionId?: string,
  ): Promise<AgentFooter> {
    let agentName = instanceName;
    try {
      const agent = await agents().get(instanceName);
      if (agent?.name) agentName = agent.name;
    } catch {
      // best-effort — fall back to the id as the link label
    }
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

  /** The session for a thread key, preferring the channel-qualified key that
   *  every session now carries. `legacyKey` is the bare `thread_ts` sessions
   *  minted before conversations were part of the key (#3086); matching it
   *  keeps threads that were mid-conversation at upgrade time resumable instead
   *  of restarting them cold. Those old keys carry the cross-channel ambiguity
   *  the qualified key exists to remove, so they are only ever a fallback and
   *  the set drains as those threads go quiet. */
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

  /** One turn at a time per (agent, thread-session). Concurrent prompts on one
   *  session collide in the runtime's per-session queue — which silently drops
   *  a queued prompt when its relay connection tears down — and the
   *  list-then-create session match can mint two sessions for one thread key.
   *  The ambient queue already serializes read-along traffic; this lock closes
   *  the remaining routes into a session (mentions, DMs) against each other
   *  and against ambient turns. Promise-chained per key; an entry is removed
   *  once its chain drains. */
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

  /** One ACP turn against the session keyed by `threadKey`
   *  (`_meta.platform.threadTs`): wake the pod, resume the matching session
   *  (falling back to a fresh context-injected one when resume fails), or
   *  create it. Returns the assistant response; posting is the caller's. */
  async function runSessionTurn(args: {
    instanceName: string;
    threadKey: string;
    /** Built inside the turn, like the fresh prompt: a prompt can carry files
     *  that had to be written into the pod first, which needs it awake. */
    buildResumePrompt: () => Promise<string | ContentBlock[]>;
    buildFreshPrompt: () => Promise<string | ContentBlock[]>;
    onWaking?: () => void;
    onImagesDropped?: () => void;
    /** Live per-update stream for the turn (omitted → no status presentation). */
    onUpdate?: (update: PromptUpdate) => void;
    /** The session this turn ended up running on — resumed, or minted here.
     *  Called before the prompt, and again if a failed resume re-runs the turn
     *  on a fresh session, so the caller always holds the live one. */
    onSession?: (sessionId: string) => void;
    /** The resume attempt failed after it may have delivered the prompt (a
     *  relay drop mid-turn leaves the harness running it), and the turn is
     *  being re-run on a fresh session. The caller must keep the turn's ref
     *  resolvable past its own settlement. */
    onGhostTurn?: () => void;
    /** The pre-#3086 unqualified key for this thread, matched only when the
     *  qualified one finds nothing. Absent on ambient channel sessions, whose
     *  key was already channel-scoped. */
    legacyThreadKey?: string;
  }): Promise<string> {
    const platformMeta = {
      type: SessionType.ChannelSlack,
      threadTs: args.threadKey,
    };
    // The lock spans readiness, the session match, and the prompt: a second
    // turn for the same thread waits its turn instead of racing the runtime's
    // per-session queue, finds the session the first turn minted instead of
    // minting a duplicate for the same thread key, and re-verifies readiness
    // when it actually runs rather than when it queued.
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
        // Built before the `try`: a prompt that was never sent is not a turn the
        // harness may still be running, and must not be recorded as a ghost.
        const resumePrompt = await args.buildResumePrompt();
        try {
          return await acp.sendPrompt(resumePrompt, {
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
    /** Always null on channel relays — no platform identity is resolved for
     *  the sender; attribution rides `externalActorId`. */
    actorSub: string | null;
    externalActorId?: string;
    slackUserId: string;
    teamId?: string;
    images: FetchedImage[];
    files: FetchedFile[];
  }) {
    if (!gateway) return;
    const gw = gateway;
    const { instanceName } = ctx;
    const threadKey = slackThreadKey(ctx.channel, ctx.threadTs);

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

    // Delivered once, whichever prompt ends up carrying them and however many
    // times the turn is re-run.
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
            ctx.hasThread ? ctx.threadTs : undefined,
            `Couldn't use attached file '${f.name}': ${f.reason}`,
          ),
      }));

    let ghostTurn = false;
    const runTurn = async () => {
      // The response is not posted — the agent replies via the `reply` tool
      // during the turn. We only need to know the turn completed.
      await runSessionTurn({
        instanceName,
        threadKey,
        legacyThreadKey: ctx.threadTs,
        buildResumePrompt: async () => {
          const delivered = await deliverFiles();
          return framePrompt({
            contract,
            text: ctx.text + delivered.withheldNote,
            images: ctx.images,
            files: delivered.files,
          });
        },
        buildFreshPrompt: () =>
          buildThreadPrompt(gw, ctx, contract, { deliver: deliverFiles }),
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
      // Wake timeouts get human copy mapped from the classified cause;
      // everything else keeps the raw path (out of scope here).
      const text = isAgentStoppedError(err)
        ? `This agent was stopped by its owner — it stays stopped until the owner wakes it (or its next schedule fires).${renderTurnFiles(ctx)}`
        : isAgentWakeTimeoutError(err)
          ? `${wakeFailureUserCopy(err.failure)}${renderTurnFiles(ctx)}`
          : `Error: ${formatError(err)}.${renderTurnFiles(ctx)}`;
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
      // "acp-error" is the settlement class that says nothing about the pod —
      // the harness may still be running this turn (so may a ghost run left by
      // a failed resume attempt); keep the ref lingering for those.
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
    /** `deliver` is a thunk, not a value: history injection reads Slack and can
     *  fail, and a prompt that never gets built should not have left the
     *  sender's file sitting in the workspace unreferenced. */
    opts?: { guidance?: string; deliver?: () => Promise<TurnDelivery> },
  ): Promise<string | ContentBlock[]> {
    const { lines, hasAgentAuthored } = await getContextMessages(
      gw,
      ctx.channel,
      ctx.eventTs,
      ctx.instanceName,
      ctx.hasThread ? ctx.threadTs : undefined,
    );
    const legend = hasAgentAuthored
      ? historyLegend(await canLookupUsers(gw))
      : undefined;
    const delivered = await opts?.deliver?.();
    return framePrompt({
      contract,
      guidance: opts?.guidance,
      context: lines,
      contextLegend: legend,
      text: ctx.text + (delivered?.withheldNote ?? ""),
      images: ctx.images,
      files: delivered?.files ?? [],
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
        // `login`/`logout` (identity linking) stay working but aren't
        // advertised here — bind/unbind are the primary command surface.
        await ack({
          text: `Usage: \`/${brandShort} bind\`, \`/${brandShort} unbind\`, or \`/${brandShort} ambient on|off\``,
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
    );
    for (const f of failures) {
      await ephemeral(
        event.channel,
        slackUserId,
        event.threadTs,
        `Couldn't use attached ${f.plural ? `${f.kind}s` : f.kind} '${f.name}': ${f.reason}`,
      );
    }
    return {
      images,
      files,
      withheldNote: renderWithheldNote(failures),
      release,
    };
  }

  /** Hand a turn's files to the agent: written into its workspace under the
   *  conversation they arrived in, then linked from the prompt. This runs inside
   *  the turn rather than at intake because only a woken pod can be written to,
   *  and it runs at most once per turn — a resume that fails and re-runs on a
   *  fresh session must not deliver second copies. A file that can't be
   *  delivered is reported like an unreadable picture: to the sender where the
   *  surface has a voice, and always to the agent, so it never answers as though
   *  it had the file. */
  async function deliverTurnFiles(opts: {
    agentId: string;
    /** The turn's conversation, which the files land in a directory of. */
    conversation: string;
    files: FetchedFile[];
    onWithheld?: (failure: FetchedFailure) => Promise<void>;
  }): Promise<TurnDelivery> {
    if (opts.files.length === 0) return { files: [], withheldNote: "" };
    const delivered: DeliveredFile[] = [];
    const failures: FetchedFailure[] = [];
    // Nothing in here may reject: the prompt is built from what this returns,
    // so a throw would lose the sender's question along with the file — and the
    // turn would be re-run as though the harness might already be answering it.
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
          // Anyone the channel admits can hand an agent a file, so who put what
          // into its workspace belongs in the audit trail.
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

    const fetched = await fetchTurnAttachments(event, slackUserId);
    if (fetched === null) return;
    try {
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
        files: fetched.files,
        // A 1:1 DM has exactly one human speaker, so labelling the prompt with
        // their Slack mention is redundant — keep the private DM prompt clean.
        speakerLabel: !opts.directMessage,
      });
    } finally {
      // The turn is awaited to settlement, wake included, so this is where these
      // bytes stop being held — every exit from the relay included.
      fetched.release();
    }
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

  // The binding is the authorization — anyone Slack admits to the channel
  // drives the agent under the agent's credentials.
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
    files: FetchedFile[];
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
      files: args.files,
    });
  }

  // Ambient turns stay out of the channel's way: no reaction, no wake
  // notices, and failures are logged, never posted — nobody summoned the
  // agent, so there is nothing to apologize for in-channel.
  async function relayAmbientTurn(args: {
    instanceName: string;
    channel: string;
    /** `_meta.platform.threadTs` session key: the channel-qualified thread key
     *  for thread replies, the synthetic ambient key for top-level channel
     *  flow. Not a Slack id — see `replyThreadTs` for that. */
    threadKey: string;
    /** The thread's pre-#3086 unqualified session key, for resuming a thread
     *  that was already going at upgrade time. Absent top-level. */
    legacyThreadKey?: string;
    /** Where a reply (if the agent chimes in) is threaded by default: the
     *  thread's ts in a thread, the batch's newest message top-level. */
    replyThreadTs: string;
    /** The triggering message ts (the batch's newest), excluded from
     *  injected context. */
    eventTs: string;
    hasThread: boolean;
    /** The coalesced batch, oldest first — speaker-labelled text plus each
     *  message's own ts, so a multi-message turn can target per message. */
    messages: Array<{ text: string; eventTs: string }>;
    images: FetchedImage[];
    files: FetchedFile[];
    /** Names of attachments this turn could not carry — over the batch's share,
     *  or dropped at intake. Not delivered, but named to the agent: a file it can
     *  see in the channel and was never handed is exactly what it must not answer
     *  as though it had. */
    droppedFiles: string[];
    externalActorId: string;
  }) {
    if (!gateway) return;
    const gw = gateway;

    // A reply (if the agent chimes in) threads under the message it answers; a
    // react targets that message. No 👀 ack and no status — ambient stays out
    // of the channel's way until the agent decides to speak. Every batched
    // message registers as its own target: in a thread they share the reply
    // thread, but a multi-message top-level batch has no single "the" thread —
    // its prompt tags each message with its ts, an id-less reply refuses, and
    // an answer to an older batched message threads under that message instead
    // of silently attaching to the newest one.
    const multi = args.messages.length > 1;
    const turnRefs: TurnRef[] = args.messages.map((m) => ({
      channel: args.channel,
      threadTs: args.hasThread ? args.replyThreadTs : m.eventTs,
      eventTs: m.eventTs,
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

    // Read-along turns post nothing, so a file that can't be delivered is told
    // only to the agent — nobody summoned it, and an ephemeral would ping
    // someone who never asked.
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
        ...(args.legacyThreadKey
          ? { legacyThreadKey: args.legacyThreadKey }
          : {}),
        buildResumePrompt: async () => {
          const delivered = await deliverFiles();
          return framePrompt({
            contract,
            guidance,
            text: text + delivered.withheldNote,
            images: args.images,
            files: delivered.files,
          });
        },
        buildFreshPrompt: async () =>
          buildThreadPrompt(
            gw,
            {
              instanceName: args.instanceName,
              channel: args.channel,
              // History injection reads Slack, so this is the thread's real
              // `thread_ts` (only consulted when `hasThread`), never the
              // session key — the two diverged once keys became qualified.
              threadTs: args.replyThreadTs,
              eventTs: args.eventTs,
              text,
              hasThread: args.hasThread,
              images: args.images,
            },
            contract,
            { guidance, deliver: deliverFiles },
          ),
        // Every message in a coalesced batch runs on the one session, so they
        // all link back to the same conversation.
        onSession: (sessionId) => {
          for (const ref of turnRefs) ref.sessionId = sessionId;
        },
        onGhostTurn: () => {
          ghostTurn = true;
        },
      });

    try {
      // Registered inside the try (like the owner path) so a throw can never
      // leak a live entry — live refs, unlike lingering ones, never expire.
      // Read-along turns never advance the last-active-thread fallback at
      // start; engagement (an actual reply/react) is what advances it.
      for (const ref of turnRefs) {
        beginTurn(args.instanceName, ref, { advanceLastTurn: false });
      }
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
      // Same settlement classes as the owner path: an "acp-error" (or a ghost
      // run left by a failed resume attempt) may leave the harness working
      // this turn, so its refs must stay resolvable.
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
    /** Speaker-labelled message text. */
    text: string;
    eventTs: string;
    slackUserId: string;
    images: FetchedImage[];
    files: FetchedFile[];
    /** Frees the worker's budget for this message's bytes; called when the batch
     *  carrying it settles. */
    release: () => void;
  };

  /** The files of a coalesced batch, up to what one turn may carry, plus the
   *  overflow. Each message was capped on its own way in, but a burst coalesces
   *  several of them into one prompt. The overflow is named to the agent rather
   *  than vanishing — a file the sender can see in the channel that the agent was
   *  never given is the failure this whole path exists to end. */
  function batchFiles(batch: AmbientPendingMessage[]): {
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
          "slack.ambient_file.over_batch_cap",
        );
        dropped.push(f);
        continue;
      }
      bytes += f.bytes.length;
      kept.push(f);
    }
    return { kept, dropped };
  }

  /** What this worker may hold in inbound attachment bytes at once, across every
   *  path. A per-message cap says nothing about how many messages are in flight,
   *  and the expensive stretch is the wait for a cold pod: bytes are downloaded
   *  before the turn and held until it settles, so a mention and a read-along
   *  message cost the same memory for the same duration. Nothing gates how many
   *  arrive at once — Bolt delivers each event as it comes — and this process runs
   *  the channel workers for the whole install, so the budget belongs to the
   *  worker rather than to any one queue or turn. Past it an attachment is
   *  withheld and said so; the message itself still relays. */
  const HELD_BYTES_CAP = 3 * TOTAL_FILE_BYTES_CAP;

  /** Bytes charged to attachments this worker is holding: from the moment one is
   *  downloaded until the turn carrying it settles, whichever path it arrived on.
   *  Every charge is paired with a release in a `finally`, so the two cannot come
   *  apart, and a charge that outlives its turn would mean bytes that are still
   *  resident anyway. */
  let heldBytes = 0;

  /** The budget the download loops reserve against. Passed in rather than reached
   *  for, so a loop stays a function of what it is given. */
  const heldBudget: HeldBudget = {
    reserve: (bytes) => {
      if (bytes > 0 && heldBytes + bytes > HELD_BYTES_CAP) return null;
      // Reserved on admission, so a fetch that is admitted is already counted
      // for the whole time it holds the bytes — including the download itself.
      let held = bytes;
      heldBytes += held;
      return {
        settle: (actual) => {
          if (actual >= held) return;
          heldBytes -= held - actual;
          held = actual;
        },
        release: () => {
          heldBytes = Math.max(0, heldBytes - held);
          held = 0;
        },
      };
    },
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
        try {
          const last = batch.at(-1);
          if (!last) continue;
          // Re-resolve: the binding may have been unbound, dialed back to
          // mentions-only, or rebound to a different owner while the batch
          // waited — the ToU gate must hold against the owner whose
          // credentials actually run the turn, so it is re-checked here too.
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
          // A thread's read-along resumes the thread's own session (the same key
          // a mention there resumes) and threads its reply back into the thread;
          // top-level flow uses the channel's rolling ambient session and opens
          // a reply thread under the batch's newest message.
          const inThread = queue.threadTs !== null;
          const { kept, dropped } = batchFiles(batch);
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
            files: kept,
            droppedFiles: dropped.map((f) => f.name),
            externalActorId: last.slackUserId,
          });
        } finally {
          // The batch's buffers die with this iteration, so its charge does too.
          for (const msg of batch) msg.release();
        }
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

  // Ambient inbound: a channel message that mentioned nobody. Only bindings
  // with ambient on relay it; everything else drops silently — the sender did
  // not address the agent, so there is nothing to explain.
  async function handleChannelMessage(event: SlackChannelMessageEvent) {
    if (!gateway) return;
    const slackUserId = event.user;
    if (!slackUserId) return;

    const binding = await channelRegistry.resolveSlackBinding(event.channel);
    if (!binding || !binding.ambient) return;

    // The binding owner's ToU acceptance gates ambient turns like any shared
    // turn — but silently: an ephemeral would ping people who never asked.
    if (!(await isTermsAccepted(binding.owner))) {
      getLogger().debug(
        { agentId: binding.instanceName, channelId: event.channel },
        "slack.ambient_turn.skipped_terms",
      );
      return;
    }

    // Attachments ride along when they fit; ambient turns never post error
    // ephemerals, so oversized or unfetchable ones just drop — but the agent is
    // still told, in the prompt, that one was withheld.
    const { images, files, failures, release } = await fetchSlackAttachments(
      gateway,
      event.files,
      slackUserId,
      heldBudget,
    );
    const withheldNote = renderWithheldNote(failures);

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
    const text = `<@${slackUserId}>: ${event.text}${withheldNote}`;
    enqueueAmbient(event.channel, event.threadTs ?? null, {
      text,
      eventTs: event.ts,
      slackUserId,
      images,
      files,
      release,
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

      // The bound conversations lead (agents treat chats[0] as their home
      // surface), then every other channel the bot is a member of.
      // Discovery failure (bot down, missing scopes) degrades to the
      // bound conversations alone. ensureGateway: like outbound posts, a
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
      // The binding is the Agent's membership card into the workspace: no
      // binding, no Slack outbound — even though the workspace bot exists.
      const boundChannelIds =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (boundChannelIds.length === 0) {
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
        boundChannelIds,
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
        // An explicit id that names a live/lingering turn follows that turn's
        // conversation too — batch turns must pass ids, and the rebind
        // protection would otherwise skip exactly them.
        const id = threadTs;
        turn = findTurnRef(instanceName, (ref) => ref.threadTs === id);
      }
      // A threadTs is only meaningful inside its own conversation — post where
      // the resolved turn ran, not wherever the agent is bound *now*, or a
      // mid-turn rebind would redirect the reply into the new channel.
      const target = await resolveOutboundTarget(
        gw,
        boundChannelIds,
        args.conversationId ?? turn?.channel,
      );
      if ("error" in target) return target;

      // The reply carries the turn's session, so its footer link opens this
      // conversation in the UI rather than the agent's chat at large.
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
        // Like reply: the message lives in the turn's conversation, not
        // necessarily the currently-bound one.
        turnChannel = turn.ref.channel;
      } else {
        const id = messageTs;
        turnChannel = findTurnRef(
          instanceName,
          (ref) => ref.eventTs === id,
        )?.channel;
      }
      // Slack wants the bare short name; tolerate :colons: or an accidental
      // leading/trailing space.
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
        // Bad emoji name, already_reacted, or a missing scope surface to the
        // agent as a tool error rather than aborting its turn.
        return { error: formatError(err) };
      }
    },

    async describeUsers(instanceName: string, userIds: string[]) {
      // Same gate as every outbound affordance: the binding is the Agent's
      // membership card into the workspace, so an unbound Agent reads no
      // directory even though the workspace bot exists.
      const boundChannelIds =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (boundChannelIds.length === 0)
        return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };

      // One entry per person: the same id twice, or in two spellings, is one
      // lookup and one result. Unparseable input keeps its raw spelling so the
      // agent can see which of its arguments was wrong.
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
            // A rate limit or a missing scope fails this id, not the batch.
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
      // Same gate as every outbound affordance: the binding is the Agent's
      // membership card into the workspace.
      const boundChannelIds =
        await channelRegistry.resolveSlackChannelsByInstance(instanceName);
      if (boundChannelIds.length === 0)
        return { error: "no channel connected" };
      const gw = await ensureGateway();
      if (!gw) return { error: "slack bot not running" };

      let messageTs = query.messageTs;
      let turnChannel: string | undefined;
      if (!messageTs) {
        // Message-level target, same granularity as react.
        const turn = resolveTurn(instanceName, "react");
        if ("ambiguous" in turn) return { error: AMBIGUOUS_MESSAGE_ERROR };
        if ("none" in turn) {
          return {
            error: "no message to inspect — pass messageTs",
          };
        }
        messageTs = turn.ref.eventTs;
        // Like react: the message lives in the turn's conversation, not
        // necessarily the currently-bound one.
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
        // Return the resolved target, not just the (often-omitted) request —
        // the caller audits by these, and an agent that omitted both still
        // learns which message and chat it actually asked about.
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
