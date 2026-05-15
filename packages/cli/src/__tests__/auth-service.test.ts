import { describe, expect, it } from "vitest";
import { ok, err, type Result } from "../result.js";
import { createAuthService } from "../modules/auth/services/auth-service.js";
import type {
  AuthConfigProbe,
  AuthConfig,
} from "../modules/auth/infrastructure/auth-config-probe.js";
import type {
  OidcDiscovery,
  OidcMetadata,
} from "../modules/auth/infrastructure/oidc-discovery.js";
import type { DeviceFlowClient } from "../modules/auth/infrastructure/device-flow-client.js";
import type { TokenEndpointClient } from "../modules/auth/infrastructure/token-endpoint-client.js";
import type { RevokeClient } from "../modules/auth/infrastructure/revoke-client.js";
import type { BrowserOpener } from "../modules/auth/infrastructure/browser-opener.js";
import type {
  AuthStore,
  HostUrl,
} from "../modules/auth/infrastructure/auth-store.js";
import type { AuthEnvReader } from "../modules/auth/infrastructure/auth-env-reader.js";
import type {
  CompatService,
  ConfigService,
} from "../modules/cli/index.js";
import type {
  AuthConfigProbeError,
  OidcDiscoveryError,
} from "../modules/auth/domain/errors.js";

const HOST: HostUrl = "http://api-server.test:4444";

// --- Fakes -----------------------------------------------------------------

function emptyStore(): AuthStore {
  const state = new Map();
  return {
    async read() {
      return ok(state);
    },
    async write(host, value) {
      state.set(host, value);
      return ok(undefined);
    },
    async remove(host) {
      state.delete(host);
      return ok(undefined);
    },
  };
}

function envReader(): AuthEnvReader {
  return { damToken: () => undefined };
}

function unusedConfigService(): ConfigService {
  return {
    async getResolved() {
      return ok({ server: HOST });
    },
    async set() {
      return ok(undefined);
    },
  };
}

function compatVerdict(
  kind: "ok" | "behind-current" | "below-floor",
  serverMinClient = "0.0.0",
): CompatService {
  return {
    async check() {
      return ok({
        kind,
        localCli: "0.0.1",
        serverVersion: "1.0.0",
        serverMinClient,
      } as never);
    },
  };
}

function compatProbeError(): CompatService {
  return {
    async check() {
      return err({
        kind: "probe-error",
        code: "network",
        message: "ECONNREFUSED",
      });
    },
  };
}

function authConfigProbeOk(): AuthConfigProbe {
  return {
    async probe() {
      return ok<AuthConfig>({
        issuer: "http://idp/realms/platform",
        clientId: "platform-ui",
        cliClientId: "platform-cli",
      });
    },
  };
}

function authConfigProbeMissingCliId(): AuthConfigProbe {
  return {
    async probe(): Promise<Result<AuthConfig, AuthConfigProbeError>> {
      return err({
        kind: "auth-config-probe",
        code: "missing-cli-client-id",
        message: "server did not advertise cliClientId",
      });
    },
  };
}

function oidcOk(): OidcDiscovery {
  return {
    async discover() {
      return ok<OidcMetadata>({
        deviceAuthorizationEndpoint: "http://idp/device",
        tokenEndpoint: "http://idp/token",
        revocationEndpoint: "http://idp/revoke",
      });
    },
  };
}

function oidcMissingDeviceEndpoint(): OidcDiscovery {
  return {
    async discover(): Promise<Result<OidcMetadata, OidcDiscoveryError>> {
      return err({
        kind: "oidc-discovery",
        code: "missing-device-endpoint",
        message: "realm not configured for device grant",
      });
    },
  };
}

function deviceFlowUnused(): DeviceFlowClient {
  return {
    async authorize() {
      throw new Error("device flow should not be called in pre-flight failures");
    },
  };
}

function tokenClientUnused(): TokenEndpointClient {
  return {
    async exchangeDeviceCode() {
      throw new Error("token endpoint should not be called");
    },
    async refresh() {
      throw new Error("token endpoint should not be called");
    },
  };
}

function revokeUnused(): RevokeClient {
  return {
    async revoke() {
      throw new Error("revoke should not be called");
    },
  };
}

function browserUnused(): BrowserOpener {
  return {
    async open() {
      throw new Error("browser opener should not be called");
    },
  };
}

// --- Tests -----------------------------------------------------------------

describe("auth-service.login pre-flight (claim 9: distinct error kinds)", () => {
  it("server unreachable (probe error) → preflight/server-unreachable", async () => {
    const svc = createAuthService({
      compatService: compatProbeError(),
      configService: unusedConfigService(),
      authConfigProbe: authConfigProbeOk(),
      oidcDiscovery: oidcOk(),
      deviceFlowClient: deviceFlowUnused(),
      tokenEndpointClient: tokenClientUnused(),
      revokeClient: revokeUnused(),
      browserOpener: browserUnused(),
      authStore: emptyStore(),
      authEnvReader: envReader(),
    });

    const r = await svc.login({ host: HOST, openBrowser: false, force: false, isTty: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("preflight");
      if (r.error.kind === "preflight") {
        expect(r.error.reason).toBe("server-unreachable");
      }
    }
  });

  it("CLI below floor → below-floor error", async () => {
    const svc = createAuthService({
      compatService: compatVerdict("below-floor", "99.0.0"),
      configService: unusedConfigService(),
      authConfigProbe: authConfigProbeOk(),
      oidcDiscovery: oidcOk(),
      deviceFlowClient: deviceFlowUnused(),
      tokenEndpointClient: tokenClientUnused(),
      revokeClient: revokeUnused(),
      browserOpener: browserUnused(),
      authStore: emptyStore(),
      authEnvReader: envReader(),
    });

    const r = await svc.login({ host: HOST, openBrowser: false, force: false, isTty: false });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("below-floor");
      if (r.error.kind === "below-floor") {
        expect(r.error.serverMinClient).toBe("99.0.0");
      }
    }
  });

  it("server missing cliClientId → preflight/missing-cli-client-id (issue 1 not deployed)", async () => {
    const svc = createAuthService({
      compatService: compatVerdict("ok"),
      configService: unusedConfigService(),
      authConfigProbe: authConfigProbeMissingCliId(),
      oidcDiscovery: oidcOk(),
      deviceFlowClient: deviceFlowUnused(),
      tokenEndpointClient: tokenClientUnused(),
      revokeClient: revokeUnused(),
      browserOpener: browserUnused(),
      authStore: emptyStore(),
      authEnvReader: envReader(),
    });

    const r = await svc.login({ host: HOST, openBrowser: false, force: false, isTty: false });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "preflight") {
      expect(r.error.reason).toBe("missing-cli-client-id");
    } else {
      expect.fail(`expected preflight/missing-cli-client-id; got ${JSON.stringify(r)}`);
    }
  });

  it("discovery missing device_authorization_endpoint → preflight/missing-device-endpoint", async () => {
    const svc = createAuthService({
      compatService: compatVerdict("ok"),
      configService: unusedConfigService(),
      authConfigProbe: authConfigProbeOk(),
      oidcDiscovery: oidcMissingDeviceEndpoint(),
      deviceFlowClient: deviceFlowUnused(),
      tokenEndpointClient: tokenClientUnused(),
      revokeClient: revokeUnused(),
      browserOpener: browserUnused(),
      authStore: emptyStore(),
      authEnvReader: envReader(),
    });

    const r = await svc.login({ host: HOST, openBrowser: false, force: false, isTty: false });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.kind === "preflight") {
      expect(r.error.reason).toBe("missing-device-endpoint");
    } else {
      expect.fail(`expected preflight/missing-device-endpoint; got ${JSON.stringify(r)}`);
    }
  });

  it("re-login on existing entry without --force, non-TTY → requires-force", async () => {
    const store = emptyStore();
    await store.write(HOST, {
      issuer: "x",
      username: "u",
      sub: "s",
      cliClientId: "platform-cli",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: new Date("2099-01-01"),
    });
    const svc = createAuthService({
      compatService: compatVerdict("ok"),
      configService: unusedConfigService(),
      authConfigProbe: authConfigProbeOk(),
      oidcDiscovery: oidcOk(),
      deviceFlowClient: deviceFlowUnused(),
      tokenEndpointClient: tokenClientUnused(),
      revokeClient: revokeUnused(),
      browserOpener: browserUnused(),
      authStore: store,
      authEnvReader: envReader(),
    });

    const r = await svc.login({ host: HOST, openBrowser: false, force: false, isTty: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("requires-force");
  });
});

describe("auth-service.logout", () => {
  it("idempotent on unknown host (alreadyLoggedOut: true)", async () => {
    const svc = createAuthService({
      compatService: compatVerdict("ok"),
      configService: unusedConfigService(),
      authConfigProbe: authConfigProbeOk(),
      oidcDiscovery: oidcOk(),
      deviceFlowClient: deviceFlowUnused(),
      tokenEndpointClient: tokenClientUnused(),
      revokeClient: revokeUnused(),
      browserOpener: browserUnused(),
      authStore: emptyStore(),
      authEnvReader: envReader(),
    });

    const r = await svc.logout(HOST);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.alreadyLoggedOut).toBe(true);
      expect(r.value.revoked).toBe(false);
    }
  });

  it("revocation failure becomes a warning; local clear still succeeds", async () => {
    const store = emptyStore();
    await store.write(HOST, {
      issuer: "http://idp/realms/platform",
      username: "u",
      sub: "s",
      cliClientId: "platform-cli",
      accessToken: "a",
      refreshToken: "r",
      expiresAt: new Date("2099-01-01"),
    });
    const svc = createAuthService({
      compatService: compatVerdict("ok"),
      configService: unusedConfigService(),
      authConfigProbe: authConfigProbeOk(),
      oidcDiscovery: oidcOk(),
      deviceFlowClient: deviceFlowUnused(),
      tokenEndpointClient: tokenClientUnused(),
      revokeClient: {
        async revoke() {
          return err({ kind: "revoke-failed", reason: "idp down" });
        },
      },
      browserOpener: browserUnused(),
      authStore: store,
      authEnvReader: envReader(),
    });

    const r = await svc.logout(HOST);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.revoked).toBe(false);
      expect(r.value.revokeWarning).toContain("idp down");
      expect(r.value.alreadyLoggedOut).toBe(false);
    }
    const after = await store.read();
    if (after.ok) expect(after.value.has(HOST)).toBe(false);
  });
});

describe("auth-service.status", () => {
  it("DAM_TOKEN set + active host → synthesizes an env-sourced entry", async () => {
    const svc = createAuthService({
      compatService: compatVerdict("ok"),
      configService: unusedConfigService(),
      authConfigProbe: authConfigProbeOk(),
      oidcDiscovery: oidcOk(),
      deviceFlowClient: deviceFlowUnused(),
      tokenEndpointClient: tokenClientUnused(),
      revokeClient: revokeUnused(),
      browserOpener: browserUnused(),
      authStore: emptyStore(),
      authEnvReader: { damToken: () => "env-token-value" },
    });

    const r = await svc.status();
    expect(r.ok).toBe(true);
    if (r.ok) {
      const active = r.value.entries.find((e) => e.isActive);
      expect(active?.source).toBe("env");
      expect(r.value.activeHostValid).toBe(true); // env-sourced is considered valid.
    }
  });

  it("DAM_TOKEN shadows an existing file entry → hides file-backed metadata (review §2)", async () => {
    const store = emptyStore();
    await store.write(HOST, {
      issuer: "http://idp/realms/platform",
      username: "alice",
      sub: "alice-sub",
      cliClientId: "platform-cli",
      accessToken: "file-access",
      refreshToken: "file-refresh",
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    });
    const svc = createAuthService({
      compatService: compatVerdict("ok"),
      configService: unusedConfigService(),
      authConfigProbe: authConfigProbeOk(),
      oidcDiscovery: oidcOk(),
      deviceFlowClient: deviceFlowUnused(),
      tokenEndpointClient: tokenClientUnused(),
      revokeClient: revokeUnused(),
      browserOpener: browserUnused(),
      authStore: store,
      authEnvReader: { damToken: () => "env-token-value" },
    });

    const r = await svc.status();
    expect(r.ok).toBe(true);
    if (r.ok) {
      const active = r.value.entries.find((e) => e.isActive);
      expect(active?.source).toBe("env");
      // The env token will be sent on every command; the file-backed
      // username/issuer/expiry belong to a credential that won't be used,
      // so the report must not present them as the active identity.
      expect(active?.username).not.toBe("alice");
      expect(active?.issuer).not.toBe("http://idp/realms/platform");
      expect(active?.expiresAt).toBeUndefined();
    }
  });
});
