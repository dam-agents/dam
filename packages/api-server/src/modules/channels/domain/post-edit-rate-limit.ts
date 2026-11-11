import { createTtlMap } from "../../../core/ttl-map.js";

export const POST_EDITS_PER_WORKSPACE = 40;

export const POST_EDITS_PER_AGENT = 10;

export const POST_EDIT_WINDOW_MS = 60 * 1000;

const PRUNE_ABOVE = 5_000;

export type PostEditAdmission =
  { admitted: true } | { admitted: false; retryAfterMs: number };

export interface PostEditRateLimit {
  check(workspace: string, agentId: string): PostEditAdmission;
  admit(workspace: string, agentId: string): PostEditAdmission;
}

export const EMPTY_POST_EDIT =
  "nothing to show — an edited post needs text or a card";

export function tooManyPostEdits(retryAfterMs: number): string {
  return (
    `Too many edits right now. Wait ${Math.ceil(retryAfterMs / 1000)} ` +
    `seconds, then send the edit once more with the post's latest state.`
  );
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Keeps Agents' edits of their own posts under what
 * a messenger takes. Slack allows about fifty edits a minute for a whole
 * workspace, and every Agent there posts through the one bot, so the limit is
 * counted per workspace, a little below Slack's. One Agent that updates a
 * progress post in a loop would use up that share for all the others, so each
 * Agent also has a smaller limit of its own. Both are sliding windows. An edit
 * over either limit is not admitted and is not counted, and the answer says
 * how long to wait until the oldest counted edit leaves the window. A caller
 * can ask first without counting, so an edit that will be refused costs the
 * messenger no call at all. The state
 * lives in the worker's memory, so a restart resets it; that allows at most
 * one more window of the same size.
 */
export function createPostEditRateLimit(
  opts: {
    perWorkspace?: number;
    perAgent?: number;
    windowMs?: number;
    now?: () => number;
  } = {},
): PostEditRateLimit {
  const perWorkspace = opts.perWorkspace ?? POST_EDITS_PER_WORKSPACE;
  const perAgent = opts.perAgent ?? POST_EDITS_PER_AGENT;
  const windowMs = opts.windowMs ?? POST_EDIT_WINDOW_MS;
  const now = opts.now ?? Date.now;
  const edits = createTtlMap<string, number[]>({
    ttlMs: windowMs,
    maxEntries: PRUNE_ABOVE,
    now,
  });

  const recent = (key: string, at: number): number[] =>
    (edits.get(key) ?? []).filter((t) => t > at - windowMs);

  function judge(
    workspace: string,
    agentId: string,
    count: boolean,
  ): PostEditAdmission {
    const at = now();
    const workspaceKey = `workspace ${workspace}`;
    const agentKey = `agent ${workspace} ${agentId}`;
    const inWorkspace = recent(workspaceKey, at);
    const byAgent = recent(agentKey, at);
    const full = [
      ...(inWorkspace.length >= perWorkspace ? [inWorkspace[0]!] : []),
      ...(byAgent.length >= perAgent ? [byAgent[0]!] : []),
    ];
    if (full.length > 0)
      return {
        admitted: false,
        retryAfterMs: Math.max(...full) + windowMs - at,
      };
    if (count) {
      edits.set(workspaceKey, [...inWorkspace, at]);
      edits.set(agentKey, [...byAgent, at]);
    }
    return { admitted: true };
  }

  return {
    check: (workspace, agentId) => judge(workspace, agentId, false),
    admit: (workspace, agentId) => judge(workspace, agentId, true),
  };
}
