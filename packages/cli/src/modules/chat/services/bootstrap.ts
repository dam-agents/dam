import { err, ok, type Result } from "../../../result.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { TokenProvider } from "../../auth/index.js";
import {
  createAgentResolver,
  type AgentService,
  type ResolveError,
} from "../../agent/index.js";

export type BootstrapError =
  | ResolveError
  | { kind: "no-server" }
  | { kind: "malformed-config"; reason: string }
  | { kind: "below-floor"; localCli: string; serverMinClient: string };

export interface BootstrapContext {
  host: string;
  token: string;
  agentId: string;
}

export interface BootstrapDeps {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  createAgentService: (host: string) => AgentService;
}

export function createBootstrap(deps: BootstrapDeps) {
  return async function bootstrap(
    agentRef: string,
    serverFlag?: string,
  ): Promise<Result<BootstrapContext, BootstrapError>> {
    const flag = serverFlag ? { server: serverFlag } : undefined;
    const config = await deps.configService.getResolved({ flag });
    if (!config.ok) {
      return config.error.kind === "malformed-config"
        ? err({
            kind: "malformed-config" as const,
            reason: config.error.reason,
          })
        : err({ kind: "no-server" as const });
    }
    const host = config.value.server;

    const compat = await deps.compatService.check({ flag });
    if (!compat.ok)
      return err({
        kind: "transport" as const,
        reason:
          compat.error.kind === "probe-error"
            ? compat.error.message
            : compat.error.kind,
      });
    if (compat.value.kind === "below-floor") {
      return err({
        kind: "below-floor" as const,
        localCli: compat.value.localCli,
        serverMinClient: compat.value.serverMinClient,
      });
    }

    const resolved = await createAgentResolver({
      agentService: deps.createAgentService(host),
    }).resolve(agentRef);
    if (!resolved.ok) return resolved;

    const tok = await deps.tokenProvider.getValidAccessToken(host);
    if (!tok.ok)
      return err({ kind: "auth-required" as const, reason: tok.error.kind });

    return ok({ host, token: tok.value, agentId: resolved.value.id });
  };
}
