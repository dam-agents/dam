import { setTimeout as sleep } from "node:timers/promises";
import { err, ok, type Result } from "../../../result.js";
import type {
  CompatService,
  ConfigService,
  MalformedConfigError,
  MissingConfigError,
  ProbeError,
} from "../../cli/index.js";
import type {
  AuthConfigProbeError,
  DeviceFlowError,
} from "../domain/errors.js";
import { nextFlowStep, type DeviceFlowFailure } from "../domain/flow.js";
import type { HostAuth } from "../domain/host-auth.js";
import { matchSavedServer } from "../domain/saved-server.js";
import { normalizeServerUrl } from "../../shared/server-url.js";
import type { AuthStore, HostUrl } from "../infrastructure/auth-store.js";
import type { AuthEnvReader } from "../infrastructure/auth-env-reader.js";
import type { AuthConfigProbe } from "../infrastructure/auth-config-probe.js";
import type { BrowserOpener } from "../infrastructure/browser-opener.js";
import type { DeviceFlowClient } from "../infrastructure/device-flow-client.js";
import type { OidcDiscovery } from "../infrastructure/oidc-discovery.js";
import type { RevokeClient } from "../infrastructure/revoke-client.js";
import type { TokenEndpointClient } from "../infrastructure/token-endpoint-client.js";
import type { SavedTokenProvider } from "./token-provider.js";

export interface LoginOk {
  host: HostUrl;
  username: string;
  warnings: ReadonlyArray<string>;
  openedBrowser: boolean;
  verificationUri: string;
  userCode: string;
}

export interface LoginInput {
  host: HostUrl;
  openBrowser: boolean;
  force: boolean;
  isTty: boolean;
  persistServer?: HostUrl;
  onPromptUser?: (info: {
    userCode: string;
    verificationUri: string;
    openedBrowser: boolean;
  }) => void;
}

export interface LogoutOk {
  host: HostUrl;
  revoked: boolean;
  alreadyLoggedOut: boolean;
  revokeWarning?: string;
}

export type SessionState = "valid" | "expired" | "unchecked" | "env";

export interface StatusEntry {
  host: HostUrl;
  issuer: string;
  username: string;
  source: "env" | "file";
  isActive: boolean;
  expiresAt?: Date;
  session: SessionState;
  uncheckedReason?: string;
}

export interface StatusReport {
  activeHost?: HostUrl;
  entries: ReadonlyArray<StatusEntry>;
  activeHostValid: boolean;
  uncheckedReason?: string;
}

export type LoginError =
  | { kind: "below-floor"; localCli: string; serverMinClient: string }
  | { kind: "preflight"; reason: PreflightReason; detail: string }
  | { kind: "aborted" }
  | { kind: "requires-force" }
  | { kind: "auth-store"; detail: string }
  | { kind: "device-flow"; reason: DeviceFlowFailure; detail?: string }
  | { kind: "transport"; detail: string };

export type PreflightReason =
  | "compat"
  | "server-unreachable"
  | "missing-cli-client-id"
  | "missing-device-endpoint"
  | "discovery-failed";

export type LogoutError = { kind: "auth-store"; detail: string };

export type StatusError = { kind: "auth-store"; detail: string };

export interface SwitchOk {
  host: HostUrl;
  session: SessionState;
  uncheckedReason?: string;
  warnings: ReadonlyArray<string>;
}

export type SwitchError =
  | { kind: "auth-store"; detail: string }
  | { kind: "config"; detail: string }
  | { kind: "unknown-server"; input: string; saved: ReadonlyArray<HostUrl> }
  | {
      kind: "ambiguous-server";
      input: string;
      candidates: ReadonlyArray<HostUrl>;
    };

export interface AuthService {
  login(input: LoginInput): Promise<Result<LoginOk, LoginError>>;
  logout(host: HostUrl): Promise<Result<LogoutOk, LogoutError>>;
  status(): Promise<Result<StatusReport, StatusError>>;
  switchTo(server: string): Promise<Result<SwitchOk, SwitchError>>;
}

export interface AuthServiceDeps {
  compatService: CompatService;
  configService: ConfigService;
  authConfigProbe: AuthConfigProbe;
  oidcDiscovery: OidcDiscovery;
  deviceFlowClient: DeviceFlowClient;
  tokenEndpointClient: TokenEndpointClient;
  revokeClient: RevokeClient;
  browserOpener: BrowserOpener;
  authStore: AuthStore;
  authEnvReader: AuthEnvReader;
  savedTokenProvider: SavedTokenProvider;
  now?: () => Date;
  sleepMs?: (ms: number) => Promise<void>;
}

const ENV_USERNAME_PLACEHOLDER = "(env)";
const ENV_ISSUER_PLACEHOLDER = "(unknown — token supplied via DAM_TOKEN)";

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = Buffer.from(parts[1] ?? "", "base64url").toString("utf-8");
    const parsed = JSON.parse(payload);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringField(
  payload: Record<string, unknown> | null,
  key: string,
): string | undefined {
  const v = payload?.[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

type SavedSession =
  | { kind: "valid" }
  | { kind: "expired" }
  | { kind: "unchecked"; reason: string };

function describeAuthConfigError(e: AuthConfigProbeError): {
  reason: PreflightReason;
  detail: string;
} {
  switch (e.code) {
    case "missing-cli-client-id":
      return { reason: "missing-cli-client-id", detail: e.message };
    case "network":
    case "non-ok-status":
      return { reason: "server-unreachable", detail: e.message };
    case "malformed-response":
      return { reason: "discovery-failed", detail: e.message };
  }
}

function describeCompatError(
  e: MissingConfigError | MalformedConfigError | ProbeError,
): { reason: PreflightReason; detail: string } {
  if (e.kind === "probe-error") {
    return { reason: "server-unreachable", detail: e.message };
  }
  if (e.kind === "missing-config") {
    return {
      reason: "compat",
      detail: `no server configured for key '${e.key}'`,
    };
  }
  return { reason: "compat", detail: e.reason };
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const now = deps.now ?? (() => new Date());
  const sleepMs = deps.sleepMs ?? ((ms) => sleep(ms));

  const checkSavedSession = async (host: HostUrl): Promise<SavedSession> => {
    const token = await deps.savedTokenProvider.getSavedAccessToken(host, {
      keepExpired: true,
    });
    if (token.ok) return { kind: "valid" };
    switch (token.error.kind) {
      case "not-logged-in":
      case "session-expired":
        return { kind: "expired" };
      case "refresh-failed":
      case "refresh-transient":
      case "auth-store-read":
      case "auth-store-write":
      case "malformed-auth-store":
        return { kind: "unchecked", reason: token.error.reason };
    }
  };

  return {
    async login(input) {
      input = {
        ...input,
        host: normalizeServerUrl(input.host),
        persistServer:
          input.persistServer === undefined
            ? undefined
            : normalizeServerUrl(input.persistServer),
      };
      const cfg = await deps.authConfigProbe.probe(input.host);
      if (!cfg.ok) {
        return err({
          kind: "preflight",
          ...describeAuthConfigError(cfg.error),
        });
      }
      const warnings: string[] = [];
      const movedTo =
        cfg.value.movedTo === undefined
          ? undefined
          : normalizeServerUrl(cfg.value.movedTo);
      if (movedTo !== undefined) {
        warnings.push(
          `${input.host} redirects to ${movedTo}; logged in there and saved it as the server`,
        );
        input = { ...input, host: movedTo, persistServer: movedTo };
      }

      const existing = await deps.authStore.read();
      if (!existing.ok) {
        return err({ kind: "auth-store", detail: existing.error.reason });
      }
      if (
        existing.value.has(input.host) &&
        !input.force &&
        (await checkSavedSession(input.host)).kind === "valid"
      ) {
        if (!input.isTty) return err({ kind: "requires-force" });
        return err({ kind: "aborted" });
      }

      const compat = await deps.compatService.check({
        flag: { server: input.host },
      });
      if (!compat.ok) {
        return err({ kind: "preflight", ...describeCompatError(compat.error) });
      }
      switch (compat.value.kind) {
        case "below-floor":
          return err({
            kind: "below-floor",
            localCli: compat.value.localCli,
            serverMinClient: compat.value.serverMinClient,
          });
        case "behind-current":
          warnings.push(
            `CLI ${compat.value.localCli} is behind the server's recommended CLI ${compat.value.serverRecommendedClient}`,
          );
          break;
        case "ok":
          break;
      }

      const oidc = await deps.oidcDiscovery.discover(cfg.value.issuer);
      if (!oidc.ok) {
        return err({
          kind: "preflight",
          reason:
            oidc.error.code === "missing-device-endpoint"
              ? "missing-device-endpoint"
              : "discovery-failed",
          detail: oidc.error.message,
        });
      }

      const auth = await deps.deviceFlowClient.authorize({
        deviceAuthorizationEndpoint: oidc.value.deviceAuthorizationEndpoint,
        clientId: cfg.value.cliClientId,
      });
      if (!auth.ok) {
        return err({
          kind: "transport",
          detail: describeDeviceFlowError(auth.error),
        });
      }

      const verificationUri =
        auth.value.verificationUriComplete ?? auth.value.verificationUri;
      let openedBrowser = false;
      if (input.openBrowser) {
        const opened = await deps.browserOpener.open(verificationUri);
        openedBrowser = opened.ok;
      }
      input.onPromptUser?.({
        userCode: auth.value.userCode,
        verificationUri,
        openedBrowser,
      });

      const startedAt = now();
      let intervalSeconds = auth.value.interval;
      while (true) {
        await sleepMs(intervalSeconds * 1000);
        const tokenResult = await deps.tokenEndpointClient.exchangeDeviceCode({
          tokenEndpoint: oidc.value.tokenEndpoint,
          clientId: cfg.value.cliClientId,
          deviceCode: auth.value.deviceCode,
        });
        if (!tokenResult.ok) {
          return err({ kind: "transport", detail: tokenResult.error.reason });
        }
        const step = nextFlowStep({
          response: tokenResult.value,
          currentIntervalSeconds: intervalSeconds,
          startedAt,
          now: now(),
          expiresInSeconds: auth.value.expiresIn,
        });
        if (step.action === "poll-again") {
          intervalSeconds = step.intervalSeconds;
          continue;
        }
        if (step.action === "fail") {
          return err({
            kind: "device-flow",
            reason: step.reason,
            detail: step.message,
          });
        }
        const tokens = step.tokens;
        const payload = decodeJwtPayload(tokens.accessToken);
        const rawUsername = stringField(payload, "preferred_username");
        const rawSub = stringField(payload, "sub");
        const username = rawUsername ?? "(unknown)";
        const sub = rawSub ?? "";
        if (rawUsername === undefined) {
          warnings.push(
            "access token has no preferred_username claim; status will show '(unknown)'",
          );
        }
        if (rawSub === undefined) {
          warnings.push(
            "access token has no sub claim; identity is not pinned to a stable user id",
          );
        }
        const hostAuth: HostAuth = {
          issuer: cfg.value.issuer,
          username,
          sub,
          cliClientId: cfg.value.cliClientId,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: new Date(now().getTime() + tokens.expiresIn * 1000),
        };
        const written = await deps.authStore.write(input.host, hostAuth);
        if (!written.ok) {
          return err({ kind: "auth-store", detail: written.error.reason });
        }
        if (input.persistServer !== undefined) {
          const cfgWrite = await deps.configService.set(
            "server",
            input.persistServer,
          );
          if (!cfgWrite.ok && cfgWrite.error.kind === "file-write") {
            warnings.push(
              `failed to update config.toml: ${cfgWrite.error.reason}`,
            );
          }
          const resolved = await deps.configService.getResolved({});
          if (resolved.ok && resolved.value.server !== input.persistServer) {
            warnings.push(
              `the active server is still ${resolved.value.server}; update DAM_SERVER to ${input.persistServer}`,
            );
          }
        }
        return ok({
          host: input.host,
          username,
          warnings,
          openedBrowser,
          verificationUri,
          userCode: auth.value.userCode,
        });
      }
    },

    async logout(rawHost) {
      const host = normalizeServerUrl(rawHost);
      const stored = await deps.authStore.read();
      if (!stored.ok) {
        return err({ kind: "auth-store", detail: stored.error.reason });
      }
      const entry = stored.value.get(host);
      if (!entry) {
        return ok({ host, revoked: false, alreadyLoggedOut: true });
      }

      let revoked = false;
      let revokeWarning: string | undefined;
      const oidc = await deps.oidcDiscovery.discover(entry.issuer);
      if (oidc.ok) {
        const revoke = await deps.revokeClient.revoke({
          revocationEndpoint: oidc.value.revocationEndpoint,
          clientId: entry.cliClientId,
          refreshToken: entry.refreshToken,
        });
        if (revoke.ok) {
          revoked = true;
        } else {
          revokeWarning = `token revocation failed (logout still cleared local creds): ${revoke.error.reason}`;
        }
      } else {
        revokeWarning = `cannot resolve revocation endpoint: ${oidc.error.message}`;
      }

      const removed = await deps.authStore.remove(host);
      if (!removed.ok) {
        return err({ kind: "auth-store", detail: removed.error.reason });
      }
      return ok({ host, revoked, alreadyLoggedOut: false, revokeWarning });
    },

    async status() {
      const stored = await deps.authStore.read();
      if (!stored.ok) {
        return err({ kind: "auth-store", detail: stored.error.reason });
      }
      const cfg = await deps.configService.getResolved({});
      const activeHost = cfg.ok ? cfg.value.server : undefined;
      const envToken = deps.authEnvReader.damToken();

      const sessions = new Map<HostUrl, SavedSession>();
      for (const host of stored.value.keys()) {
        if (host === activeHost && envToken !== undefined) continue;
        sessions.set(host, await checkSavedSession(host));
      }
      const refreshed = await deps.authStore.read();
      const current = refreshed.ok ? refreshed.value : stored.value;

      const entries: StatusEntry[] = [];
      for (const [host, saved] of stored.value) {
        const entry = current.get(host) ?? saved;
        const isActive = host === activeHost;
        const session = sessions.get(host);
        if (session === undefined) {
          entries.push({
            host,
            issuer: ENV_ISSUER_PLACEHOLDER,
            username: ENV_USERNAME_PLACEHOLDER,
            source: "env",
            isActive,
            session: "env",
          });
          continue;
        }
        entries.push({
          host,
          issuer: entry.issuer,
          username: entry.username,
          source: "file",
          isActive,
          expiresAt: entry.expiresAt,
          session: session.kind,
          uncheckedReason:
            session.kind === "unchecked" ? session.reason : undefined,
        });
      }

      if (
        envToken !== undefined &&
        activeHost !== undefined &&
        !entries.some((e) => e.host === activeHost)
      ) {
        entries.push({
          host: activeHost,
          issuer: ENV_ISSUER_PLACEHOLDER,
          username: ENV_USERNAME_PLACEHOLDER,
          source: "env",
          isActive: true,
          session: "env",
        });
      }

      const activeEntry = entries.find((e) => e.isActive);
      return ok({
        activeHost,
        entries,
        activeHostValid:
          activeEntry?.session === "env" || activeEntry?.session === "valid",
        uncheckedReason: activeEntry?.uncheckedReason,
      });
    },

    async switchTo(server) {
      const stored = await deps.authStore.read();
      if (!stored.ok) {
        return err({ kind: "auth-store", detail: stored.error.reason });
      }
      const saved = [...stored.value.keys()];
      const match = matchSavedServer(server, saved);
      if (match.kind === "unknown") {
        return err({ kind: "unknown-server", input: server, saved });
      }
      if (match.kind === "ambiguous") {
        return err({
          kind: "ambiguous-server",
          input: server,
          candidates: match.candidates,
        });
      }
      const host = match.host;

      const written = await deps.configService.set("server", host);
      if (!written.ok) {
        return err({ kind: "config", detail: written.error.reason });
      }

      const warnings: string[] = [];
      const resolved = await deps.configService.getResolved({});
      if (resolved.ok && resolved.value.server !== host) {
        warnings.push(
          `the active server is still ${resolved.value.server}; update DAM_SERVER to ${host}`,
        );
      }
      if (deps.authEnvReader.damToken() !== undefined) {
        warnings.push(
          "DAM_TOKEN is set; commands use it instead of the saved sign-in until you unset it",
        );
        return ok({ host, session: "env", warnings });
      }

      const session = await checkSavedSession(host);
      return ok({
        host,
        session: session.kind,
        uncheckedReason:
          session.kind === "unchecked" ? session.reason : undefined,
        warnings,
      });
    },
  };
}

function describeDeviceFlowError(e: DeviceFlowError): string {
  switch (e.code) {
    case "network":
      return `device authorization request failed: ${e.message}`;
    case "non-ok-status":
      return `device authorization endpoint returned ${e.message}`;
    case "malformed-response":
      return `device authorization endpoint returned unexpected response: ${e.message}`;
  }
}
