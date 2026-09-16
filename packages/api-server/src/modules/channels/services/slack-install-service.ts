import type { SecretRef } from "api-server-api";
import type { SecretStore } from "../../secret-store/index.js";
import type { XactLock } from "../../../core/xact-lock.js";
import {
  ORIGINAL_WORKSPACE,
  type SlackTokenResolver,
  type SlackWorkspace,
} from "../infrastructure/slack-gateway.js";
import type {
  SlackCredentialState,
  SlackInstall,
} from "../infrastructure/slack-installs-repository.js";

const TOKEN_CACHE_TTL_MS = 60_000;
const SECRET_PURPOSE = "slack-install";
const SECRET_OWNER = "platform";
const SECRET_FIELD = "botToken";

export interface SlackInstallRecord {
  teamId: string;
  teamName: string | null;
  botToken: string;
  installedBy: string | null;
}

export interface SlackInstallRefusal {
  teamId: string;
  teamName: string | null;
}

export interface SlackInstallServiceDeps {
  find: (teamId: string) => Promise<SlackInstall | null>;
  upsert: (install: {
    teamId: string;
    teamName: string | null;
    secretPath: string | null;
    secretField: string | null;
    installedBy: string | null;
    credentialState: SlackCredentialState;
  }) => Promise<void>;
  setState: (teamId: string, state: SlackCredentialState) => Promise<void>;
  secrets: SecretStore;
  installLock: XactLock;
  envBotToken: string | null;
  identifyWorkspace: (botToken: string) => Promise<string | null>;
  now?: () => number;
}

export interface SlackInstallService {
  resolveBotToken: SlackTokenResolver;
  record: (install: SlackInstallRecord) => Promise<string>;
  recordRefusal: (refusal: SlackInstallRefusal) => Promise<void>;
  markRejected: (teamId: string) => Promise<void>;
}

export function createSlackInstallService(
  deps: SlackInstallServiceDeps,
): SlackInstallService {
  const now = deps.now ?? (() => Date.now());
  const tokens = new Map<string, { token: string | null; at: number }>();
  const inFlight = new Map<string, Promise<string | null>>();
  let originalWorkspace: string | null = null;
  let identifying: Promise<string | null> | null = null;

  async function originalWorkspaceId(): Promise<string | null> {
    if (originalWorkspace) return originalWorkspace;
    if (!deps.envBotToken) return null;
    identifying ??= deps
      .identifyWorkspace(deps.envBotToken)
      .then((teamId) => {
        if (teamId) originalWorkspace = teamId;
        return teamId;
      })
      .finally(() => {
        identifying = null;
      });
    return identifying;
  }

  async function workspaceKey(teamId: SlackWorkspace): Promise<string | null> {
    return teamId === ORIGINAL_WORKSPACE ? originalWorkspaceId() : teamId;
  }

  async function readWorkspaceToken(
    teamId: string,
  ): Promise<{ token: string | null; answered: boolean }> {
    const install = await deps.find(teamId);
    if (install) {
      if (install.credentialState !== "active" || !install.secretPath) {
        return { token: null, answered: true };
      }
      const stored = await deps.secrets.getField({
        storeId: deps.secrets.storeId,
        path: install.secretPath,
        field: install.secretField ?? SECRET_FIELD,
      });
      return { token: stored ?? null, answered: true };
    }

    const original = await originalWorkspaceId();
    if (original === null) {
      return { token: deps.envBotToken, answered: false };
    }
    return {
      token: original === teamId ? deps.envBotToken : null,
      answered: true,
    };
  }

  return {
    async resolveBotToken(teamId: SlackWorkspace): Promise<string | null> {
      const key = await workspaceKey(teamId);
      if (!key) return deps.envBotToken;

      const cached = tokens.get(key);
      if (cached && now() - cached.at < TOKEN_CACHE_TTL_MS) return cached.token;

      const pending = inFlight.get(key);
      if (pending) return pending;

      const resolving = readWorkspaceToken(key)
        .then(({ token, answered }) => {
          if (answered) tokens.set(key, { token, at: now() });
          return token;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, resolving);
      return resolving;
    },

    async record(install: SlackInstallRecord): Promise<string> {
      return deps.installLock(`slack-install:${install.teamId}`, async () => {
        const meta = { owner: SECRET_OWNER, purpose: SECRET_PURPOSE };
        const existing = await deps.find(install.teamId);
        const ref: SecretRef = existing?.secretPath
          ? {
              storeId: deps.secrets.storeId,
              path: existing.secretPath,
              field: existing.secretField ?? SECRET_FIELD,
            }
          : { ...deps.secrets.mintRef(meta), field: SECRET_FIELD };

        await deps.secrets.put(ref, { [ref.field]: install.botToken }, meta);
        await deps.upsert({
          teamId: install.teamId,
          teamName: install.teamName,
          secretPath: ref.path,
          secretField: ref.field,
          installedBy: install.installedBy,
          credentialState: "active",
        });
        tokens.delete(install.teamId);
        return ref.path;
      });
    },

    async recordRefusal(refusal: SlackInstallRefusal): Promise<void> {
      await deps.installLock(`slack-install:${refusal.teamId}`, async () => {
        await deps.upsert({
          teamId: refusal.teamId,
          teamName: refusal.teamName,
          secretPath: null,
          secretField: null,
          installedBy: null,
          credentialState: "rejected",
        });
        tokens.delete(refusal.teamId);
      });
    },

    async markRejected(teamId: string): Promise<void> {
      await deps.setState(teamId, "rejected");
      tokens.delete(teamId);
    },
  };
}
