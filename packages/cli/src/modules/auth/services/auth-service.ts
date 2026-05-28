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
  AuthStoreReadError,
  AuthStoreWriteError,
  BrowserOpenError,
  DeviceFlowError,
  MalformedAuthStoreError,
  OidcDiscoveryError,
  RevokeError,
} from "../domain/errors.js";
import { nextFlowStep, type DeviceFlowFailure } from "../domain/flow.js";
import type { HostAuth } from "../domain/host-auth.js";
import type { AuthStore, HostUrl } from "../infrastructure/auth-store.js";
import type { AuthEnvReader } from "../infrastructure/auth-env-reader.js";
import type { AuthConfigProbe } from "../infrastructure/auth-config-probe.js";
import type { BrowserOpener } from "../infrastructure/browser-opener.js";
import type { DeviceFlowClient } from "../infrastructure/device-flow-client.js";
import type { OidcDiscovery } from "../infrastructure/oidc-discovery.js";
import type { RevokeClient } from "../infrastructure/revoke-client.js";
import type { TokenEndpointClient } from "../infrastructure/token-endpoint-client.js";

export interface LoginOk {
  host: HostUrl;
  username: string;
  /** Non-fatal warnings to surface to stderr — compat verdict
   *  `behind-current`, config-persist failures, missing identity claims.
   *  Empty on the clean happy path. */
  warnings: ReadonlyArray<string>;
  /** True when the browser was opened on the user's behalf. */
  openedBrowser: boolean;
  /** The Keycloak device-flow `verification_uri_complete` — surfaced so
   *  the command layer can print it for `--no-browser` or when the
   *  browser opener failed. */
  verificationUri: string;
  userCode: string;
}

export interface LoginInput {
  host: HostUrl;
  openBrowser: boolean;
  force: boolean;
  /** True when stdin is a TTY — controls the re-login confirm prompt.
   *  The command layer owns the actual prompt I/O; the service only
   *  decides whether `--force` is required. */
  isTty: boolean;
  /** When supplied, after a successful login the service persists this
   *  as the new active server in `config.toml`. */
  persistServer?: HostUrl;
  /** Side-channel for the command layer to print the user-code line
   *  before polling begins. */
  onPromptUser?: (info: {
    userCode: string;
    verificationUri: string;
    openedBrowser: boolean;
  }) => void;
}

export interface LogoutOk {
  host: HostUrl;
  /** True when revocation succeeded; false when the local clear ran
   *  but revocation was best-effort. */
  revoked: boolean;
  /** True when there was no entry to remove. */
  alreadyLoggedOut: boolean;
  /** When `revoked` is false but the host was present, this captures
   *  why revocation failed. The command layer turns it into a stderr
   *  warning; logout still exits 0. */
  revokeWarning?: string;
}

export interface StatusEntry {
  host: HostUrl;
  issuer: string;
  username: string;
  source: "env" | "file";
  isActive: boolean;
  /** Only present for `source === "file"` — env-supplied tokens are
   *  opaque to the CLI. */
  expiresAt?: Date;
}

export interface StatusReport {
  activeHost?: HostUrl;
  entries: ReadonlyArray<StatusEntry>;
  /** True when the Active Host has a valid (non-expired) credential. */
  activeHostValid: boolean;
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

export interface AuthService {
  login(input: LoginInput): Promise<Result<LoginOk, LoginError>>;
  logout(host: HostUrl): Promise<Result<LogoutOk, LogoutError>>;
  status(): Promise<Result<StatusReport, StatusError>>;
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
  /** Defaults to wall clock; tests override. */
  now?: () => Date;
  /** Sleep between polling iterations; tests override to avoid wall-time
   *  waits. Receives the next interval in **milliseconds**. */
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

function describeOidcError(e: OidcDiscoveryError): {
  reason: PreflightReason;
  detail: string;
} {
  if (e.code === "missing-device-endpoint") {
    return { reason: "missing-device-endpoint", detail: e.message };
  }
  return { reason: "discovery-failed", detail: e.message };
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

  async function readAuthStore(): Promise<
    Result<
      ReadonlyMap<HostUrl, HostAuth>,
      AuthStoreReadError | MalformedAuthStoreError
    >
  > {
    return deps.authStore.read();
  }

  return {
    async login(input) {
      // Re-login guard (step 0).
      const existing = await readAuthStore();
      if (!existing.ok) {
        return err({ kind: "auth-store", detail: existing.error.reason });
      }
      if (existing.value.has(input.host) && !input.force) {
        if (!input.isTty) return err({ kind: "requires-force" });
        return err({ kind: "aborted" }); // command layer handles the TTY prompt.
      }

      // 1. CompatService pre-flight.
      const compat = await deps.compatService.check({
        flag: { server: input.host },
      });
      if (!compat.ok) {
        const desc = describeCompatError(compat.error);
        return err({
          kind: "preflight",
          reason: desc.reason,
          detail: desc.detail,
        });
      }
      const warnings: string[] = [];
      switch (compat.value.kind) {
        case "below-floor":
          return err({
            kind: "below-floor",
            localCli: compat.value.localCli,
            serverMinClient: compat.value.serverMinClient,
          });
        case "behind-current":
          warnings.push(
            `CLI ${compat.value.localCli} is behind server ${compat.value.serverVersion}`,
          );
          break;
        case "ok":
          break;
      }

      // 2. /api/auth/config.
      const cfg = await deps.authConfigProbe.probe(input.host);
      if (!cfg.ok) {
        const desc = describeAuthConfigError(cfg.error);
        return err({
          kind: "preflight",
          reason: desc.reason,
          detail: desc.detail,
        });
      }

      // 3. OIDC discovery.
      const oidc = await deps.oidcDiscovery.discover(cfg.value.issuer);
      if (!oidc.ok) {
        const desc = describeOidcError(oidc.error);
        return err({
          kind: "preflight",
          reason: desc.reason,
          detail: desc.detail,
        });
      }

      // 4. Device authorization request.
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

      // 5. Prompt the user. The command layer is responsible for the
      //    actual stdout — we just hand it the info and a flag indicating
      //    whether we managed to open the browser.
      let openedBrowser = false;
      if (input.openBrowser) {
        const opened = await deps.browserOpener.open(
          auth.value.verificationUriComplete ?? auth.value.verificationUri,
        );
        openedBrowser = opened.ok;
      }
      input.onPromptUser?.({
        userCode: auth.value.userCode,
        verificationUri:
          auth.value.verificationUriComplete ?? auth.value.verificationUri,
        openedBrowser,
      });

      // 6. Polling loop.
      const startedAt = now();
      let intervalSeconds = auth.value.interval;
      // Spin until we either succeed, fail, or the state machine sends us
      // back with `expired-token` via the pre-check.
      // Outer loop calls sleep(interval) before each token-endpoint hit.
      // The first iteration sleeps `interval` per RFC 8628 §3.4.
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
        // 7. Success.
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
            // Non-fatal: the login worked. Surface as a separate warning.
            warnings.push(
              `failed to update config.toml: ${cfgWrite.error.reason}`,
            );
          }
        }
        return ok({
          host: input.host,
          username,
          warnings,
          openedBrowser,
          verificationUri:
            auth.value.verificationUriComplete ?? auth.value.verificationUri,
          userCode: auth.value.userCode,
        });
      }
    },

    async logout(host) {
      const stored = await deps.authStore.read();
      if (!stored.ok) {
        return err({ kind: "auth-store", detail: stored.error.reason });
      }
      const entry = stored.value.get(host);
      if (!entry) {
        return ok({ host, revoked: false, alreadyLoggedOut: true });
      }

      // Best-effort revocation. Uses the cliClientId persisted at login,
      // so an operator rotating `keycloak.cliClientId` between login and
      // logout doesn't silently produce wrong-client revocations.
      // Discovery still needs to succeed to find the revocation endpoint;
      // if it fails we clear locally and surface the warning.
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
          revokeWarning = describeRevokeError(revoke.error);
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

      const entries: StatusEntry[] = [];
      for (const [host, entry] of stored.value) {
        const isActive = host === activeHost;
        const shadowed = isActive && envToken !== undefined;
        // When DAM_TOKEN shadows the active host, the env bearer is what
        // every command will actually use — the file-backed username,
        // issuer, and expiry belong to a credential that won't be sent.
        // Surface the env shape instead so the report can't mislead the
        // user about whose identity is in effect (review §2).
        entries.push({
          host,
          issuer: shadowed ? ENV_ISSUER_PLACEHOLDER : entry.issuer,
          username: shadowed ? ENV_USERNAME_PLACEHOLDER : entry.username,
          source: shadowed ? "env" : "file",
          isActive,
          expiresAt: shadowed ? undefined : entry.expiresAt,
        });
      }

      // If an env-supplied token shadows the active host but there's no
      // file entry for that host, surface a synthetic entry so users
      // know which host the env value applies to.
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
        });
      }

      const activeEntry = entries.find((e) => e.isActive);
      const activeHostValid =
        activeEntry !== undefined &&
        (activeEntry.source === "env" ||
          (activeEntry.expiresAt !== undefined &&
            activeEntry.expiresAt.getTime() > now().getTime()));

      return ok({ activeHost, entries, activeHostValid });
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

function describeRevokeError(e: RevokeError): string {
  return `token revocation failed (logout still cleared local creds): ${e.reason}`;
}

// Re-exports so tests don't need to deep-import auth-store types when
// they only ever touch the service surface.
export type AuthServiceWriteError =
  | AuthStoreReadError
  | AuthStoreWriteError
  | MalformedAuthStoreError
  | BrowserOpenError;
