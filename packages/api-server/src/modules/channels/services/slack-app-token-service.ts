import { createHash } from "node:crypto";
import type { SecretStore } from "../../secret-store/index.js";
import type { XactLock } from "../../../core/xact-lock.js";
import type { SlackTokenRotation } from "../infrastructure/slack-token-rotation.js";
import { securityLog } from "../../../core/security-log.js";
import { formatError } from "../../../core/format-error.js";

export const SLACK_APP_TOKEN_SECRET_PATH = "platform-secret-slack-app-token";
const SECRET_META = { owner: "platform", purpose: "slack-app-token" };
const LOCK_KEY = "slack-app-token";
const TOKEN_FIELD = "appToken";
const REFRESH_TOKEN_FIELD = "refreshToken";
const EXPIRES_AT_FIELD = "expiresAt";
const IMPORTED_FROM_FIELD = "importedFrom";
const REFUSED_FIELD = "refused";
const REFRESH_AHEAD_MS = 11 * 60 * 60_000;
const EXCHANGE_RETRY_MS = 10 * 60_000;
const ROTATING_TOKEN_PREFIX = "xoxe.";

export interface SlackAppTokenServiceDeps {
  helmToken: string;
  secrets: SecretStore;
  lock: XactLock;
  rotation: SlackTokenRotation;
  exchangeLongLivedToken: boolean;
}

export interface SlackAppTokenService {
  resolveAppToken: () => Promise<string | null>;
  renew: () => Promise<void>;
}

interface StoredAppToken {
  token: string;
  refreshToken: string;
  expiresAt: number;
  importedFrom: string;
  refused: boolean;
}

function fingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function logAppToken(
  level: "info" | "warn" | "error",
  event: string,
  outcome: { result: "success" } | { result: "failure"; reason: string },
  detail?: Record<string, unknown>,
): void {
  securityLog(level, event, {
    category: "credential",
    actor: null,
    actorKind: "system",
    surface: "slack",
    ...outcome,
    ...(detail ? { detail } : {}),
  });
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which app-level token opens the Slack Socket Mode
 * connection.
 *
 * The app-level token from Helm values is an import, not the token served.
 * With token rotation on, it is exchanged once with `oauth.v2.exchange` for a
 * token that expires after twelve hours and a single-use refresh token, and
 * the pair goes into one install-wide Secret together with a fingerprint of
 * the Helm value it came from. From then on the Secret answers, and the pair
 * is renewed with `oauth.v2.access` once the token is an hour old, the same
 * pace as a workspace's bot token, so an outage has eleven hours to pass.
 * Slack retires the Helm token after the first renewal, so a copy of the Helm
 * value stops being useful within hours.
 *
 * Exchange and renewal run under one lock, with the Secret re-read inside it,
 * so two replicas never spend the same refresh token. A failed exchange, or
 * one whose pair could not be saved, keeps serving the Helm token, which
 * Slack retires only at the first renewal, and tries again ten minutes later.
 * A renewed pair that could not be saved is still served, so the socket stays
 * up until the token expires and the error is in the log. A failed renewal
 * keeps serving the token while it is still valid. Once it has expired, Slack
 * refusing the refresh token as dead marks the Secret refused, and nothing is
 * served until a person sets a new app-level token in Helm values: a Helm
 * value whose fingerprint differs from the stored one is imported again, so a
 * regenerated token is how an operator recovers. With rotation off and nothing
 * stored, the Helm token is served as it is, as before rotation existed.
 */
export function createSlackAppTokenService(
  deps: SlackAppTokenServiceDeps,
): SlackAppTokenService {
  const now = () => deps.rotation.now();
  const helmFingerprint = fingerprint(deps.helmToken);
  let exchangeRetryAt = 0;

  if (deps.helmToken.startsWith(ROTATING_TOKEN_PREFIX)) {
    logAppToken("warn", "slack.app_token.rotating_in_helm", {
      result: "failure",
      reason:
        "a rotating app-level token in Helm values comes without its refresh token and expires within twelve hours; set the long-lived xapp- token instead",
    });
  }

  async function readStored(): Promise<StoredAppToken | null> {
    const stored = await deps.secrets.get({
      storeId: deps.secrets.storeId,
      path: SLACK_APP_TOKEN_SECRET_PATH,
    });
    const token = stored?.[TOKEN_FIELD];
    const refreshToken = stored?.[REFRESH_TOKEN_FIELD];
    const expiresAt = Number(stored?.[EXPIRES_AT_FIELD]);
    const importedFrom = stored?.[IMPORTED_FROM_FIELD];
    if (!token || !refreshToken || !importedFrom) return null;
    if (!Number.isFinite(expiresAt)) return null;
    return {
      token,
      refreshToken,
      expiresAt,
      importedFrom,
      refused: stored?.[REFUSED_FIELD] === "true",
    };
  }

  function current(stored: StoredAppToken | null): StoredAppToken | null {
    return stored?.importedFrom === helmFingerprint ? stored : null;
  }

  function exchangeDue(): boolean {
    return deps.exchangeLongLivedToken && exchangeRetryAt <= now();
  }

  function renewalDue(stored: StoredAppToken | null): boolean {
    if (stored === null) return exchangeDue();
    if (stored.refused) return false;
    return stored.expiresAt - now() < REFRESH_AHEAD_MS;
  }

  function served(stored: StoredAppToken | null): string | null {
    if (stored === null) return deps.helmToken;
    if (stored.refused || stored.expiresAt <= now()) return null;
    return stored.token;
  }

  async function exchange(): Promise<string> {
    if (!exchangeDue()) return deps.helmToken;
    const result = await deps.rotation.exchange(deps.helmToken);
    if (!result.ok) {
      exchangeRetryAt = now() + EXCHANGE_RETRY_MS;
      logAppToken("warn", "slack.app_token.exchange.failed", {
        result: "failure",
        reason: result.error,
      });
      return deps.helmToken;
    }
    try {
      await deps.secrets.put(
        {
          storeId: deps.secrets.storeId,
          path: SLACK_APP_TOKEN_SECRET_PATH,
          field: TOKEN_FIELD,
        },
        {
          [TOKEN_FIELD]: result.accessToken,
          [REFRESH_TOKEN_FIELD]: result.refreshToken,
          [EXPIRES_AT_FIELD]: String(result.expiresAt),
          [IMPORTED_FROM_FIELD]: helmFingerprint,
        },
        SECRET_META,
      );
    } catch (err) {
      exchangeRetryAt = now() + EXCHANGE_RETRY_MS;
      logAppToken("error", "slack.app_token.exchange.unsaved", {
        result: "failure",
        reason: formatError(err),
      });
      return deps.helmToken;
    }
    logAppToken("info", "slack.app_token.exchanged", { result: "success" });
    return result.accessToken;
  }

  async function refresh(stored: StoredAppToken): Promise<string | null> {
    const expired = stored.expiresAt <= now();
    const result = await deps.rotation.refresh(stored.refreshToken);
    const ref = {
      storeId: deps.secrets.storeId,
      path: SLACK_APP_TOKEN_SECRET_PATH,
      field: TOKEN_FIELD,
    };
    if (result.ok) {
      try {
        await deps.secrets.putFields(ref, {
          [TOKEN_FIELD]: result.accessToken,
          [REFRESH_TOKEN_FIELD]: result.refreshToken,
          [EXPIRES_AT_FIELD]: String(result.expiresAt),
        });
      } catch (err) {
        logAppToken("error", "slack.app_token.refresh.unsaved", {
          result: "failure",
          reason: formatError(err),
        });
      }
      return result.accessToken;
    }
    const refused = expired && result.credentialDead;
    logAppToken(
      "error",
      "slack.app_token.refresh.failed",
      {
        result: "failure",
        reason: refused
          ? `${result.error}; Slack stays down until a new app-level token is set in apiServer.slackAppToken`
          : result.error,
      },
      { expired },
    );
    if (refused) await deps.secrets.putFields(ref, { [REFUSED_FIELD]: "true" });
    return served(stored);
  }

  async function renewUnderLock(): Promise<string | null> {
    return deps.lock(LOCK_KEY, async () => {
      const stored = current(await readStored());
      if (!renewalDue(stored)) return served(stored);
      return stored === null ? exchange() : refresh(stored);
    });
  }

  async function resolveAppToken(): Promise<string | null> {
    const stored = current(await readStored());
    return renewalDue(stored) ? renewUnderLock() : served(stored);
  }

  return {
    resolveAppToken,
    async renew(): Promise<void> {
      try {
        await resolveAppToken();
      } catch (err) {
        logAppToken("error", "slack.app_token.renew.failed", {
          result: "failure",
          reason: formatError(err),
        });
      }
    },
  };
}
