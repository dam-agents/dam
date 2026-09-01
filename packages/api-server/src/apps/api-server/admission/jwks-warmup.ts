import { getLogger } from "../../../core/logger.js";
import { pollUntilReady } from "../../../modules/agents/infrastructure/poll-until-ready.js";

export const JWKS_WARM_INITIAL_MS = 1_000;
export const JWKS_WARM_MAX_MS = 10_000;
export const JWKS_WARM_TIMEOUT_MS = 240_000;

export interface JwksWarmup {
  ready: () => boolean;
  done: Promise<void>;
}

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
    {
      initialMs: opts.initialMs ?? JWKS_WARM_INITIAL_MS,
      maxMs: opts.maxMs ?? JWKS_WARM_MAX_MS,
      timeoutMs: opts.timeoutMs ?? JWKS_WARM_TIMEOUT_MS,
    },
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
