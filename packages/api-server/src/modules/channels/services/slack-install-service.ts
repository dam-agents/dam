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
  setOriginalWorkspace: (teamId: SlackWorkspace) => void;
  record: (install: SlackInstallRecord) => Promise<string>;
  markRejected: (teamId: string) => Promise<void>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Which credential answers for a Slack workspace.
 *
 * A workspace connected over OAuth is unambiguous: Slack returns its id in the
 * same response as its token, so the row records both and nothing is ever
 * inferred. The one credential that arrives without its workspace is the
 * operator's — pasted into Helm values, naming no workspace — and that is the
 * only thing this unit has to reconcile. Its workspace is told to this unit
 * once, by the gateway, before the gateway begins serving: the answer is a
 * property of the token and never changes, so it is learned once rather than
 * asked for on the path an inbound message takes.
 *
 * That gives the workspace one key for its two names. Bindings made before this
 * platform could connect a second workspace say the empty string; Slack says
 * the real team id on every event it sends; both resolve to the same row, so
 * re-authorizing that workspace takes effect and it is never served by two
 * credentials at once.
 *
 * While that workspace is unknown the empty string names nothing, and nothing
 * is what it is answered with. Answering it with the operator's credential
 * instead would look like the pre-multi-workspace behaviour but is the one
 * thing that breaks the invariant above: the only way the workspace can be
 * unknown is that Slack refused the credential that names it, and if that
 * workspace has since re-authorized then its real team id reaches the live row
 * while the empty string reaches a refused token — one workspace on two
 * credentials, which is exactly what the single key exists to prevent.
 *
 * A workspace with no row is served by nothing. The operator's credential
 * answers for the workspace it was issued for and no other, so a workspace that
 * installed the app without this platform's consent — or whose install was
 * refused — is not answered for at all.
 */
export function createSlackInstallService(
  deps: SlackInstallServiceDeps,
): SlackInstallService {
  const now = deps.now ?? (() => Date.now());
  const tokens = new Map<string, { token: string | null; at: number }>();
  const inFlight = new Map<string, Promise<string | null>>();
  let originalTeamId: string | null = null;

  async function readWorkspaceToken(teamId: string): Promise<string | null> {
    const install = await deps.find(teamId);
    if (!install) {
      return teamId === originalTeamId ? deps.envBotToken : null;
    }
    if (install.credentialState !== "active") return null;
    const stored = await deps.secrets.getField({
      storeId: deps.secrets.storeId,
      path: install.secretPath,
      field: install.secretField,
    });
    return stored ?? null;
  }

  return {
    setOriginalWorkspace(teamId: SlackWorkspace): void {
      originalTeamId = teamId;
      tokens.clear();
    },

    async resolveBotToken(teamId: SlackWorkspace): Promise<string | null> {
      const key = teamId === ORIGINAL_WORKSPACE ? originalTeamId : teamId;
      if (key === null) return null;

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
    },

    async record(install: SlackInstallRecord): Promise<string> {
      return deps.installLock(`slack-install:${install.teamId}`, async () => {
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
        return ref.path;
      });
    },

    async markRejected(teamId: string): Promise<void> {
      await deps.setState(teamId, "rejected");
      tokens.delete(teamId);
    },
  };
}
