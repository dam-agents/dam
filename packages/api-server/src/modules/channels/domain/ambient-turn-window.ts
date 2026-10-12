export const AMBIENT_REPLY_GRACE_MS = 2 * 60_000;

export interface AmbientTurnWindow {
  enter(agentId: string, channel: string): void;
  leave(agentId: string, channel: string): void;
  covers(agentId: string, channel: string): boolean;
}

/** UNIT_BOUNDARY_DESCRIPTION: Tells whether an Agent's post is its reply in
 *  an ambient round. A round hands each reader what the readers before it
 *  said, so such a reply has already reached the others in that round. Fed
 *  back to the readers as a new post, it would start a second turn on words
 *  they were already given, and a reply in a thread under a top-level message
 *  would run in a second queue alongside the round itself. A window opens
 *  when the Agent's ambient turn in a channel starts. It stays open for a
 *  grace period after the turn ends, because Slack sends the post back over
 *  the socket after the reply tool has returned, and the turn may already be
 *  over by then. */
export function createAmbientTurnWindow(
  opts: { graceMs?: number; now?: () => number } = {},
): AmbientTurnWindow {
  const graceMs = opts.graceMs ?? AMBIENT_REPLY_GRACE_MS;
  const now = opts.now ?? Date.now;
  const live = new Map<string, number>();
  const closing = new Map<string, number>();
  const keyOf = (agentId: string, channel: string) => `${agentId} ${channel}`;

  return {
    enter(agentId, channel) {
      const key = keyOf(agentId, channel);
      live.set(key, (live.get(key) ?? 0) + 1);
    },
    leave(agentId, channel) {
      const key = keyOf(agentId, channel);
      const count = (live.get(key) ?? 0) - 1;
      if (count > 0) {
        live.set(key, count);
        return;
      }
      live.delete(key);
      const at = now();
      for (const [other, expiresAt] of closing) {
        if (expiresAt <= at) closing.delete(other);
      }
      closing.set(key, at + graceMs);
    },
    covers(agentId, channel) {
      const key = keyOf(agentId, channel);
      if (live.has(key)) return true;
      const expiresAt = closing.get(key);
      return expiresAt !== undefined && expiresAt > now();
    },
  };
}
