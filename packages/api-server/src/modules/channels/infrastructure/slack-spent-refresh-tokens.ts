import type { Redis } from "ioredis";
import { createRedisTtlStore } from "../../../core/ttl-store.js";
import type { SpentRefreshTokens } from "../services/slack-app-token-service.js";

const SLACK_TOKEN_LIFETIME_MS = 12 * 60 * 60_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which Slack app-level refresh tokens a replica
 * has spent without saving what Slack gave back, shared by every replica
 * through Redis. A mark holds only a fingerprint of the refresh token, never
 * a credential, and lasts as long as a Slack token lives: after that the old
 * access token has expired, and the mark has nothing left to protect.
 */
export function createRedisSpentRefreshTokens(
  redis: Redis,
): SpentRefreshTokens {
  const marks = createRedisTtlStore<true>(
    redis,
    "slack-app-token:spent",
    SLACK_TOKEN_LIFETIME_MS,
  );
  return {
    mark: (fingerprint) => marks.set(fingerprint, true),
    isSpent: async (fingerprint) => (await marks.peek(fingerprint)) !== null,
  };
}
