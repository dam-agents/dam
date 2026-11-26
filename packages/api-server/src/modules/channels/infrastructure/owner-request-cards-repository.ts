import { randomUUID } from "node:crypto";
import {
  and,
  eq,
  isNull,
  ownerRequestCardItems,
  ownerRequestCards,
  ownerRequestDismissals,
  sql,
  type Db,
} from "db";
import type {
  OwnerCardKind,
  OwnerCardThread,
} from "../domain/owner-request-cards.js";

export interface OwnerCard {
  id: string;
  ownerSub: string;
  agentId: string;
  teamId: string;
  kind: OwnerCardKind;
  dmChannel: string | null;
  messageTs: string | null;
  postedAt: Date | null;
  threads: OwnerCardThread[];
  lastChange: Date;
  createdAt: Date;
  sealedAt: Date | null;
}

export interface OwnerCardItem {
  cardId: string;
  requestKind: "approval" | "question";
  requestId: string;
  host: string | null;
  state: "waiting" | "rule" | "settled" | "answered" | "dismissed";
}

export interface OwnerRequestCardsRepository {
  openCard(input: {
    ownerSub: string;
    agentId: string;
    teamId: string;
    kind: OwnerCardKind;
  }): Promise<OwnerCard>;
  findOpenCards(input: {
    ownerSub: string;
    agentId: string;
    kind: OwnerCardKind;
  }): Promise<OwnerCard[]>;
  addItem(
    cardId: string,
    item: Omit<OwnerCardItem, "cardId" | "state">,
  ): Promise<boolean>;
  removeItem(cardId: string, requestId: string): Promise<boolean>;
  createCard(input: {
    ownerSub: string;
    agentId: string;
    teamId: string;
    kind: OwnerCardKind;
  }): Promise<OwnerCard>;
  cardsOfRequest(requestId: string): Promise<OwnerCard[]>;
  items(cardId: string): Promise<OwnerCardItem[]>;
  setPosted(
    cardId: string,
    posted: { dmChannel: string; messageTs: string; postedAt: Date },
  ): Promise<void>;
  setThreads(cardId: string, threads: OwnerCardThread[]): Promise<void>;
  touch(cardId: string): Promise<void>;
  setItemState(
    cardId: string,
    requestId: string,
    state: OwnerCardItem["state"],
  ): Promise<void>;
  dismiss(input: {
    ownerSub: string;
    agentId: string;
    host: string;
    until: Date;
  }): Promise<void>;
  dismissed(input: {
    ownerSub: string;
    agentId: string;
    host: string;
  }): Promise<boolean>;
  seal(cardId: string): Promise<void>;
  close(cardId: string): Promise<void>;
  openCards(limit: number): Promise<OwnerCard[]>;
  openCardsInTeam(ownerSub: string, teamId: string): Promise<OwnerCard[]>;
  deleteEndedDismissals(): Promise<number>;
}

type CardRow = typeof ownerRequestCards.$inferSelect;

function toCard(row: CardRow): OwnerCard {
  return {
    id: row.id,
    ownerSub: row.ownerSub,
    agentId: row.agentId,
    teamId: row.teamId,
    kind: row.kind as OwnerCardKind,
    dmChannel: row.dmChannel,
    messageTs: row.messageTs,
    postedAt: row.postedAt,
    threads: (row.threads as OwnerCardThread[] | null) ?? [],
    lastChange: row.lastChange,
    createdAt: row.createdAt,
    sealedAt: row.sealedAt,
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the owner's request cards in Slack and what each one holds. One open turn card and one open background card exist per owner, agent and workspace, which a unique index holds even when two placements race; a request is an item of a card until the card closes. A card's row is written before its post, so a post that fails leaves a row the sweep can post later. A dismissal keeps new background rows of one agent and host off the owner's cards until it ends. A sealed card stays open for its buttons but takes no new rows, so the next request opens a new card.
export function createOwnerRequestCardsRepository(
  db: Db,
): OwnerRequestCardsRepository {
  async function findOpen(input: {
    ownerSub: string;
    agentId: string;
    teamId: string;
    kind: OwnerCardKind;
  }): Promise<OwnerCard | null> {
    const rows = await db
      .select()
      .from(ownerRequestCards)
      .where(
        and(
          eq(ownerRequestCards.ownerSub, input.ownerSub),
          eq(ownerRequestCards.agentId, input.agentId),
          eq(ownerRequestCards.teamId, input.teamId),
          eq(ownerRequestCards.kind, input.kind),
          isNull(ownerRequestCards.closedAt),
          isNull(ownerRequestCards.sealedAt),
        ),
      )
      .limit(1);
    return rows[0] ? toCard(rows[0]) : null;
  }

  return {
    async openCard(input) {
      const existing = await findOpen(input);
      if (existing) return existing;
      await db
        .insert(ownerRequestCards)
        .values({ id: randomUUID(), ...input, threads: [] })
        .onConflictDoNothing();
      const card = await findOpen(input);
      if (!card) throw new Error("owner request card was not written");
      return card;
    },

    async findOpenCards({ ownerSub, agentId, kind }) {
      const rows = await db
        .select()
        .from(ownerRequestCards)
        .where(
          and(
            eq(ownerRequestCards.ownerSub, ownerSub),
            eq(ownerRequestCards.agentId, agentId),
            eq(ownerRequestCards.kind, kind),
            isNull(ownerRequestCards.closedAt),
          ),
        );
      return rows.map(toCard);
    },

    async addItem(cardId, item) {
      const written = await db
        .insert(ownerRequestCardItems)
        .values({ cardId, ...item })
        .onConflictDoNothing()
        .returning({ requestId: ownerRequestCardItems.requestId });
      return written.length > 0;
    },

    async createCard(input) {
      const id = randomUUID();
      await db.insert(ownerRequestCards).values({ id, ...input, threads: [] });
      const rows = await db
        .select()
        .from(ownerRequestCards)
        .where(eq(ownerRequestCards.id, id));
      return toCard(rows[0]!);
    },

    async cardsOfRequest(requestId) {
      const rows = await db
        .select({ card: ownerRequestCards })
        .from(ownerRequestCardItems)
        .innerJoin(
          ownerRequestCards,
          eq(ownerRequestCardItems.cardId, ownerRequestCards.id),
        )
        .where(
          and(
            eq(ownerRequestCardItems.requestId, requestId),
            isNull(ownerRequestCards.closedAt),
          ),
        );
      return rows.map((row) => toCard(row.card));
    },

    async removeItem(cardId, requestId) {
      const removed = await db
        .delete(ownerRequestCardItems)
        .where(
          and(
            eq(ownerRequestCardItems.cardId, cardId),
            eq(ownerRequestCardItems.requestId, requestId),
          ),
        )
        .returning({ requestId: ownerRequestCardItems.requestId });
      return removed.length > 0;
    },

    async items(cardId) {
      const rows = await db
        .select()
        .from(ownerRequestCardItems)
        .where(eq(ownerRequestCardItems.cardId, cardId))
        .orderBy(ownerRequestCardItems.createdAt);
      return rows.map((row) => ({
        cardId: row.cardId,
        requestKind: row.requestKind as OwnerCardItem["requestKind"],
        requestId: row.requestId,
        host: row.host,
        state: row.state as OwnerCardItem["state"],
      }));
    },

    async setPosted(cardId, posted) {
      await db
        .update(ownerRequestCards)
        .set({ ...posted, lastChange: new Date() })
        .where(eq(ownerRequestCards.id, cardId));
    },

    async setThreads(cardId, threads) {
      await db
        .update(ownerRequestCards)
        .set({ threads, lastChange: new Date() })
        .where(eq(ownerRequestCards.id, cardId));
    },

    async touch(cardId) {
      await db
        .update(ownerRequestCards)
        .set({ lastChange: new Date() })
        .where(eq(ownerRequestCards.id, cardId));
    },

    async setItemState(cardId, requestId, state) {
      await db
        .update(ownerRequestCardItems)
        .set({ state })
        .where(
          and(
            eq(ownerRequestCardItems.cardId, cardId),
            eq(ownerRequestCardItems.requestId, requestId),
          ),
        );
    },

    async dismiss({ ownerSub, agentId, host, until }) {
      await db
        .insert(ownerRequestDismissals)
        .values({ ownerSub, agentId, host, until })
        .onConflictDoUpdate({
          target: [
            ownerRequestDismissals.ownerSub,
            ownerRequestDismissals.agentId,
            ownerRequestDismissals.host,
          ],
          set: { until },
        });
    },

    async seal(cardId) {
      await db
        .update(ownerRequestCards)
        .set({ sealedAt: new Date() })
        .where(
          and(
            eq(ownerRequestCards.id, cardId),
            isNull(ownerRequestCards.sealedAt),
          ),
        );
    },

    async close(cardId) {
      await db
        .update(ownerRequestCards)
        .set({ closedAt: new Date() })
        .where(
          and(
            eq(ownerRequestCards.id, cardId),
            isNull(ownerRequestCards.closedAt),
          ),
        );
    },

    async openCards(limit) {
      const rows = await db
        .select()
        .from(ownerRequestCards)
        .where(isNull(ownerRequestCards.closedAt))
        .orderBy(ownerRequestCards.lastChange)
        .limit(limit);
      return rows.map(toCard);
    },

    async openCardsInTeam(ownerSub, teamId) {
      const rows = await db
        .select()
        .from(ownerRequestCards)
        .where(
          and(
            eq(ownerRequestCards.ownerSub, ownerSub),
            eq(ownerRequestCards.teamId, teamId),
            isNull(ownerRequestCards.closedAt),
          ),
        );
      return rows.map(toCard);
    },

    async deleteEndedDismissals() {
      const removed = await db
        .delete(ownerRequestDismissals)
        .where(sql`${ownerRequestDismissals.until} <= now()`)
        .returning({ host: ownerRequestDismissals.host });
      return removed.length;
    },

    async dismissed({ ownerSub, agentId, host }) {
      const rows = await db
        .select({ host: ownerRequestDismissals.host })
        .from(ownerRequestDismissals)
        .where(
          and(
            eq(ownerRequestDismissals.ownerSub, ownerSub),
            eq(ownerRequestDismissals.agentId, agentId),
            eq(ownerRequestDismissals.host, host),
            sql`${ownerRequestDismissals.until} > now()`,
          ),
        )
        .limit(1);
      return rows.length > 0;
    },
  };
}
