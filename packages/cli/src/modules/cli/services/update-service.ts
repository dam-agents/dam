import { err, ok, type Result } from "../../../result.js";
import { compareVersions } from "../domain/compat.js";
import type { ProbeError } from "../domain/errors.js";
import type {
  InstallError,
  NpmInstaller,
} from "../infrastructure/npm-installer.js";
import type { NpmLatestProbe } from "../infrastructure/npm-latest-probe.js";

export type UpdateResult =
  | { kind: "current"; version: string }
  | { kind: "updated"; from: string; to: string };

export type UpdateError =
  { kind: "latest-unavailable"; cause: ProbeError } | InstallError;

export interface UpdateService {
  update(): Promise<Result<UpdateResult, UpdateError>>;
}

export function createUpdateService(deps: {
  latest: NpmLatestProbe;
  installer: NpmInstaller;
  localCliVersion: string;
}): UpdateService {
  return {
    async update() {
      const latest = await deps.latest.latest();
      if (!latest.ok) {
        return err({ kind: "latest-unavailable", cause: latest.error });
      }
      if (compareVersions(deps.localCliVersion, latest.value) >= 0) {
        return ok({ kind: "current", version: deps.localCliVersion });
      }
      const installed = await deps.installer.install(latest.value);
      if (!installed.ok) return installed;
      return ok({
        kind: "updated",
        from: deps.localCliVersion,
        to: latest.value,
      });
    },
  };
}
