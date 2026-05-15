import type { CompatVerdict } from "../domain/compat.js";
import { verdictFor } from "../domain/compat.js";
import type { Config } from "../domain/config.js";
import type {
  MalformedConfigError,
  MissingConfigError,
  ProbeError,
} from "../domain/errors.js";
import { ok, type Result } from "../../../result.js";
import type { VersionProbe } from "../infrastructure/version-probe.js";
import type { ConfigService } from "./config-service.js";

export interface CompatService {
  check(opts: {
    flag?: Partial<Config>;
  }): Promise<
    Result<CompatVerdict, MissingConfigError | MalformedConfigError | ProbeError>
  >;
}

export interface CompatServiceDeps {
  config: ConfigService;
  probe: VersionProbe;
  localCliVersion: string;
}

export function createCompatService(deps: CompatServiceDeps): CompatService {
  return {
    async check({ flag }) {
      const config = await deps.config.getResolved({ flag });
      if (!config.ok) return config;

      const probed = await deps.probe.probe(config.value.server);
      if (!probed.ok) return probed;

      return ok(
        verdictFor({
          localCli: deps.localCliVersion,
          serverVersion: probed.value.serverVersion,
          serverMinClient: probed.value.minClientVersion,
        }),
      );
    },
  };
}
