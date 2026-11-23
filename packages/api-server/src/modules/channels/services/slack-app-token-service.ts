import { createHash } from "node:crypto";
import type { SecretStore } from "../../secret-store/index.js";
import type { XactLock } from "../../../core/xact-lock.js";
import type {
  SlackRotatingToken,
  SlackTokenRotation,
} from "../infrastructure/slack-token-rotation.js";
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
const IMPORT_RETRY_MS = 10 * 60_000;
const ROTATING_TOKEN_PREFIX = "xoxe.";

export interface SpentRefreshTokens {
  mark: (fingerprint: string) => Promise<void>;
  isSpent: (fingerprint: string) => Promise<boolean>;
}

export interface SlackAppTokenServiceDeps {
  helmToken: string;
  helmRefreshToken: string | null;
  secrets: SecretStore;
  lock: XactLock;
  rotation: SlackTokenRotation;
  spentRefreshTokens: SpentRefreshTokens;
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
 * The service exists only where the install turned app-level token rotation
 * on. Slack does not exchange an existing long-lived app-level token for a
 * rotating one: an operator generates a new app-level token after rotation
 * is on, and gives its single-use refresh token to the install in Helm
 * values. That refresh token is the import: it is spent once with
 * `oauth.v2.access` for a token that expires after twelve hours and a new
 * refresh token, and the pair goes into one install-wide Secret together
 * with a fingerprint of the Helm value it came from. Until then the
 * long-lived app-level token from Helm values keeps the socket up, so the
 * switch-over has no gap, and with no refresh token in Helm values it stays
 * on that token. From then on the Secret answers, and the pair is renewed
 * with `oauth.v2.access` once the token is an hour old, the same pace as a
 * workspace's bot token, so an outage has eleven hours to pass. The Helm
 * refresh token is spent by the import, so the same value is never imported
 * again; only a different one is.
 *
 * Import and renewal run under one lock, with the Secret re-read inside it,
 * so two replicas never spend the same refresh token. A failed import keeps
 * serving the long-lived token and tries again ten minutes later. A pair Slack
 * minted but the Secret could not take is the only copy of its single-use
 * refresh token, so it is kept in memory and served, and the next call saves
 * it under the lock before it asks Slack for anything. It is saved only over
 * the pair it replaced: when the Secret has moved on, another replica saved a
 * newer pair, and the kept one is dropped. Until it is saved, the refresh
 * token it replaced is marked spent, by fingerprint, where every replica
 * sees it: another replica reads the old pair from the Secret, and while its
 * token is still valid it serves that token instead of offering the spent
 * refresh token to Slack again. Once that token has expired, a renewal is
 * tried anyway, because the replica holding the kept pair may have
 * restarted. A failed renewal
 * keeps serving the token while it is still valid. Once it has expired, Slack
 * refusing the refresh token as dead marks the Secret refused, and nothing is
 * served until a person sets a new refresh token in Helm values: a Helm
 * value whose fingerprint differs from the stored one is imported, so the
 * refresh token of a newly generated app-level token is how an operator
 * recovers.
 */
export function createSlackAppTokenService(
  deps: SlackAppTokenServiceDeps,
): SlackAppTokenService {
  const now = () => deps.rotation.now();
  const importToken = deps.helmRefreshToken || null;
  const helmFingerprint = importToken ? fingerprint(importToken) : null;
  let importRetryAt = 0;
  let unsaved: { pair: StoredAppToken; replaces: string | null } | null = null;

  if (deps.helmToken.startsWith(ROTATING_TOKEN_PREFIX)) {
    logAppToken("warn", "slack.app_token.rotating_in_helm", {
      result: "failure",
      reason:
        "a rotating app-level token in Helm values comes without its refresh token and expires within twelve hours; set the long-lived xapp- token instead",
    });
  }
  if (importToken === null) {
    logAppToken("warn", "slack.app_token.refresh_token_missing", {
      result: "failure",
      reason:
        "app-level token rotation is on but apiServer.slackAppRefreshToken is empty; Socket Mode stays on the long-lived apiServer.slackAppToken",
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
    if (helmFingerprint === null) return null;
    return stored?.importedFrom === helmFingerprint ? stored : null;
  }

  function importDue(): boolean {
    return importToken !== null && importRetryAt <= now();
  }

  function renewalDue(stored: StoredAppToken | null): boolean {
    if (stored === null) return importDue();
    if (stored.refused) return false;
    return stored.expiresAt - now() < REFRESH_AHEAD_MS;
  }

  function served(stored: StoredAppToken | null): string | null {
    if (stored === null) return deps.helmToken;
    if (stored.refused || stored.expiresAt <= now()) return null;
    return stored.token;
  }

  async function save(pair: StoredAppToken): Promise<boolean> {
    try {
      await deps.secrets.put(
        {
          storeId: deps.secrets.storeId,
          path: SLACK_APP_TOKEN_SECRET_PATH,
          field: TOKEN_FIELD,
        },
        {
          [TOKEN_FIELD]: pair.token,
          [REFRESH_TOKEN_FIELD]: pair.refreshToken,
          [EXPIRES_AT_FIELD]: String(pair.expiresAt),
          [IMPORTED_FROM_FIELD]: pair.importedFrom,
        },
        SECRET_META,
      );
      return true;
    } catch (err) {
      logAppToken("error", "slack.app_token.unsaved", {
        result: "failure",
        reason: formatError(err),
      });
      return false;
    }
  }

  async function keep(
    result: SlackRotatingToken,
    importedFrom: string,
    replaces: string | null,
  ): Promise<string> {
    const pair: StoredAppToken = {
      token: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
      importedFrom,
      refused: false,
    };
    if (await save(pair)) {
      unsaved = null;
      return pair.token;
    }
    unsaved = { pair, replaces };
    if (replaces !== null) {
      try {
        await deps.spentRefreshTokens.mark(fingerprint(replaces));
      } catch (err) {
        logAppToken("error", "slack.app_token.spent_unmarked", {
          result: "failure",
          reason: formatError(err),
        });
      }
    }
    return pair.token;
  }

  async function importPair(): Promise<string> {
    if (importToken === null || helmFingerprint === null || !importDue()) {
      return deps.helmToken;
    }
    const result = await deps.rotation.refresh(importToken);
    if (!result.ok) {
      importRetryAt = now() + IMPORT_RETRY_MS;
      logAppToken("warn", "slack.app_token.import.failed", {
        result: "failure",
        reason: result.credentialDead
          ? `${result.error}; a refresh token works once, so set the refresh token of a newly generated app-level token in apiServer.slackAppRefreshToken`
          : result.error,
      });
      return deps.helmToken;
    }
    logAppToken("info", "slack.app_token.imported", { result: "success" });
    return keep(result, helmFingerprint, null);
  }

  async function refresh(stored: StoredAppToken): Promise<string | null> {
    const expired = stored.expiresAt <= now();
    const result = await deps.rotation.refresh(stored.refreshToken);
    if (result.ok)
      return keep(result, stored.importedFrom, stored.refreshToken);
    const refused = expired && result.credentialDead;
    logAppToken(
      "error",
      "slack.app_token.refresh.failed",
      {
        result: "failure",
        reason: refused
          ? `${result.error}; Slack stays down until the refresh token of a newly generated app-level token is set in apiServer.slackAppRefreshToken`
          : result.error,
      },
      { expired },
    );
    if (refused) {
      await deps.secrets.putFields(
        {
          storeId: deps.secrets.storeId,
          path: SLACK_APP_TOKEN_SECRET_PATH,
          field: TOKEN_FIELD,
        },
        { [REFUSED_FIELD]: "true" },
      );
    }
    return served(stored);
  }

  async function renewUnderLock(): Promise<string | null> {
    return deps.lock(LOCK_KEY, async () => {
      let stored = current(await readStored());
      if (unsaved) {
        const { pair, replaces } = unsaved;
        if (replaces !== (stored?.refreshToken ?? null)) {
          unsaved = null;
        } else if (await save(pair)) {
          unsaved = null;
          stored = pair;
        } else {
          return served(pair);
        }
      }
      if (!renewalDue(stored)) return served(stored);
      if (stored === null) return importPair();
      if (await spentElsewhere(stored)) return served(stored);
      return refresh(stored);
    });
  }

  async function spentElsewhere(stored: StoredAppToken): Promise<boolean> {
    if (stored.expiresAt <= now()) return false;
    try {
      return await deps.spentRefreshTokens.isSpent(
        fingerprint(stored.refreshToken),
      );
    } catch (err) {
      logAppToken("error", "slack.app_token.spent_unread", {
        result: "failure",
        reason: formatError(err),
      });
      return false;
    }
  }

  async function resolveAppToken(): Promise<string | null> {
    const stored = current(await readStored());
    return unsaved !== null || renewalDue(stored)
      ? renewUnderLock()
      : served(stored);
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
