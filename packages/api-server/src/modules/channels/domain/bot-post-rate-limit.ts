import { createTtlMap } from "../../../core/ttl-map.js";

export const BOT_POST_TURNS_PER_WINDOW = 10;

export const BOT_POST_WINDOW_MS = 60 * 1000;

export const BOT_POST_COOLDOWN_MS = 5 * 60 * 1000;

const PRUNE_ABOVE = 5_000;

export type BotPostAdmission = "admitted" | "tripped" | "paused";

export interface BotPostRateLimit {
  admitBotPost(conversation: string): BotPostAdmission;
}

type ConversationState = { admittedAt: number[]; pausedUntil?: number };

/** UNIT_BOUNDARY_DESCRIPTION: Stops agents and apps from starting turns for
 *  each other forever. A post by an Agent or by another app may start turns,
 *  and an Agent's reply is itself such a post, so a routing or prompt bug can
 *  make two Agents, or an Agent and a webhook, wake each other without end.
 *  Such an echo loop runs much faster than a real discussion, so this admits
 *  at most `limit` bot posts per conversation in any sliding window of
 *  `windowMs`. The first post over the limit is `tripped`: bot posts there
 *  start no turn for `cooldownMs`, and the caller tells the conversation once.
 *  Later posts in the pause are `paused`. After the pause the window starts
 *  empty. A person's post does not change the count. The state lives in the
 *  worker's memory, so a restart resets it; that only ever allows one more
 *  window of at most the same limit. */
export function createBotPostRateLimit(
  opts: {
    limit?: number;
    windowMs?: number;
    cooldownMs?: number;
    now?: () => number;
  } = {},
): BotPostRateLimit {
  const limit = opts.limit ?? BOT_POST_TURNS_PER_WINDOW;
  const windowMs = opts.windowMs ?? BOT_POST_WINDOW_MS;
  const cooldownMs = opts.cooldownMs ?? BOT_POST_COOLDOWN_MS;
  const now = opts.now ?? Date.now;
  const conversations = createTtlMap<string, ConversationState>({
    ttlMs: Math.max(windowMs, cooldownMs),
    maxEntries: PRUNE_ABOVE,
    now,
  });

  return {
    admitBotPost(conversation) {
      const at = now();
      const state = conversations.get(conversation);
      if (state?.pausedUntil !== undefined && at < state.pausedUntil)
        return "paused";
      const admittedAt = (
        state?.pausedUntil === undefined ? (state?.admittedAt ?? []) : []
      ).filter((t) => t > at - windowMs);
      if (admittedAt.length >= limit) {
        conversations.set(conversation, {
          admittedAt: [],
          pausedUntil: at + cooldownMs,
        });
        return "tripped";
      }
      conversations.set(conversation, { admittedAt: [...admittedAt, at] });
      return "admitted";
    },
  };
}
