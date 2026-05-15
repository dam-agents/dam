import { Command } from "commander";
import type { CompatService, ConfigService } from "../cli/index.js";
import { buildLoginCommand } from "./commands/login.js";
import { buildLogoutCommand } from "./commands/logout.js";
import { buildStatusCommand } from "./commands/status.js";
import { createAuthConfigProbe } from "./infrastructure/auth-config-probe.js";
import {
  createProcessAuthEnvReader,
  type AuthEnvReader,
} from "./infrastructure/auth-env-reader.js";
import { defaultAuthPath } from "./infrastructure/auth-path.js";
import {
  createTomlAuthStore,
  type AuthStore,
} from "./infrastructure/auth-store.js";
import { createBrowserOpener } from "./infrastructure/browser-opener.js";
import { createDeviceFlowClient } from "./infrastructure/device-flow-client.js";
import { createOidcDiscovery } from "./infrastructure/oidc-discovery.js";
import { createRevokeClient } from "./infrastructure/revoke-client.js";
import { createTokenEndpointClient } from "./infrastructure/token-endpoint-client.js";
import {
  createAuthService,
  type AuthService,
} from "./services/auth-service.js";
import {
  createTokenProvider,
  type HostMetadataResolver,
  type TokenProvider,
} from "./services/token-provider.js";
import type { AuthConfig } from "./infrastructure/auth-config-probe.js";
import type { OidcMetadata } from "./infrastructure/oidc-discovery.js";
import { ok } from "../../result.js";

export interface AuthModuleOptions {
  authPath?: string;
  env?: NodeJS.ProcessEnv;
  /** Cross-module dependencies injected by the package-level compose. */
  compatService: CompatService;
  configService: ConfigService;
}

export interface AuthModule {
  commands: ReadonlyArray<Command>;
  exports: { tokenProvider: TokenProvider };
  internals: { authStore: AuthStore; authPath: string; authEnvReader: AuthEnvReader };
}

/**
 * Resolves the token endpoint for a host on demand. Used only by the
 * TokenProvider during refresh — the AuthService runs its own probe path
 * during login. Caches per CLI invocation; `cliClientId` is read from
 * the stored HostAuth, not re-probed here.
 */
function createTokenEndpointResolver(
  authConfigProbe: ReturnType<typeof createAuthConfigProbe>,
  oidcDiscovery: ReturnType<typeof createOidcDiscovery>,
): HostMetadataResolver {
  const cache = new Map<string, { tokenEndpoint: string }>();
  return {
    async resolve(host) {
      const cached = cache.get(host);
      if (cached) return ok(cached);
      const cfg = await authConfigProbe.probe(host);
      if (!cfg.ok) {
        return {
          ok: false,
          error: { kind: "refresh-failed", host, reason: cfg.error.message },
        };
      }
      const oidc = await oidcDiscovery.discover(cfg.value.issuer);
      if (!oidc.ok) {
        return {
          ok: false,
          error: { kind: "refresh-failed", host, reason: oidc.error.message },
        };
      }
      const value = { tokenEndpoint: oidc.value.tokenEndpoint };
      cache.set(host, value);
      return ok(value);
    },
  };
}

export function composeAuthModule(opts: AuthModuleOptions): AuthModule {
  const env = opts.env ?? process.env;
  const authPath = opts.authPath ?? defaultAuthPath(env);

  const authStore = createTomlAuthStore(authPath);
  const authEnvReader = createProcessAuthEnvReader(env);
  const authConfigProbe = createAuthConfigProbe();
  const oidcDiscovery = createOidcDiscovery();
  const deviceFlowClient = createDeviceFlowClient();
  const tokenEndpointClient = createTokenEndpointClient();
  const revokeClient = createRevokeClient();
  const browserOpener = createBrowserOpener();

  const hostMetadata = createTokenEndpointResolver(authConfigProbe, oidcDiscovery);

  const tokenProvider = createTokenProvider({
    authStore,
    authEnvReader,
    tokenEndpointClient,
    hostMetadata,
  });

  const authService: AuthService = createAuthService({
    compatService: opts.compatService,
    configService: opts.configService,
    authConfigProbe,
    oidcDiscovery,
    deviceFlowClient,
    tokenEndpointClient,
    revokeClient,
    browserOpener,
    authStore,
    authEnvReader,
  });

  const authParent = new Command("auth").description(
    "Authenticate against a Platform deployment (OAuth 2.0 Device Authorization Grant)",
  );
  authParent.addCommand(
    buildLoginCommand({
      authService,
      configService: opts.configService,
      authEnvReader,
    }),
  );
  authParent.addCommand(
    buildLogoutCommand({
      authService,
      configService: opts.configService,
    }),
  );
  authParent.addCommand(buildStatusCommand({ authService }));

  return {
    commands: [authParent],
    exports: { tokenProvider },
    internals: { authStore, authPath, authEnvReader },
  };
}

// Re-export so package-level compose can hand types to other consumers.
export type { AuthConfig, OidcMetadata };
