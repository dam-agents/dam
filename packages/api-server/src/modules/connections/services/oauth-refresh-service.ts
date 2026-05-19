/**
 * Re-mints OAuth access tokens from stored refresh tokens before the access
 * token's `expiresAt`, writes the new pair back into the same K8s Secret, and
 * surfaces hard failures by flipping the Secret's connection-status to
 * `expired` so the UI can prompt the user to reconnect.
 *
 * Why this exists: Envoy's `injected_credentials.oauth2` source supports only
 * the `client_credentials` grant (envoyproxy/envoy#39183). For our
 * authorization-code + refresh-token flow we need an out-of-band loop that
 * refreshes tokens and lets Envoy hot-reload via SDS file watch. ADR-033
 * § "Token provisioning and refresh" calls this out as net-new work.
 *
 * State is the K8s Secrets — the loop is idempotent and crash-safe; on
 * restart it re-derives its work list. Single-process; multi-replica leader
 * election is a follow-up.
 */
import {
  listAllConnectionWorkItems,
  markConnectionExpired,
  readConnectionForRefresh,
  writeRefreshedTokens,
  type ConnectionMetadata,
  type ConnectionTokens,
  type ConnectionWorkItem,
} from "../infrastructure/k8s-connections-port.js";
import type { K8sClient } from "../../agents/infrastructure/k8s.js";

export interface OAuthRefreshServiceConfig {
  /** How often the loop wakes to scan for due refreshes. Default 60s. */
  intervalMs?: number;
  /** Refresh when `expiresAt - now < skewSeconds`. Default 300 (5 min). */
  skewSeconds?: number;
  /** Initial backoff after a transient failure. Default 30_000. */
  baseBackoffMs?: number;
  /** Cap on the backoff. Default 600_000 (10 min). */
  maxBackoffMs?: number;
}

export interface OAuthRefreshService {
  start(): void;
  stop(): Promise<void>;
  /** Run a single pass — exposed for tests. */
  tick(): Promise<void>;
}

interface BackoffState {
  /** Timestamp (ms) of the next allowed attempt. */
  nextAttemptAt: number;
  /** Number of consecutive transient failures, used to scale the backoff. */
  failures: number;
}

interface TokenEndpointSuccess {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

const HARD_FAILURE_ERRORS = new Set([
  // RFC 6749 § 5.2 — standard error codes returned by spec-compliant providers.
  "invalid_grant",
  "invalid_client",
  "unauthorized_client",
  "unsupported_grant_type",
  // GitHub-specific codes: GitHub's OAuth endpoint never uses the RFC names,
  // it returns these instead. Without them we'd churn in transient backoff on
  // a permanently-dead refresh token until the access token expired and the
  // UI flipped the connection to "Expired" via the `expiresAt < now` path.
  "bad_refresh_token",
  "incorrect_client_credentials",
]);

/**
 * OAuth 2.1 token-endpoint bodies are JSON in the spec, but GitHub's endpoint
 * defaults to `application/x-www-form-urlencoded` unless the request carries
 * `Accept: application/json`. Try JSON first, then form-encoded — whichever
 * yields an object. Returns an empty object on total failure; callers treat
 * missing fields as transient.
 */
function parseTokenEndpointBody(
  body: string,
  contentType: string | null,
): Record<string, unknown> {
  const ct = contentType ?? "";
  if (ct.includes("application/json")) {
    try {
      return JSON.parse(body) as Record<string, unknown>;
    } catch {
      // Provider lied about content-type — fall through.
    }
  }
  // Form-encoded fallback. `URLSearchParams` accepts the body even if the
  // content-type was JSON; if the body wasn't form-encoded either, we end up
  // with an empty params object.
  if (body.length > 0 && !body.startsWith("{")) {
    const parsed = new URLSearchParams(body);
    const out: Record<string, unknown> = {};
    for (const [k, v] of parsed) {
      out[k] = k === "expires_in" ? Number(v) : v;
    }
    if (Object.keys(out).length > 0) return out;
  }
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function createOAuthRefreshService(deps: {
  k8sClient: K8sClient;
  config?: OAuthRefreshServiceConfig;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
  /** Injected for tests. */
  now?: () => number;
  /** Injected for tests; if omitted, no log output. */
  log?: (level: "info" | "warn" | "error", msg: string, data?: object) => void;
}): OAuthRefreshService {
  const intervalMs = deps.config?.intervalMs ?? 60_000;
  const skewSeconds = deps.config?.skewSeconds ?? 300;
  const baseBackoffMs = deps.config?.baseBackoffMs ?? 30_000;
  const maxBackoffMs = deps.config?.maxBackoffMs ?? 600_000;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? (() => Date.now());
  const log =
    deps.log ??
    ((level, msg, data) => {
      // Stable token (`oauth-refresh`) so log scrapers can dashboard the loop
      // without depending on free-form text.
      const line =
        `[oauth-refresh] ${msg}` + (data ? ` ${JSON.stringify(data)}` : "");
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else process.stderr.write(line + "\n");
    });

  // Per-Secret backoff. The map key is the Secret name (stable); state is
  // process-local, so a restart resets backoff — acceptable since backoff
  // exists to avoid hammering a flaky token endpoint, not to enforce SLOs.
  const backoff = new Map<string, BackoffState>();

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopping = false;
  let inFlight: Promise<void> = Promise.resolve();

  function isDue(item: ConnectionWorkItem, nowMs: number): boolean {
    // Skip items Envoy already refreshes natively.
    if (item.grantType === "client_credentials") return false;
    // Skip items already marked expired — they need a user reconnect, not
    // another refresh attempt with the same dead refresh token.
    if (item.status === "expired") return false;
    // Without an expiresAt we can't tell if it's due; conservatively skip.
    // Most providers that omit `expires_in` issue long-lived tokens.
    if (item.expiresAt == null) return false;
    const expiresAtMs = item.expiresAt * 1000;
    return expiresAtMs - nowMs < skewSeconds * 1000;
  }

  function isInBackoff(name: string, nowMs: number): boolean {
    const state = backoff.get(name);
    return state != null && state.nextAttemptAt > nowMs;
  }

  function recordTransientFailure(name: string, nowMs: number) {
    const prev = backoff.get(name);
    const failures = (prev?.failures ?? 0) + 1;
    const delayMs = Math.min(
      baseBackoffMs * 2 ** Math.min(failures - 1, 10),
      maxBackoffMs,
    );
    backoff.set(name, { nextAttemptAt: nowMs + delayMs, failures });
  }

  function clearBackoff(name: string) {
    backoff.delete(name);
  }

  async function refreshOne(item: ConnectionWorkItem): Promise<void> {
    const loaded = await readConnectionForRefresh(deps.k8sClient, item.name);
    if (!loaded) return;
    const { record } = loaded;
    const { metadata, tokens } = record;
    if (!tokens.refreshToken) {
      // Nothing we can do without a refresh token; mark expired so the UI
      // surfaces it. (Strictly the access token is still alive until expiry,
      // but we won't be able to recover after that — better to notify now.)
      log("warn", "no refresh token; marking expired", {
        owner: item.owner,
        connection: item.connection,
      });
      await markConnectionExpired(deps.k8sClient, item.name);
      return;
    }
    if (!metadata.tokenUrl || !metadata.clientId) {
      log("error", "missing token-url or client-id; cannot refresh", {
        owner: item.owner,
        connection: item.connection,
      });
      return;
    }
    const params = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refreshToken,
      client_id: metadata.clientId,
    });
    if (metadata.clientSecret)
      params.set("client_secret", metadata.clientSecret);

    const res = await fetchImpl(metadata.tokenUrl, {
      method: "POST",
      // GitHub's token endpoint returns `application/x-www-form-urlencoded`
      // unless explicitly asked for JSON. Without `Accept`, the success-path
      // JSON.parse below would throw and we'd churn in backoff until the
      // access token's `expiresAt` slid past now and the UI flipped the
      // connection to "Expired". The body parser still tolerates a
      // form-encoded reply defensively for providers that ignore Accept.
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: params,
    });

    const bodyText = await res.text();
    const parsed = parseTokenEndpointBody(
      bodyText,
      res.headers.get("content-type"),
    );

    // GitHub returns HTTP 200 with `{error: …}` (or `error=…` form-encoded)
    // when the refresh token is bad. Treat as a hard failure regardless of
    // status code so the connection lands in `expired` and prompts re-auth
    // instead of churning in backoff.
    const errCode = typeof parsed.error === "string" ? parsed.error : null;
    if (errCode != null && HARD_FAILURE_ERRORS.has(errCode)) {
      log("warn", "hard refresh failure; marking expired", {
        owner: item.owner,
        connection: item.connection,
        error: errCode,
        status: res.status,
      });
      await markConnectionExpired(deps.k8sClient, item.name);
      clearBackoff(item.name);
      return;
    }

    if (
      res.ok &&
      typeof parsed.access_token === "string" &&
      parsed.access_token.length > 0
    ) {
      const data = parsed as unknown as TokenEndpointSuccess;
      const expiresAt = data.expires_in
        ? Math.floor(now() / 1000) + data.expires_in
        : undefined;
      const newTokens: ConnectionTokens = {
        accessToken: data.access_token,
        // Some providers rotate refresh tokens; many don't. Keep the old one
        // when the response omits `refresh_token`.
        refreshToken: data.refresh_token ?? tokens.refreshToken,
        ...(expiresAt != null ? { expiresAt } : {}),
      };
      await writeRefreshedTokens(
        deps.k8sClient,
        item.name,
        newTokens,
        metadata satisfies ConnectionMetadata,
      );
      clearBackoff(item.name);
      log("info", "refreshed", {
        owner: item.owner,
        connection: item.connection,
        expiresAt,
      });
      return;
    }

    log("warn", "transient refresh failure; backing off", {
      owner: item.owner,
      connection: item.connection,
      status: res.status,
      error: errCode,
      bodySnippet: bodyText.slice(0, 200),
    });
    recordTransientFailure(item.name, now());
  }

  async function tickOnce(): Promise<void> {
    const nowMs = now();
    let items: ConnectionWorkItem[];
    try {
      items = await listAllConnectionWorkItems(deps.k8sClient);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log("error", "failed to list connection secrets", { error: message });
      return;
    }
    for (const item of items) {
      if (!isDue(item, nowMs)) continue;
      if (isInBackoff(item.name, nowMs)) continue;
      try {
        await refreshOne(item);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log("error", "refresh threw", {
          owner: item.owner,
          connection: item.connection,
          error: message,
        });
        recordTransientFailure(item.name, now());
      }
    }
  }

  return {
    start() {
      if (timer != null) return;
      // Run once immediately so a freshly-restarted api-server doesn't wait a
      // whole interval before catching up on near-expired tokens.
      inFlight = inFlight.then(tickOnce).catch(() => undefined);
      timer = setInterval(() => {
        if (stopping) return;
        inFlight = inFlight.then(tickOnce).catch(() => undefined);
      }, intervalMs);
    },
    async stop() {
      stopping = true;
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
      await inFlight;
    },
    async tick() {
      await tickOnce();
    },
  };
}
