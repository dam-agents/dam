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

export interface SlackInstallServiceDeps {
  find: (teamId: string) => Promise<SlackInstall | null>;
  upsert: (install: {
    teamId: string;
    teamName: string | null;
    secretPath: string;
    secretField: string;
    installedBy: string | null;
  }) => Promise<void>;
  setState: (teamId: string, state: SlackCredentialState) => Promise<void>;
  secrets: SecretStore;
  installLock: XactLock;
  envBotToken: string | null;
  now?: () => number;
}

export interface SlackInstallService {
  resolveBotToken: SlackTokenResolver;
  record: (install: SlackInstallRecord) => Promise<void>;
  markRejected: (teamId: string) => Promise<void>;
}

export function createSlackInstallService(
  deps: SlackInstallServiceDeps,
): SlackInstallService {
  const now = deps.now ?? (() => Date.now());
  const tokens = new Map<string, { token: string | null; at: number }>();
  const inFlight = new Map<string, Promise<string | null>>();

  async function readWorkspaceToken(teamId: string): Promise<string | null> {
    const install = await deps.find(teamId);
    if (!install) return deps.envBotToken;
    if (install.credentialState !== "active") return null;
    const stored = await deps.secrets.getField({
      storeId: deps.secrets.storeId,
      path: install.secretPath,
      field: install.secretField,
    });
    return stored ?? null;
  }

  return {
    async resolveBotToken(teamId: SlackWorkspace): Promise<string | null> {
      if (teamId === ORIGINAL_WORKSPACE) return deps.envBotToken;

      const cached = tokens.get(teamId);
      if (cached && now() - cached.at < TOKEN_CACHE_TTL_MS) return cached.token;

      const pending = inFlight.get(teamId);
      if (pending) return pending;

      const resolving = readWorkspaceToken(teamId)
        .then((token) => {
          tokens.set(teamId, { token, at: now() });
          return token;
        })
        .finally(() => inFlight.delete(teamId));
      inFlight.set(teamId, resolving);
      return resolving;
    },

    async record(install: SlackInstallRecord): Promise<void> {
      await deps.installLock(`slack-install:${install.teamId}`, async () => {
        const meta = { owner: SECRET_OWNER, purpose: SECRET_PURPOSE };
        const existing = await deps.find(install.teamId);
        const ref: SecretRef = existing
          ? {
              storeId: deps.secrets.storeId,
              path: existing.secretPath,
              field: existing.secretField,
            }
          : { ...deps.secrets.mintRef(meta), field: SECRET_FIELD };

        await deps.secrets.put(ref, { [ref.field]: install.botToken }, meta);
        await deps.upsert({
          teamId: install.teamId,
          teamName: install.teamName,
          secretPath: ref.path,
          secretField: ref.field,
          installedBy: install.installedBy,
        });
        tokens.delete(install.teamId);
      });
    },

    async markRejected(teamId: string): Promise<void> {
      await deps.setState(teamId, "rejected");
      tokens.delete(teamId);
    },
  };
}
