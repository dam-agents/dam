import type { SecretRef } from "api-server-api";
import type { SecretStore } from "../../secret-store/index.js";
import type { XactLock } from "../../../core/xact-lock.js";
import type {
  SlackTokenResolver,
  SlackWorkspace,
} from "../infrastructure/slack-gateway.js";
import type {
  SlackCredentialState,
  SlackInstall,
} from "../infrastructure/slack-installs-repository.js";
import type {
  SlackRotatingToken,
  SlackTokenGrant,
} from "../infrastructure/slack-token-rotation.js";
import { securityLog } from "../../../core/security-log.js";
import { formatError } from "../../../core/format-error.js";

const TOKEN_CACHE_TTL_MS = 60_000;
const SECRET_PURPOSE = "slack-install";
const SECRET_OWNER = "platform";
const SECRET_FIELD = "botToken";
const REFRESH_TOKEN_FIELD = "refreshToken";
const EXPIRES_AT_FIELD = "expiresAt";
const REFRESH_AHEAD_MS = 30 * 60_000;
const EXCHANGE_RETRY_MS = 10 * 60_000;

export interface SlackInstallRecord {
  teamId: string;
  teamName: string | null;
  botToken: string;
  rotation?: Omit<SlackRotatingToken, "accessToken"> | null;
  installedBy: string | null;
}

export interface SlackInstallServiceDeps {
  find: (teamId: string) => Promise<SlackInstall | null>;
  list: () => Promise<SlackInstall[]>;
  upsert: (install: {
    teamId: string;
    teamName: string | null;
    secretPath: string;
    secretField: string;
    installedBy: string | null;
  }) => Promise<void>;
  claimUnscopedBindings: (teamId: string) => Promise<number>;
  setState: (teamId: string, state: SlackCredentialState) => Promise<void>;
  secrets: SecretStore;
  installLock: XactLock;
  refreshToken: SlackTokenGrant | null;
  exchangeToken: SlackTokenGrant | null;
  now?: () => number;
}

export interface SlackInstallService {
  resolveBotToken: SlackTokenResolver;
  importHelmToken: (teamId: string, token: string) => Promise<void>;
  renewAll: () => Promise<void>;
  forgetBotToken: (teamId: string) => void;
  record: (install: SlackInstallRecord) => Promise<string>;
  markRejected: (teamId: string) => Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which credential answers for a Slack workspace.
 *
 * Every workspace's token lives in a Secret its install row points at, and a
 * workspace with no row is served by nothing — so a workspace that installed
 * the app without this platform's consent, or whose install was refused, is
 * not answered for at all. Slack names a workspace by its team id in the same
 * response that mints its token, so nothing about which row serves which
 * workspace is ever inferred.
 *
 * Installs that predate multi-workspace support were served by a token from
 * Helm values, and their bindings carry no workspace. While that token is
 * still configured it is imported once: it becomes its workspace's row, unless
 * the workspace already has one from re-authorizing, and every binding without
 * a workspace is rewritten to name that one. From then on the Helm token is
 * never served and nothing about that workspace differs from any other.
 *
 * Where the app has token rotation on, a row's token expires and comes with a
 * single-use refresh token; both are replaced together, under the workspace's
 * lock, shortly before expiry. The lock is what keeps two replicas from spending
 * the same refresh token, and the re-read inside it lets the later one pick up
 * what the earlier one wrote. A refresh Slack refuses once the token has
 * expired marks the credential, like any other rejection.
 *
 * A token that does not expire — minted before rotation was turned on — is
 * exchanged for a rotating pair once exchanging is enabled, under the same
 * lock. Slack retires the old token as it answers, so the pair replaces it in
 * the row's Secret at once. A failed exchange keeps serving the token it could
 * not exchange, and waits a while before trying again. Once the gateway is up,
 * every workspace is renewed straight away, so exchanges happen at boot rather
 * than waiting for a workspace's first message.
 */
export function createSlackInstallService(
  deps: SlackInstallServiceDeps,
): SlackInstallService {
  const now = deps.now ?? (() => Date.now());
  const tokens = new Map<string, { token: string | null; at: number }>();
  const inFlight = new Map<string, Promise<string | null>>();
  const exchangeRetryAt = new Map<string, number>();

  interface Stored {
    token: string | null;
    rotation: { refreshToken: string; expiresAt: number } | null;
  }

  async function readStored(install: SlackInstall): Promise<Stored> {
    const stored = await deps.secrets.get({
      storeId: deps.secrets.storeId,
      path: install.secretPath,
    });
    const token = stored?.[install.secretField] ?? null;
    const refreshToken = stored?.[REFRESH_TOKEN_FIELD];
    const expiresAt = Number(stored?.[EXPIRES_AT_FIELD]);
    const rotation =
      refreshToken && Number.isFinite(expiresAt)
        ? { refreshToken, expiresAt }
        : null;
    return { token, rotation };
  }

  function exchangeDue(teamId: string): boolean {
    return (
      deps.exchangeToken !== null && (exchangeRetryAt.get(teamId) ?? 0) <= now()
    );
  }

  function renewalDue(teamId: string, stored: Stored): boolean {
    if (stored.token === null) return false;
    if (stored.rotation === null) return exchangeDue(teamId);
    return stored.rotation.expiresAt - now() < REFRESH_AHEAD_MS;
  }

  async function writeInstall(install: SlackInstallRecord): Promise<string> {
    const meta = { owner: SECRET_OWNER, purpose: SECRET_PURPOSE };
    const existing = await deps.find(install.teamId);
    const ref: SecretRef = existing
      ? {
          storeId: deps.secrets.storeId,
          path: existing.secretPath,
          field: existing.secretField,
        }
      : { ...deps.secrets.mintRef(meta), field: SECRET_FIELD };

    await deps.secrets.put(
      ref,
      {
        [ref.field]: install.botToken,
        ...(install.rotation
          ? {
              [REFRESH_TOKEN_FIELD]: install.rotation.refreshToken,
              [EXPIRES_AT_FIELD]: String(install.rotation.expiresAt),
            }
          : {}),
      },
      meta,
    );
    await deps.upsert({
      teamId: install.teamId,
      teamName: install.teamName,
      secretPath: ref.path,
      secretField: ref.field,
      installedBy: install.installedBy,
    });
    tokens.delete(install.teamId);
    return ref.path;
  }

  async function exchange(
    install: SlackInstall,
    token: string,
  ): Promise<string> {
    const teamId = install.teamId;
    if (!exchangeDue(teamId)) return token;
    const result = await deps.exchangeToken!(token);
    if (!result.ok) {
      exchangeRetryAt.set(teamId, now() + EXCHANGE_RETRY_MS);
      securityLog("warn", "slack.token.exchange.failed", {
        category: "credential",
        actor: null,
        actorKind: "system",
        surface: "slack",
        result: "failure",
        reason: result.error,
        detail: { teamId },
      });
      return token;
    }
    try {
      await writeInstall({
        teamId,
        teamName: install.teamName,
        botToken: result.accessToken,
        rotation: {
          refreshToken: result.refreshToken,
          expiresAt: result.expiresAt,
        },
        installedBy: install.installedBy,
      });
    } catch (err) {
      securityLog("error", "slack.token.exchange.unsaved", {
        category: "credential",
        actor: null,
        actorKind: "system",
        surface: "slack",
        result: "failure",
        reason: formatError(err),
        detail: { teamId },
      });
      throw err;
    }
    securityLog("info", "slack.token.exchanged", {
      category: "credential",
      actor: null,
      actorKind: "system",
      surface: "slack",
      result: "success",
      detail: { teamId },
    });
    return result.accessToken;
  }

  async function refresh(
    install: SlackInstall,
    token: string,
    rotation: NonNullable<Stored["rotation"]>,
  ): Promise<string | null> {
    const expired = rotation.expiresAt <= now();
    if (!deps.refreshToken) return expired ? null : token;
    const result = await deps.refreshToken(rotation.refreshToken);
    if (result.ok) {
      await deps.secrets.putFields(
        {
          storeId: deps.secrets.storeId,
          path: install.secretPath,
          field: install.secretField,
        },
        {
          [install.secretField]: result.accessToken,
          [REFRESH_TOKEN_FIELD]: result.refreshToken,
          [EXPIRES_AT_FIELD]: String(result.expiresAt),
        },
      );
      return result.accessToken;
    }
    securityLog("error", "slack.token.refresh.failed", {
      category: "credential",
      actor: null,
      actorKind: "system",
      surface: "slack",
      result: "failure",
      reason: result.error,
      detail: { teamId: install.teamId, expired },
    });
    if (!expired) return token;
    if (result.refusal !== null) {
      await deps.setState(install.teamId, "rejected");
    }
    return null;
  }

  async function renew(teamId: string): Promise<string | null> {
    return deps.installLock(`slack-install:${teamId}`, async () => {
      const install = await deps.find(teamId);
      if (!install || install.credentialState !== "active") return null;
      const stored = await readStored(install);
      if (stored.token === null || !renewalDue(teamId, stored)) {
        return stored.token;
      }
      return stored.rotation === null
        ? exchange(install, stored.token)
        : refresh(install, stored.token, stored.rotation);
    });
  }

  async function readWorkspaceToken(teamId: string): Promise<string | null> {
    const install = await deps.find(teamId);
    if (!install || install.credentialState !== "active") return null;
    const stored = await readStored(install);
    return renewalDue(teamId, stored) ? renew(teamId) : stored.token;
  }

  async function resolveBotToken(
    teamId: SlackWorkspace,
  ): Promise<string | null> {
    const key = teamId;

    const cached = tokens.get(key);
    if (cached && now() - cached.at < TOKEN_CACHE_TTL_MS) return cached.token;

    const pending = inFlight.get(key);
    if (pending) return pending;

    const resolving = readWorkspaceToken(key)
      .then((token) => {
        tokens.set(key, { token, at: now() });
        return token;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, resolving);
    return resolving;
  }

  return {
    async renewAll(): Promise<void> {
      const teamIds = new Set(
        (await deps.list())
          .filter((i) => i.credentialState === "active")
          .map((i) => i.teamId),
      );
      for (const teamId of teamIds) {
        tokens.delete(teamId);
        try {
          await resolveBotToken(teamId);
        } catch (err) {
          securityLog("error", "slack.token.renew.failed", {
            category: "credential",
            actor: null,
            actorKind: "system",
            surface: "slack",
            result: "failure",
            reason: formatError(err),
            detail: { teamId },
          });
        }
      }
    },

    async importHelmToken(teamId: string, token: string): Promise<void> {
      await deps.installLock(`slack-install:${teamId}`, async () => {
        const existing = await deps.find(teamId);
        if (!existing) {
          await writeInstall({
            teamId,
            teamName: null,
            botToken: token,
            installedBy: null,
          });
        }
        const claimed = await deps.claimUnscopedBindings(teamId);
        if (!existing || claimed > 0) {
          securityLog("info", "slack.install.imported", {
            category: "credential",
            actor: null,
            actorKind: "system",
            surface: "slack",
            result: "success",
            detail: { teamId, rowCreated: !existing, bindingsClaimed: claimed },
          });
        }
      });
    },

    forgetBotToken(teamId: string): void {
      tokens.delete(teamId);
    },

    resolveBotToken,

    async record(install: SlackInstallRecord): Promise<string> {
      return deps.installLock(`slack-install:${install.teamId}`, () =>
        writeInstall(install),
      );
    },

    async markRejected(teamId: string): Promise<void> {
      await deps.setState(teamId, "rejected");
      tokens.delete(teamId);
    },
  };
}
