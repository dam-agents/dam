import { Command } from "commander";
import type { TokenProvider } from "../auth/index.js";
import type { CompatService, ConfigService } from "../cli/index.js";
import type { TemplateService } from "../template/index.js";
import { createTrpcClient, type TrpcClient } from "../shared/trpc/trpc-client.js";
import type { Result } from "../../result.js";
import { buildCreateCommand } from "./commands/create.js";
import { buildDeleteCommand } from "./commands/delete.js";
import { buildGetCommand } from "./commands/get.js";
import { buildListCommand } from "./commands/list.js";
import { buildRestartCommand } from "./commands/restart.js";
import {
  createInstanceService,
  type InstanceService,
} from "./services/instance-service.js";
import type { AuthRequiredError } from "./domain/errors.js";

/**
 * Composition options for the `instance` module.
 *
 * The `host` (Active Host URL) is **not** taken at module-compose time:
 * the program's `compose()` runs before commander parses flags, so the
 * `--server` override is only known once a command's action fires. The
 * module instead exposes a factory `createService(host)` that command
 * actions call after resolving the host via `configService.getResolved`
 * with the same precedence the auth verbs use (`--server` → env →
 * `config.toml`). `tokenProvider`, `configService`, `compatService` are
 * injected by the package-level compose and held by closure.
 */
export interface InstanceModuleOptions {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  /** Env var name for the server URL — surfaced in the
   *  `no server configured` hints in command actions. */
  serverEnvVar: string;
  /** Per-host factory for the template service. The `create` verb uses
   *  it to pre-validate `--template` before issuing `agents.create`. */
  templateService: (host: string) => TemplateService;
}

export interface InstanceModule {
  commands: ReadonlyArray<Command>;
  exports: {
    /** Build an `InstanceService` bound to the resolved Active Host.
     *  Exposed so future verbs (`dam shell`, #86) can reuse it without
     *  re-implementing the bearer-supplier wiring. */
    createService: (host: string) => InstanceService;
  };
}

export function composeInstanceModule(opts: InstanceModuleOptions): InstanceModule {
  // Single source of truth for the bearer-supplier closure. Both the
  // typed `InstanceService` and the raw trpc client used by the
  // orchestration verbs (`create`, Phase 4 `delete` / `restart`) reuse
  // it so retries and refreshes stay consistent.
  function getTokenFor(host: string): () => Promise<Result<string, AuthRequiredError>> {
    return async () => {
      const result = await opts.tokenProvider.getValidAccessToken(host);
      if (result.ok) return result;
      const classified = classifyTokenProviderError(result.error);
      if (classified.kind === "auth-required") {
        return { ok: false, error: classified };
      }
      throw new Error(classified.reason);
    };
  }

  const buildTrpc = (host: string): TrpcClient =>
    createTrpcClient({ host, getToken: getTokenFor(host) });

  const createService = (host: string): InstanceService =>
    createInstanceService({ trpc: buildTrpc(host) });

  // `dam instance` — parent group. Bare `dam instance` aliases to
  // `list` via commander's `isDefault: true` on the subcommand.
  const parent = new Command("instance").description(
    "Address Instances by name or ID",
  );
  parent.addCommand(
    buildListCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createInstanceService: createService,
      serverEnvVar: opts.serverEnvVar,
    }),
    { isDefault: true },
  );
  parent.addCommand(
    buildGetCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createInstanceService: createService,
      serverEnvVar: opts.serverEnvVar,
    }),
  );
  parent.addCommand(
    buildCreateCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createInstanceService: createService,
      createTemplateService: opts.templateService,
      createTrpcClient: buildTrpc,
      serverEnvVar: opts.serverEnvVar,
    }),
  );
  parent.addCommand(
    buildDeleteCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createInstanceService: createService,
      serverEnvVar: opts.serverEnvVar,
    }),
  );
  parent.addCommand(
    buildRestartCommand({
      compatService: opts.compatService,
      configService: opts.configService,
      createInstanceService: createService,
      serverEnvVar: opts.serverEnvVar,
    }),
  );

  return {
    commands: [parent],
    exports: { createService },
  };
}

interface ReasonBearing {
  reason?: string;
  host?: string;
  kind: string;
}

type ClassifiedError =
  | { kind: "auth-required"; reason: string }
  | { kind: "non-auth"; reason: string };

/** Classify a `TokenProviderError` into two buckets without importing the
 *  auth domain's discriminant.
 *
 *  Only `not-logged-in` and `session-expired` route to `auth-required` —
 *  those are the cases where `dam auth login` is the fix. Everything else
 *  (refresh failures, auth-store I/O errors, malformed auth store) is a
 *  non-auth condition that login can't repair; the service layer surfaces
 *  those as `transport` errors carrying the original reason. */
function classifyTokenProviderError(e: unknown): ClassifiedError {
  if (typeof e !== "object" || e === null) {
    return { kind: "non-auth", reason: "auth failure" };
  }
  const re = e as ReasonBearing;
  switch (re.kind) {
    case "not-logged-in":
      return { kind: "auth-required", reason: re.host ? `not logged in to ${re.host}` : "not logged in" };
    case "session-expired":
      return { kind: "auth-required", reason: re.host ? `session expired for ${re.host}` : "session expired" };
    default:
      return { kind: "non-auth", reason: re.reason ?? re.kind };
  }
}
