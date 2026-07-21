import { getLogger } from "../../core/logger.js";
import { pollUntilReady } from "../../modules/agents/infrastructure/poll-until-ready.js";

export const JWKS_WARM_INITIAL_MS = 1_000;
export const JWKS_WARM_MAX_MS = 10_000;
// Give-up deadline: past the observed mesh-egress convergence window for a
// fresh pod (~1-5 min), yet under the Deployment progressDeadline (600s) and
// the e2e rollout timeouts — a dead Keycloak degrades this pod to 503s on
// authenticated routes instead of wedging the rollout.
export const JWKS_WARM_TIMEOUT_MS = 240_000;

export interface JwksWarmup {
  /** Latched true after the first successful JWKS fetch — or after give-up
   *  (a single-replica deployment must not drop out of every Service
   *  endpoint, public paths included, over an unreachable Keycloak). */
  ready: () => boolean;
  /** Resolves when the loop settles (success or give-up). Exposed for tests. */
  done: Promise<void>;
}

/** Fetch the Keycloak JWKS in the background until it succeeds once.
 *  `/api/ready` reports 503 until then, which under `maxUnavailable: 0`
 *  keeps the previous pod serving while this pod's mesh egress converges —
 *  a rolling update never routes users to a pod that can't verify tokens. */
export function startJwksWarmup(
  warm: () => Promise<void>,
  opts: { initialMs?: number; maxMs?: number; timeoutMs?: number } = {},
): JwksWarmup {
  let ready = false;
  getLogger().info("[jwks-warmup] fetching JWKS from Keycloak");
  const done = pollUntilReady(
    () =>
      warm().then(
        () => true,
        (err: unknown) => {
          getLogger().warn(
            `[jwks-warmup] attempt failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          return false;
        },
      ),
    opts.initialMs ?? JWKS_WARM_INITIAL_MS,
    opts.maxMs ?? JWKS_WARM_MAX_MS,
    opts.timeoutMs ?? JWKS_WARM_TIMEOUT_MS,
  ).then((ok) => {
    ready = true;
    if (ok) {
      getLogger().info("[jwks-warmup] JWKS cached; reporting ready");
    } else {
      getLogger().error(
        "[jwks-warmup] gave up waiting for JWKS; reporting ready anyway — " +
          "authenticated requests will 503 until Keycloak is reachable",
      );
    }
  });
  return { ready: () => ready, done };
}
