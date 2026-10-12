export const BOT_POST_TURNS_PER_CONVERSATION = 3;

const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;

const PRUNE_ABOVE = 5_000;

export interface BotPostLoopBound {
  notePersonPost(conversation: string): void;
  admitBotPost(conversation: string): boolean;
}

/** UNIT_BOUNDARY_DESCRIPTION: Stops agents and apps from starting turns for
 *  each other forever. A post by an Agent or by another app may start turns,
 *  and an Agent's reply is itself such a post, so two Agents reading along in
 *  one thread, or an Agent and a webhook, could answer each other without end.
 *  This counts the bot posts admitted in one conversation since a person last
 *  posted there. Once the limit is reached, further bot posts start no turn
 *  until a person posts again, which resets the count. The count lives in the
 *  worker's memory, so a restart resets it too; that only ever allows a new
 *  run of at most the same limit. Entries expire after a day without a post,
 *  so a quiet conversation holds no memory. */
export function createBotPostLoopBound(
  opts: { limit?: number; now?: () => number } = {},
): BotPostLoopBound {
  const limit = opts.limit ?? BOT_POST_TURNS_PER_CONVERSATION;
  const now = opts.now ?? Date.now;
  const admitted = new Map<string, { count: number; expiresAt: number }>();

  function prune(at: number): void {
    if (admitted.size <= PRUNE_ABOVE) return;
    for (const [key, entry] of admitted) {
      if (entry.expiresAt <= at) admitted.delete(key);
    }
  }

  return {
    notePersonPost(conversation) {
      admitted.delete(conversation);
    },
    admitBotPost(conversation) {
      const at = now();
      prune(at);
      const entry = admitted.get(conversation);
      const count = entry && entry.expiresAt > at ? entry.count : 0;
      if (count >= limit) return false;
      admitted.set(conversation, {
        count: count + 1,
        expiresAt: at + CONVERSATION_TTL_MS,
      });
      return true;
    },
  };
}
