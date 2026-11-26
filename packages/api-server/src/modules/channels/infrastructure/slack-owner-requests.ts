import { getLogger } from "../../../core/logger.js";
import { formatError } from "../../../core/format-error.js";
import {
  cardMetadata,
  ownerCard,
  threadLine,
  type CardRow,
  type OwnerCardKind,
  type OwnerCardThread,
  type OwnerRequestView,
  type ThreadLineState,
} from "../domain/owner-request-cards.js";
import type {
  OwnerCard,
  OwnerRequestCardsRepository,
} from "./owner-request-cards-repository.js";
import type { SlackGateway, SlackWorkspace } from "./slack-gateway.js";

export interface OwnerRequestPortsForSlack {
  view(id: string): Promise<Omit<OwnerRequestView, "agentName"> | null>;
  refuseUnreachable(id: string): Promise<boolean>;
  anyoneWaits(id: string): Promise<boolean>;
  releaseTurnWaits(
    agentId: string,
    release: { turnStartedAt: number; sessionIds: string[] },
  ): Promise<void>;
  cards: OwnerRequestCardsRepository;
}

export interface AddressedTurnThread {
  turnKey: string;
  channelId: string;
  threadTs: string;
  teamId: SlackWorkspace;
  startedBy: string | null;
  askers: string[];
}

const REPOST_AFTER_MS = 5 * 60 * 1000;
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

// UNIT_BOUNDARY_DESCRIPTION: places owner requests on cards in the owner's Slack DM and keeps the line in each waiting thread true. It runs on the channels leader, and one lock per owner orders every placement and edit, so two requests that arrive together join one card. A `turn` request joins the agent's turn card and names the thread it came from; a `background` request joins the agent's background card; a raise moves a request from the background card to the turn card. A card's row is written before its post; a join from a thread the card does not name yet, or a new row of a background card, posts the card again when the old post is more than five minutes old, so Slack notifies the owner once more, and any other join edits it. A turn card that cannot post for a lasting reason denies its waiting requests at once, so no thread waits for a card that never comes. The line in each thread says that the agent asked its owner while a request waits, that the agent went on without the step while one is still pending, and that the wait ended once every request settled.
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
  ephemeral: (
    channel: string,
    user: string,
    threadTs: string,
    text: string,
    teamId: SlackWorkspace,
  ) => Promise<void>;
  appUrl: string;
}) {
  const { cards } = deps.ports;
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
      if (!view || view.status !== "pending") continue;
      const waits = await deps.ports.anyoneWaits(view.id).catch(() => true);
      rows.push({
        view: { ...view, agentName: await deps.agentName(view.agentId) },
        nobodyWaits: !waits,
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

  async function show(
    card: OwnerCard,
    link: { userId: string; teamId: SlackWorkspace },
    repost: boolean,
  ): Promise<"posted" | "edited" | "failed" | "unreachable"> {
    const gw = await deps.gateway();
    if (!gw) return "failed";
    const rows = await rowsOf(card);
    const rendered = ownerCard({
      kind: card.kind,
      agentName: await deps.agentName(card.agentId),
      threads: card.threads,
      rows,
      appUrl: deps.appUrl,
    });
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
          rows: rows.length,
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
    const rows = await rowsOf(card);
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
    const card = await cards.openCard({
      ownerSub: view.ownerSub,
      agentId: view.agentId,
      teamId: link.teamId,
      kind,
    });
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
    const repost = stale && (kind === "turn" ? newThread : isNewRow);
    const shown = await show(card, link, repost);
    if (shown === "unreachable" && kind === "turn") {
      for (const item of await cards.items(card.id))
        await deps.ports.refuseUnreachable(item.requestId).catch(() => false);
      return false;
    }
    if (kind === "turn") await postLines(card, view.ownerSub);
    return shown === "posted" || shown === "edited";
  }

  return {
    async place(approvalId: string): Promise<{ placed: number }> {
      const view = await deps.ports.view(approvalId);
      if (!view || view.status !== "pending" || !view.route)
        return { placed: 0 };
      const route = view.route;
      if ((await deps.reachOf(view.agentId).catch(() => "unlinked")) !== "ok")
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
        for (const kind of ["turn", "background"] as const) {
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
}

export type SlackOwnerRequests = ReturnType<typeof createSlackOwnerRequests>;
