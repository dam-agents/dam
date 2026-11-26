import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";
import {
  DISMISS_DAYS,
  cardMetadata,
  lateAllowReply,
  ownerCard,
  rowOffersRule,
  rowWaits,
  threadLine,
  unlinkedCard,
  type CardRow,
  type OwnerCardKind,
  type OwnerAnswer,
  type OwnerCardThread,
  type OwnerRequestView,
  type ThreadLineState,
} from "../domain/owner-request-cards.js";
import {
  answerFromFields,
  questionCard,
} from "../domain/owner-question-card.js";
import type {
  OwnerCard,
  OwnerCardItem,
  OwnerRequestCardsRepository,
} from "./owner-request-cards-repository.js";
import type {
  SlackGateway,
  SlackPrivateReply,
  SlackWorkspace,
} from "./slack-gateway.js";

export interface OwnerRequestPortsForSlack {
  view(id: string): Promise<Omit<OwnerRequestView, "agentName"> | null>;
  refuseUnreachable(id: string): Promise<boolean>;
  anyoneWaits(id: string): Promise<boolean>;
  waiting(input: { since: Date; limit: number }): Promise<string[]>;
  releaseTurnWaits(
    agentId: string,
    release: { turnStartedAt: number; sessionIds: string[] },
  ): Promise<void>;
  decide(input: {
    requestId: string;
    answer: DecidedAnswer;
    ownerSub: string;
    slackUserId: string;
    teamId: string;
  }): Promise<DecideResult>;
  cards: OwnerRequestCardsRepository;
}

export type DecidedAnswer = Exclude<OwnerAnswer, "dismiss">;

export type DecideResult = "applied" | "not-actionable" | "conflict";

// UNIT_BOUNDARY_DESCRIPTION: what the question cards read of sub-agent questions, by the asking run's id: the question as it stands, the questions that still wait, and the owner's answer through the delegation control the web uses.
export interface OwnerQuestionPortsForSlack {
  view(runId: string): Promise<{
    runId: string;
    invocationId: string;
    label: string | null;
    driverAgentId: string;
    ownerSub: string;
    question: string;
    options: string[];
    defaultOption: string;
    askedAt: string;
    answerBy: string;
    status: "asking" | "answered" | "stopped";
    answer: { text: string; by: "owner" | "default" } | null;
  } | null>;
  open(limit: number): Promise<string[]>;
  answer(input: {
    runId: string;
    text: string;
    ownerSub: string;
  }): Promise<"applied" | "not-actionable">;
}

type QuestionData = NonNullable<
  Awaited<ReturnType<OwnerQuestionPortsForSlack["view"]>>
>;

export interface AddressedTurnThread {
  turnKey: string;
  channelId: string;
  threadTs: string;
  teamId: SlackWorkspace;
  startedBy: string | null;
  askers: string[];
}

const REPOST_AFTER_MS = 5 * 60 * 1000;
const BACKGROUND_DELAY_MS = 60 * 1000;

function startOfUtcDay(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
const LASTING_POST_ERRORS = [
  "missing_scope",
  "not_allowed_token_type",
  "invalid_auth",
  "account_inactive",
  "token_revoked",
  "cannot_dm_bot",
  "user_not_found",
  "channel_not_found",
  "not_in_channel",
];

function lasting(err: unknown): boolean {
  const text = formatError(err);
  return LASTING_POST_ERRORS.some((code) => text.includes(code));
}

// UNIT_BOUNDARY_DESCRIPTION: places owner requests on cards in the owner's Slack DM and keeps the line in each waiting thread true. It runs on the channels leader, and one lock per owner orders every placement and edit, so two requests that arrive together join one card. A `turn` request joins the agent's turn card and names the thread it came from; a `background` request joins the agent's background card, a network request under the row of its host and a web search under the row of all searches, and gets no row while the owner's dismissal of that agent and host lasts; a raise moves a request from the background card to the turn card. A card's row is written before its post; a join from a thread the card does not name yet, or a background row that starts to wait, posts the card again when the old post is more than five minutes old, so Slack notifies the owner once more, and any other join edits it. A click answers every request its button names, as the owner; Dismiss also denies the row's waiting requests once and writes the dismissal. A turn card that cannot post for a lasting reason denies its waiting requests at once, so no thread waits for a card that never comes. The line in each thread says that the agent asked its owner while a request waits, that the agent went on without the step while one is still pending, and that the wait ended once every request settled.
export function createSlackOwnerRequests(deps: {
  ports: OwnerRequestPortsForSlack;
  gateway: () => Promise<SlackGateway | null>;
  slackLinksOf: (
    ownerSub: string,
  ) => Promise<
    ReadonlyArray<{ externalUserId: string; teamId: string | null }>
  >;
  workspaces: () => Promise<SlackWorkspace[]>;
  hasScope: (
    gw: SlackGateway,
    teamId: SlackWorkspace,
    scope: string,
  ) => Promise<boolean>;
  reachOf: (agentId: string) => Promise<"ok" | "unlinked" | "muted">;
  agentName: (agentId: string) => Promise<string>;
  ownerName: (agentId: string, teamId: SlackWorkspace) => Promise<string>;
  addressedTurns: (agentId: string) => AddressedTurnThread[];
  ownerSentBy: (slackUserId: string, ownerSub: string) => Promise<boolean>;
  subOf: (slackUserId: string) => Promise<string | null>;
  ephemeral: (
    channel: string,
    user: string,
    threadTs: string | undefined,
    text: string,
    teamId: SlackWorkspace,
  ) => Promise<void>;
  userName: (sub: string) => Promise<string | null>;
  holdWindowMs: number;
  ownerActive: (ownerSub: string) => Promise<boolean>;
  networkSettingsUrl: (agentId: string) => string;
  questions?: OwnerQuestionPortsForSlack;
  appUrl: string;
}) {
  const { cards } = deps.ports;
  let sweeping = false;
  const locks = new Map<string, Promise<unknown>>();
  const linedTurns = new Set<string>();

  function withOwnerLock<T>(ownerSub: string, run: () => Promise<T>) {
    const prev = locks.get(ownerSub) ?? Promise.resolve();
    const next = prev.then(run, run);
    const settled = next.then(
      () => {},
      () => {},
    );
    locks.set(ownerSub, settled);
    void settled.then(() => {
      if (locks.get(ownerSub) === settled) locks.delete(ownerSub);
    });
    return next;
  }

  async function rowsOf(card: OwnerCard): Promise<CardRow[]> {
    const rows: CardRow[] = [];
    for (const item of await cards.items(card.id)) {
      if (item.requestKind !== "approval") continue;
      const view = await deps.ports.view(item.requestId);
      if (!view) continue;
      const waits =
        view.status === "pending"
          ? await deps.ports.anyoneWaits(view.id).catch(() => true)
          : false;
      const answeredHere = item.state === "answered";
      const decider = view.decidedBy;
      const deciderName =
        view.status === "resolved" &&
        !answeredHere &&
        decider !== null &&
        decider !== view.ownerSub &&
        !decider.startsWith("system:")
          ? await deps.userName(decider).catch(() => null)
          : null;
      rows.push({
        view: { ...view, agentName: await deps.agentName(view.agentId) },
        nobodyWaits: !waits,
        dismissed: item.state === "dismissed",
        answeredHere,
        deciderName,
      });
    }
    return rows;
  }

  async function workspaceLinks(ownerSub: string) {
    const active = await deps.workspaces();
    const links = await deps.slackLinksOf(ownerSub);
    return links.flatMap((link) => {
      const teamId =
        link.teamId ?? (active.length === 1 ? active[0] : undefined);
      return teamId !== undefined && active.includes(teamId)
        ? [{ userId: link.externalUserId, teamId }]
        : [];
    });
  }

  async function renderCard(card: OwnerCard) {
    const rows = await rowsOf(card);
    return ownerCard({
      kind: card.kind,
      agentName: await deps.agentName(card.agentId),
      threads: card.threads,
      rows,
      appUrl: deps.appUrl,
      manyHosts:
        card.kind === "background"
          ? {
              hosts: await cards
                .hostsBlockedSince({
                  ownerSub: card.ownerSub,
                  agentId: card.agentId,
                  since: startOfUtcDay(),
                })
                .catch(() => 0),
              settingsUrl: deps.networkSettingsUrl(card.agentId),
            }
          : null,
    });
  }

  async function questionViewOf(runId: string): Promise<QuestionData | null> {
    return deps.questions ? deps.questions.view(runId).catch(() => null) : null;
  }

  async function renderQuestion(card: OwnerCard) {
    const [item] = await cards.items(card.id);
    if (!item) return null;
    const q = await questionViewOf(item.requestId);
    if (!q) return null;
    return questionCard({
      runId: q.runId,
      subAgentName: q.label ?? (await deps.agentName(q.invocationId)),
      driverName: await deps.agentName(q.driverAgentId),
      question: q.question,
      options: q.options,
      defaultOption: q.defaultOption,
      answerBy: q.answerBy,
      status: q.status,
      answer: q.answer,
      answeredHere: item.state === "answered",
    });
  }

  async function show(
    card: OwnerCard,
    link: { userId: string; teamId: SlackWorkspace },
    repost: boolean,
  ): Promise<"posted" | "edited" | "failed" | "unreachable"> {
    const gw = await deps.gateway();
    if (!gw) return "failed";
    const rendered =
      card.kind === "question"
        ? await renderQuestion(card)
        : await renderCard(card);
    if (!rendered) return "failed";
    const metadata = cardMetadata(card.id);
    try {
      if (card.messageTs && card.dmChannel && !repost) {
        await gw.updateMessage({
          channel: card.dmChannel,
          ts: card.messageTs,
          ...rendered,
          metadata,
          teamId: link.teamId,
        });
        await cards.touch(card.id);
        return "edited";
      }
      if (!(await deps.hasScope(gw, link.teamId, "im:write")))
        return "unreachable";
      const channel =
        card.dmChannel ??
        (await gw.openDirectMessage(link.userId, link.teamId));
      if (card.messageTs && card.dmChannel)
        await gw
          .deleteMessage(card.dmChannel, card.messageTs, link.teamId)
          .catch(() => false);
      const posted = await gw.postMessage({
        channel,
        ...rendered,
        metadata,
        teamId: link.teamId,
        unfurlLinks: false,
        unfurlMedia: false,
      });
      if (!posted) return "failed";
      await cards.setPosted(card.id, {
        dmChannel: channel,
        messageTs: posted.ts,
        postedAt: new Date(),
      });
      card.dmChannel = channel;
      card.messageTs = posted.ts;
      getLogger().info(
        {
          card: card.id,
          kind: card.kind,
          agentId: card.agentId,
          teamId: link.teamId,
          blocks: rendered.blocks.length,
          repost,
        },
        "owner_request.card_posted",
      );
      return "posted";
    } catch (err) {
      getLogger().warn(
        { card: card.id, teamId: link.teamId, error: formatError(err) },
        "owner_request.card_post_failed",
      );
      return lasting(err) ? "unreachable" : "failed";
    }
  }

  function threadsWith(
    card: OwnerCard,
    turns: AddressedTurnThread[],
    teamId: SlackWorkspace,
  ): { threads: OwnerCardThread[]; added: boolean } {
    const threads = [...card.threads];
    let added = false;
    for (const turn of turns) {
      if (turn.teamId !== teamId) continue;
      const known = threads.find(
        (t) => t.channelId === turn.channelId && t.threadTs === turn.threadTs,
      );
      if (known) {
        known.askers = [...new Set([...known.askers, ...turn.askers])];
        continue;
      }
      threads.push({
        channelId: turn.channelId,
        threadTs: turn.threadTs,
        teamId: turn.teamId,
        startedBy: turn.startedBy,
        startedByName: null,
        askers: turn.askers,
        lineTs: null,
        releasedAt: null,
        wentOnAt: null,
      });
      added = true;
    }
    return { threads, added };
  }

  async function lineStateOf(card: OwnerCard): Promise<ThreadLineState> {
    const rows = (await rowsOf(card)).filter(
      (row) => row.view.status === "pending",
    );
    if (rows.length === 0) return { kind: "ended" };
    if (rows.some((row) => !row.nobodyWaits)) return { kind: "asked" };
    const until = rows
      .map((row) => row.view.expiresAt)
      .sort()
      .at(-1)!;
    return { kind: "went-on", until };
  }

  async function postLines(card: OwnerCard, ownerSub: string) {
    const gw = await deps.gateway();
    if (!gw) return;
    const agentName = await deps.agentName(card.agentId);
    const ownerName = await deps.ownerName(card.agentId, card.teamId);
    const turns = deps.addressedTurns(card.agentId);
    let changed = false;
    for (const turn of turns) {
      if (turn.teamId !== card.teamId || linedTurns.has(turn.turnKey)) continue;
      if (turn.channelId === card.dmChannel) continue;
      linedTurns.add(turn.turnKey);
      const release = {
        teamId: turn.teamId,
        channelId: turn.channelId,
        threadTs: turn.threadTs,
      };
      const line = threadLine({
        agentName,
        ownerName,
        state: { kind: "asked" },
        release,
      });
      try {
        const posted = await gw.postMessage({
          channel: turn.channelId,
          threadTs: turn.threadTs,
          ...line,
          metadata: cardMetadata(card.id),
          teamId: turn.teamId,
        });
        const thread = card.threads.find(
          (t) => t.channelId === turn.channelId && t.threadTs === turn.threadTs,
        );
        if (posted && thread) {
          thread.lineTs = posted.ts;
          changed = true;
        }
      } catch (err) {
        getLogger().warn(
          { card: card.id, channelId: turn.channelId, error: formatError(err) },
          "owner_request.line_post_failed",
        );
      }
      if (
        turn.startedBy &&
        card.dmChannel &&
        card.messageTs &&
        (await deps.ownerSentBy(turn.startedBy, ownerSub).catch(() => false))
      )
        await deps
          .ephemeral(
            turn.channelId,
            turn.startedBy,
            turn.threadTs,
            `Your card for this request: https://slack.com/app_redirect?channel=${card.dmChannel}&message_ts=${card.messageTs}`,
            turn.teamId,
          )
          .catch(() => {});
    }
    if (changed) await cards.setThreads(card.id, card.threads);
  }

  async function refreshLines(card: OwnerCard) {
    const gw = await deps.gateway();
    if (!gw) return;
    const state = await lineStateOf(card);
    const agentName = await deps.agentName(card.agentId);
    const ownerName = await deps.ownerName(card.agentId, card.teamId);
    let changed = false;
    for (const thread of card.threads) {
      if (!thread.lineTs) continue;
      const line = threadLine({
        agentName,
        ownerName,
        state,
        release: {
          teamId: thread.teamId,
          channelId: thread.channelId,
          threadTs: thread.threadTs,
        },
      });
      await gw
        .updateMessage({
          channel: thread.channelId,
          ts: thread.lineTs,
          ...line,
          metadata: cardMetadata(card.id),
          teamId: thread.teamId,
        })
        .catch((err: unknown) =>
          getLogger().warn(
            { card: card.id, error: formatError(err) },
            "owner_request.line_edit_failed",
          ),
        );
      if (state.kind === "went-on" && !thread.wentOnAt) {
        thread.wentOnAt = new Date().toISOString();
        changed = true;
      }
      if (state.kind === "asked" && thread.wentOnAt) {
        thread.wentOnAt = null;
        changed = true;
      }
    }
    if (changed) await cards.setThreads(card.id, card.threads);
  }

  const FINAL_STATES: ReadonlySet<string> = new Set([
    "settled",
    "answered",
    "dismissed",
  ]);
  const DAY_MS = 24 * 60 * 60 * 1000;

  type ItemOutcome = "answered" | "settled" | "dismissed";

  function settledWhere(
    view: Omit<OwnerRequestView, "agentName">,
    outcome: ItemOutcome,
  ): "slack" | "app" | "expiry" | "system" {
    if (outcome !== "settled") return "slack";
    if (view.status === "expired") return "expiry";
    return view.decidedBy?.startsWith("system:") ? "system" : "app";
  }

  async function postLateAllow(
    card: OwnerCard,
    thread: OwnerCardThread,
    view: Omit<OwnerRequestView, "agentName">,
  ): Promise<void> {
    const gw = await deps.gateway();
    if (!gw) return;
    const decided = view.resolvedAt ? Date.parse(view.resolvedAt) : Date.now();
    const reply = lateAllowReply({
      ownerName: await deps.ownerName(card.agentId, card.teamId),
      askers: thread.askers,
      askBy:
        view.verdict === "allow_once"
          ? new Date(decided + deps.holdWindowMs).toISOString()
          : null,
    });
    await gw
      .postMessage({
        channel: thread.channelId,
        threadTs: thread.threadTs,
        ...reply,
        metadata: cardMetadata(card.id),
        teamId: thread.teamId,
      })
      .catch((err: unknown) =>
        getLogger().warn(
          { card: card.id, error: formatError(err) },
          "owner_request.late_allow_failed",
        ),
      );
  }

  async function applyCloseRule(card: OwnerCard): Promise<void> {
    if (card.kind === "background" || card.kind === "question") return;
    const rows = await rowsOf(card);
    if (rows.some((row) => rowWaits(row.view))) return;
    if (card.kind === "turn") {
      await cards.seal(card.id);
      if (rows.some(rowOffersRule)) return;
    }
    await cards.close(card.id);
  }

  // UNIT_BOUNDARY_DESCRIPTION: settles one request's items on every card that holds them, under the owner's lock: the item's state, the card drawn again, the thread lines, the reply after a late allow, one log line, and the close rule. An item in a final state is left alone, so a click and the settle event never both edit a card; a card that cannot be edited keeps the item's old state, so the sweep tries again.
  async function settleItems(
    view: Omit<OwnerRequestView, "agentName">,
    outcome: ItemOutcome,
  ): Promise<void> {
    const links = await workspaceLinks(view.ownerSub);
    const allowed =
      view.status === "resolved" &&
      (view.verdict === "allow_once" || view.verdict === "allow");
    for (const card of await cards.cardsOfRequest(view.id)) {
      const item = (await cards.items(card.id)).find(
        (it) => it.requestId === view.id,
      );
      if (!item || FINAL_STATES.has(item.state)) continue;
      const next: OwnerCardItem["state"] =
        outcome === "settled" &&
        view.status === "expired" &&
        (view.kind === "ext_authz" || view.kind === "web_search")
          ? "rule"
          : outcome;
      if (item.state === next) continue;
      const lateThreads =
        card.kind === "turn" && allowed && item.state === "waiting"
          ? card.threads.filter((t) => t.lineTs !== null && t.wentOnAt !== null)
          : [];
      await cards.setItemState(card.id, view.id, next);
      const link = links.find((l) => l.teamId === card.teamId);
      if (link && card.messageTs) {
        const shown = await show(card, link, false);
        if (shown === "failed" || shown === "unreachable") {
          await cards.setItemState(card.id, view.id, item.state);
          continue;
        }
      }
      if (card.kind === "turn") {
        await refreshLines(card);
        for (const thread of lateThreads)
          await postLateAllow(card, thread, view);
      }
      getLogger().info(
        {
          card: card.id,
          kind: card.kind,
          approvalId: view.id,
          settled: view.status === "expired" ? "expired" : view.verdict,
          where: settledWhere(view, outcome),
          ...(card.kind === "turn"
            ? {
                waited: card.threads.some((t) => t.wentOnAt === null),
                released: card.threads.some((t) => t.releasedAt !== null),
                lateAllow: lateThreads.length > 0,
              }
            : {}),
          delayMs: card.postedAt ? Date.now() - card.postedAt.getTime() : null,
        },
        "owner_request.card_settled",
      );
      await applyCloseRule(card);
    }
  }

  async function sweepCard(card: OwnerCard): Promise<void> {
    const links = await workspaceLinks(card.ownerSub);
    const link = links.find((l) => l.teamId === card.teamId);
    if (
      !card.messageTs &&
      link &&
      Date.now() - card.createdAt.getTime() > 60_000
    )
      await show(card, link, false);
    for (const item of await cards.items(card.id)) {
      if (FINAL_STATES.has(item.state)) continue;
      if (item.requestKind === "question") {
        const q = await questionViewOf(item.requestId);
        if (q && q.status !== "asking") await settleQuestionItems(q, "settled");
        continue;
      }
      const view = await deps.ports.view(item.requestId);
      if (!view || view.status === "pending") continue;
      if (item.state === "rule" && view.status === "expired") continue;
      await settleItems(view, "settled");
    }
    await applyCloseRule(card);
    if (
      card.kind !== "call" &&
      Date.now() - card.lastChange.getTime() > DAY_MS &&
      !(await rowsOf(card)).some((row) => rowWaits(row.view))
    )
      await cards.close(card.id);
  }

  // UNIT_BOUNDARY_DESCRIPTION: settles a question's card in every workspace once the question closed, under the owner's lock: the card says how it ended and closes. An item already settled is left alone; a card that cannot be edited keeps its old state, so the sweep tries again.
  async function settleQuestionItems(
    q: QuestionData,
    outcome: "answered" | "settled",
  ): Promise<void> {
    const links = await workspaceLinks(q.ownerSub);
    for (const card of await cards.cardsOfRequest(q.runId)) {
      const item = (await cards.items(card.id)).find(
        (it) => it.requestId === q.runId,
      );
      if (!item || FINAL_STATES.has(item.state)) continue;
      await cards.setItemState(card.id, q.runId, outcome);
      const link = links.find((l) => l.teamId === card.teamId);
      if (link && card.messageTs) {
        const shown = await show(card, link, false);
        if (shown === "failed" || shown === "unreachable") {
          await cards.setItemState(card.id, q.runId, item.state);
          continue;
        }
      }
      getLogger().info(
        {
          card: card.id,
          kind: card.kind,
          runId: q.runId,
          settled: q.status,
          where:
            outcome === "answered"
              ? "slack"
              : q.status === "stopped"
                ? "stopped"
                : q.answer?.by === "default"
                  ? "deadline"
                  : "app",
          delayMs: card.postedAt ? Date.now() - card.postedAt.getTime() : null,
        },
        "owner_request.card_settled",
      );
      await cards.close(card.id);
    }
  }

  async function placeQuestionOn(
    q: QuestionData,
    link: { userId: string; teamId: SlackWorkspace },
  ): Promise<boolean> {
    const card =
      (await cards.cardsOfRequest(q.runId)).find(
        (held) => held.kind === "question" && held.teamId === link.teamId,
      ) ??
      (await cards.createCard({
        ownerSub: q.ownerSub,
        agentId: q.driverAgentId,
        teamId: link.teamId,
        kind: "question",
      }));
    await cards.addItem(card.id, {
      requestKind: "question",
      requestId: q.runId,
      host: null,
    });
    const shown = await show(card, link, false);
    return shown === "posted" || shown === "edited";
  }

  async function hostWaits(
    card: OwnerCard,
    host: string,
    exceptId: string,
  ): Promise<boolean> {
    for (const item of await cards.items(card.id)) {
      if (item.host !== host || item.requestId === exceptId) continue;
      const other = await deps.ports.view(item.requestId);
      if (other?.status === "pending" && other.refusedIn === null) return true;
    }
    return false;
  }

  async function placeOn(
    view: Omit<OwnerRequestView, "agentName">,
    kind: OwnerCardKind,
    link: { userId: string; teamId: SlackWorkspace },
  ): Promise<boolean> {
    if (kind === "turn") {
      const [background] = await cards.findOpenCards({
        ownerSub: view.ownerSub,
        agentId: view.agentId,
        kind: "background",
      });
      if (background && (await cards.removeItem(background.id, view.id)))
        await show(background, link, false);
    }
    const card =
      kind === "call"
        ? ((await cards.cardsOfRequest(view.id)).find(
            (held) => held.kind === "call" && held.teamId === link.teamId,
          ) ??
          (await cards.createCard({
            ownerSub: view.ownerSub,
            agentId: view.agentId,
            teamId: link.teamId,
            kind,
          })))
        : await cards.openCard({
            ownerSub: view.ownerSub,
            agentId: view.cardAgentId,
            teamId: link.teamId,
            kind,
          });
    const hostWaited =
      kind === "background" && view.host !== null
        ? await hostWaits(card, view.host, view.id)
        : false;
    const isNewRow = await cards.addItem(card.id, {
      requestKind: "approval",
      requestId: view.id,
      host: view.host,
    });
    let newThread = false;
    if (kind === "turn") {
      const merged = threadsWith(
        card,
        deps.addressedTurns(view.agentId),
        link.teamId,
      );
      newThread = merged.added;
      card.threads = merged.threads;
      await cards.setThreads(card.id, card.threads);
    }
    const stale =
      card.postedAt !== null &&
      Date.now() - card.postedAt.getTime() > REPOST_AFTER_MS;
    const waits = view.status === "pending" && view.refusedIn === null;
    const repost =
      stale && (kind === "turn" ? newThread : isNewRow && waits && !hostWaited);
    const shown = await show(card, link, repost);
    if (shown === "unreachable" && kind === "turn") {
      for (const item of await cards.items(card.id))
        await deps.ports.refuseUnreachable(item.requestId).catch(() => false);
      return false;
    }
    if (kind === "turn") await postLines(card, view.ownerSub);
    return shown === "posted" || shown === "edited";
  }

  const api = {
    async place(approvalId: string): Promise<{ placed: number }> {
      const view = await deps.ports.view(approvalId);
      if (!view || view.status !== "pending" || !view.route)
        return { placed: 0 };
      const route: OwnerCardKind =
        view.route === "background" && view.kind === "mcp_tool_call"
          ? "call"
          : view.route;
      if ((await deps.reachOf(view.agentId).catch(() => "unlinked")) !== "ok")
        return { placed: 0 };
      if (
        route === "background" &&
        view.host !== null &&
        (view.kind === "ext_authz" || view.kind === "web_search") &&
        (await cards
          .dismissed({
            ownerSub: view.ownerSub,
            agentId: view.agentId,
            host: view.host,
          })
          .catch(() => false))
      )
        return { placed: 0 };
      const links = await workspaceLinks(view.ownerSub);
      let placed = 0;
      for (const link of links) {
        const done = await withOwnerLock(view.ownerSub, () =>
          placeOn(view, route, link),
        ).catch((err: unknown) => {
          getLogger().warn(
            { approvalId, error: formatError(err) },
            "owner_request.place_failed",
          );
          return false;
        });
        if (done) placed++;
      }
      return { placed };
    },

    async waitChanged(approvalId: string): Promise<void> {
      const view = await deps.ports.view(approvalId);
      if (!view) return;
      if (
        view.status === "pending" &&
        view.route === "turn" &&
        (await deps.reachOf(view.agentId).catch(() => "unlinked")) === "ok"
      )
        for (const link of await workspaceLinks(view.ownerSub))
          await withOwnerLock(view.ownerSub, () =>
            placeOn(view, "turn", link),
          ).catch(() => false);
      await withOwnerLock(view.ownerSub, async () => {
        for (const kind of ["turn", "background", "call"] as const) {
          for (const card of await cards.findOpenCards({
            ownerSub: view.ownerSub,
            agentId: view.agentId,
            kind,
          })) {
            const links = await workspaceLinks(view.ownerSub);
            const link = links.find((l) => l.teamId === card.teamId);
            if (link && card.messageTs) await show(card, link, false);
            if (kind === "turn") await refreshLines(card);
          }
        }
      }).catch((err: unknown) =>
        getLogger().warn(
          { approvalId, error: formatError(err) },
          "owner_request.wait_changed_failed",
        ),
      );
    },

    async answer(input: {
      requestIds: readonly string[];
      answer: OwnerAnswer;
      slackUserId: string;
      teamId: SlackWorkspace;
      reply: SlackPrivateReply;
    }): Promise<void> {
      const views: Omit<OwnerRequestView, "agentName">[] = [];
      for (const id of new Set(input.requestIds)) {
        const view = await deps.ports.view(id);
        if (view) views.push(view);
      }
      const [first] = views;
      if (!first) return;
      const note = (text: string) =>
        input
          .reply(text)
          .catch((err: unknown) =>
            getLogger().warn(
              { approvalId: first.id, error: formatError(err) },
              "owner_request.reply_failed",
            ),
          );
      const clicker = await deps.subOf(input.slackUserId).catch(() => null);
      if (clicker !== first.ownerSub) {
        const owner = await deps.ownerName(first.agentId, input.teamId);
        await note(`Only ${owner} can answer this.`);
        return;
      }
      const ownerSub = first.ownerSub;
      const mine = views.filter((view) => view.ownerSub === ownerSub);
      const results = await withOwnerLock(ownerSub, async () => {
        const decided: { view: typeof first; result: DecideResult }[] = [];
        for (const view of mine) {
          const verdict: DecidedAnswer | null =
            input.answer !== "dismiss"
              ? input.answer
              : view.status === "pending" && view.refusedIn === null
                ? "deny-once"
                : null;
          if (verdict === null) continue;
          decided.push({
            view,
            result: await deps.ports
              .decide({
                requestId: view.id,
                answer: verdict,
                ownerSub,
                slackUserId: input.slackUserId,
                teamId: input.teamId,
              })
              .catch((err: unknown): DecideResult => {
                getLogger().warn(
                  { approvalId: view.id, error: formatError(err) },
                  "owner_request.decide_failed",
                );
                return "not-actionable";
              }),
          });
        }
        if (input.answer === "dismiss" && first.host !== null)
          await cards.dismiss({
            ownerSub,
            agentId: first.agentId,
            host: first.host,
            until: new Date(Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000),
          });
        const links = await workspaceLinks(ownerSub);
        for (const view of mine) {
          const fresh = (await deps.ports.view(view.id)) ?? view;
          const applied = decided.some(
            (d) => d.view.id === view.id && d.result === "applied",
          );
          if (input.answer === "dismiss" || applied) {
            await settleItems(
              fresh,
              input.answer === "dismiss" ? "dismissed" : "answered",
            );
            continue;
          }
          for (const card of await cards.cardsOfRequest(view.id)) {
            const item = (await cards.items(card.id)).find(
              (it) => it.requestId === view.id,
            );
            const link = links.find((l) => l.teamId === card.teamId);
            if (item && !FINAL_STATES.has(item.state) && link && card.messageTs)
              await show(card, link, false);
          }
        }
        return decided.map((d) => d.result);
      });
      if (results.includes("conflict"))
        await note(
          "A rule for this host already says the opposite. Change it in the agent's network settings in the app.",
        );
      else if (
        results.length > 0 &&
        results.every((result) => result === "not-actionable")
      )
        await note("Already answered.");
      getLogger().info(
        {
          approvalIds: mine.map((view) => view.id),
          answer: input.answer,
          applied: results.filter((result) => result === "applied").length,
          notActionable: results.filter((result) => result === "not-actionable")
            .length,
          conflicts: results.filter((result) => result === "conflict").length,
          teamId: input.teamId,
        },
        "owner_request.answered",
      );
    },

    async settle(approvalId: string): Promise<void> {
      const view = await deps.ports.view(approvalId);
      if (!view || view.status === "pending") return;
      await withOwnerLock(view.ownerSub, () =>
        settleItems(view, "settled"),
      ).catch((err: unknown) =>
        getLogger().warn(
          { approvalId, error: formatError(err) },
          "owner_request.settle_failed",
        ),
      );
    },

    async unlinked(input: { ownerSub: string; teamId: string }): Promise<void> {
      await withOwnerLock(input.ownerSub, async () => {
        const gw = await deps.gateway();
        for (const card of await cards.openCardsInTeam(
          input.ownerSub,
          input.teamId,
        )) {
          if (gw && card.dmChannel && card.messageTs)
            await gw
              .updateMessage({
                channel: card.dmChannel,
                ts: card.messageTs,
                ...unlinkedCard({
                  kind: card.kind,
                  agentName: await deps.agentName(card.agentId),
                  appUrl: deps.appUrl,
                }),
                metadata: cardMetadata(card.id),
                teamId: input.teamId,
              })
              .catch((err: unknown) =>
                getLogger().warn(
                  { card: card.id, error: formatError(err) },
                  "owner_request.unlink_edit_failed",
                ),
              );
          await cards.close(card.id);
        }
      });
    },

    async sweep(): Promise<void> {
      if (sweeping) return;
      sweeping = true;
      try {
        await cards.deleteEndedDismissals();
        for (const card of await cards.openCards(500))
          await withOwnerLock(card.ownerSub, () => sweepCard(card)).catch(
            (err: unknown) =>
              getLogger().warn(
                { card: card.id, error: formatError(err) },
                "owner_request.sweep_card_failed",
              ),
          );
        const since = new Date(Date.now() - deps.holdWindowMs - 60_000);
        for (const id of await deps.ports.waiting({ since, limit: 200 })) {
          if ((await cards.cardsOfRequest(id)).length > 0) continue;
          const view = await deps.ports.view(id);
          if (!view) continue;
          if (
            view.route === "background" &&
            (Date.now() - Date.parse(view.createdAt) < BACKGROUND_DELAY_MS ||
              (await deps.ownerActive(view.ownerSub).catch(() => false)))
          )
            continue;
          await api.place(id);
        }
        if (deps.questions)
          for (const runId of await deps.questions.open(200)) {
            if ((await cards.cardsOfRequest(runId)).length > 0) continue;
            const q = await questionViewOf(runId);
            if (!q || Date.now() - Date.parse(q.askedAt) < BACKGROUND_DELAY_MS)
              continue;
            await api.placeQuestion(runId);
          }
      } finally {
        sweeping = false;
      }
    },

    async placeQuestion(runId: string): Promise<{ placed: number }> {
      const q = await questionViewOf(runId);
      if (!q || q.status !== "asking") return { placed: 0 };
      if ((await cards.cardsOfRequest(runId)).length > 0) return { placed: 0 };
      if (await deps.ownerActive(q.ownerSub).catch(() => false))
        return { placed: 0 };
      if (
        (await deps.reachOf(q.driverAgentId).catch(() => "unlinked")) !== "ok"
      )
        return { placed: 0 };
      let placed = 0;
      for (const link of await workspaceLinks(q.ownerSub)) {
        const done = await withOwnerLock(q.ownerSub, () =>
          placeQuestionOn(q, link),
        ).catch((err: unknown) => {
          getLogger().warn(
            { runId, error: formatError(err) },
            "owner_request.question_place_failed",
          );
          return false;
        });
        if (done) placed++;
      }
      return { placed };
    },

    async settleQuestion(runId: string): Promise<void> {
      const q = await questionViewOf(runId);
      if (!q || q.status === "asking") return;
      await withOwnerLock(q.ownerSub, () =>
        settleQuestionItems(q, "settled"),
      ).catch((err: unknown) =>
        getLogger().warn(
          { runId, error: formatError(err) },
          "owner_request.question_settle_failed",
        ),
      );
    },

    async answerQuestion(input: {
      runId: string;
      fields: unknown;
      slackUserId: string;
      teamId: SlackWorkspace;
      reply: SlackPrivateReply;
    }): Promise<void> {
      if (!deps.questions) return;
      const ports = deps.questions;
      const q = await questionViewOf(input.runId);
      if (!q) return;
      const note = (text: string) =>
        input
          .reply(text)
          .catch((err: unknown) =>
            getLogger().warn(
              { runId: input.runId, error: formatError(err) },
              "owner_request.reply_failed",
            ),
          );
      const clicker = await deps.subOf(input.slackUserId).catch(() => null);
      if (clicker !== q.ownerSub) {
        const owner = await deps.ownerName(q.driverAgentId, input.teamId);
        await note(`Only ${owner} can answer this.`);
        return;
      }
      if (q.status !== "asking") {
        await note("Already answered.");
        await withOwnerLock(q.ownerSub, () =>
          settleQuestionItems(q, "settled"),
        );
        return;
      }
      const parsed = answerFromFields(input.fields, q.options);
      if ("hint" in parsed) {
        await note(parsed.hint);
        return;
      }
      const result = await withOwnerLock(q.ownerSub, async () => {
        const outcome = await ports.answer({
          runId: input.runId,
          text: parsed.text,
          ownerSub: q.ownerSub,
        });
        const fresh = await questionViewOf(input.runId);
        if (fresh && fresh.status !== "asking")
          await settleQuestionItems(
            fresh,
            outcome === "applied" ? "answered" : "settled",
          );
        return outcome;
      });
      if (result === "not-actionable") await note("Already answered.");
      getLogger().info(
        { runId: input.runId, result, teamId: input.teamId },
        "owner_request.question_answered",
      );
    },

    async released(input: {
      agentId: string;
      ownerSub: string;
      channelId: string;
      threadTs: string;
      askers: string[];
    }): Promise<void> {
      await withOwnerLock(input.ownerSub, async () => {
        for (const card of await cards.findOpenCards({
          ownerSub: input.ownerSub,
          agentId: input.agentId,
          kind: "turn",
        })) {
          const thread = card.threads.find(
            (t) =>
              t.channelId === input.channelId && t.threadTs === input.threadTs,
          );
          if (!thread) continue;
          thread.releasedAt = new Date().toISOString();
          thread.askers = [...new Set([...thread.askers, ...input.askers])];
          await cards.setThreads(card.id, card.threads);
        }
      });
    },
  };
  return api;
}

export type SlackOwnerRequests = ReturnType<typeof createSlackOwnerRequests>;
