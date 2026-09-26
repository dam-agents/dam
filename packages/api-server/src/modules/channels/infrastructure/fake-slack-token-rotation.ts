import type {
  SlackTokenGrant,
  SlackTokenGrantResult,
} from "./slack-token-rotation.js";

const ACCESS_TOKEN_TTL_S = 43_200;
const REFRESH_GRACE_MS = 60_000;
const ACTIVE_TOKEN_LIMIT = 2;

export interface FakeSlackTokenRotation {
  refresh: SlackTokenGrant;
  exchange: SlackTokenGrant;
  now(): number;
  advance(ms: number): void;
  enableRotation(): void;
  registerLongLived(token: string, teamId: string): void;
  isLive(token: string): boolean;
}

interface AccessToken {
  teamId: string;
  expiresAt: number;
  revoked: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Slack's token rotation as its documentation
 * describes it, for runs that have no Slack to talk to. Rotation is off until
 * turned on, and cannot be turned off again. A token that does not expire can
 * be exchanged exactly once, which retires it. An exchanged or refreshed
 * access token lives twelve hours. A refresh token is spent by its first use
 * and refused once a short grace period has passed. Refreshing early leaves at
 * most two live access tokens per workspace, the oldest extra one revoked.
 */
export function createFakeSlackTokenRotation(opts?: {
  now?: () => number;
}): FakeSlackTokenRotation {
  const base = opts?.now ?? (() => Date.now());
  let offset = 0;
  let rotationEnabled = false;
  let minted = 0;
  const longLived = new Map<string, string>();
  const exchanged = new Set<string>();
  const access = new Map<string, AccessToken>();
  const refreshTokens = new Map<
    string,
    { teamId: string; spentAt: number | null }
  >();
  const issuedByTeam = new Map<string, string[]>();

  const now = () => base() + offset;

  function liveAccess(token: string): boolean {
    const entry = access.get(token);
    return !!entry && !entry.revoked && entry.expiresAt > now();
  }

  function issue(teamId: string): SlackTokenGrantResult {
    minted += 1;
    const accessToken = `xoxe.xoxb-fake-${teamId}-${minted}`;
    const refreshToken = `xoxe-1-fake-${teamId}-${minted}`;
    const expiresAt = now() + ACCESS_TOKEN_TTL_S * 1000;
    access.set(accessToken, { teamId, expiresAt, revoked: false });
    refreshTokens.set(refreshToken, { teamId, spentAt: null });

    const issued = [...(issuedByTeam.get(teamId) ?? []), accessToken];
    const live = issued.filter(liveAccess);
    for (const extra of live.slice(0, -ACTIVE_TOKEN_LIMIT)) {
      access.get(extra)!.revoked = true;
    }
    issuedByTeam.set(teamId, live.slice(-ACTIVE_TOKEN_LIMIT));

    return { ok: true, accessToken, refreshToken, expiresAt };
  }

  function refused(error: string): SlackTokenGrantResult {
    return { ok: false, refusal: error, error };
  }

  return {
    async exchange(token) {
      if (!rotationEnabled) return refused("token_rotation_not_enabled");
      if (exchanged.has(token)) return refused("token_already_exchanged");
      const teamId = longLived.get(token);
      if (teamId === undefined) return refused("invalid_token");
      longLived.delete(token);
      exchanged.add(token);
      return issue(teamId);
    },

    async refresh(refreshToken) {
      const entry = refreshTokens.get(refreshToken);
      if (!entry) return refused("invalid_refresh_token");
      if (entry.spentAt !== null && now() - entry.spentAt > REFRESH_GRACE_MS) {
        return refused("invalid_refresh_token");
      }
      entry.spentAt ??= now();
      return issue(entry.teamId);
    },

    now,

    advance(ms) {
      offset += ms;
    },

    enableRotation() {
      rotationEnabled = true;
    },

    registerLongLived(token, teamId) {
      if (!exchanged.has(token)) longLived.set(token, teamId);
    },

    isLive(token) {
      return longLived.has(token) || liveAccess(token);
    },
  };
}
