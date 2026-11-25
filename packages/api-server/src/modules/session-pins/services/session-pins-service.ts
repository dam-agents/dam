import { TRPCError } from "@trpc/server";
import {
  type AttentionItem,
  SESSION_PINS_MAX,
  type SessionPin,
  type SessionPinKey,
  type SessionPinsService,
} from "api-server-api";

import type { SessionPinsRepository } from "../infrastructure/session-pins-repository.js";

const keyOf = (key: SessionPinKey) => `${key.agentId}:${key.sessionId}`;

const activityOf = (pin: SessionPin) =>
  pin.item ? (pin.item.activityAt ?? pin.item.createdAt) : null;

/**
 * UNIT_BOUNDARY_DESCRIPTION: one user's pinned Sessions. A pin is only the
 * pair of Agent and Session and never asks the Agent whether the Session
 * exists. The list joins each pin with the user's attention record row, so
 * the sidebar shows a pinned row as it shows any other without waking the
 * Agent, newest activity first and pins with no row last. Pinning needs the
 * user to own the Agent or to hold its `sessions` permission as an Agent
 * Editor, and a user holds at most SESSION_PINS_MAX pins; unpinning needs
 * nothing, since it only removes the user's own row.
 */
export function createSessionPinsService(deps: {
  repo: SessionPinsRepository;
  owner: string;
  mayPin: (agentId: string) => Promise<boolean>;
  attentionItemsOf: (
    owner: string,
    keys: readonly SessionPinKey[],
  ) => Promise<AttentionItem[]>;
}): SessionPinsService {
  return {
    async list() {
      const stored = await deps.repo.listForOwner(deps.owner);
      const items = new Map(
        (await deps.attentionItemsOf(deps.owner, stored)).map((item) => [
          keyOf(item),
          item,
        ]),
      );
      const pins = stored.map((pin): SessionPin => ({
        agentId: pin.agentId,
        sessionId: pin.sessionId,
        pinnedAt: pin.pinnedAt.toISOString(),
        item: items.get(keyOf(pin)) ?? null,
      }));
      pins.sort((a, b) => {
        const at = activityOf(a);
        const bt = activityOf(b);
        if (at === bt) return b.pinnedAt.localeCompare(a.pinnedAt);
        if (at === null) return 1;
        if (bt === null) return -1;
        return bt.localeCompare(at);
      });
      return { pins };
    },

    async pin(key) {
      if (!(await deps.mayPin(key.agentId)))
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "you cannot use sessions on this agent",
        });
      const pinned = (await deps.repo.listForOwner(deps.owner)).some(
        (pin) => pin.agentId === key.agentId && pin.sessionId === key.sessionId,
      );
      if (pinned) return;
      if ((await deps.repo.countForOwner(deps.owner)) >= SESSION_PINS_MAX)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `you can pin at most ${SESSION_PINS_MAX} sessions; unpin one first`,
        });
      await deps.repo.insert(deps.owner, key);
    },

    async unpin(key) {
      await deps.repo.delete(deps.owner, key);
    },
  };
}
