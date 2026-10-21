import { z } from "zod";
import { err, ok, type Result } from "../../../result.js";
import { isVersion } from "../domain/compat.js";
import type { ProbeError } from "../domain/errors.js";
import { errorMessage } from "../../shared/error-message.js";

export const CLI_PACKAGE = "@dam-agents/cli";
export const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org";

const distTagsSchema = z.object({ latest: z.string().refine(isVersion) });

export interface NpmLatestProbe {
  latest(): Promise<Result<string, ProbeError>>;
}

export interface HttpNpmLatestProbeOpts {
  registry: string;
  timeoutMs?: number;
}

export function createHttpNpmLatestProbe(
  opts: HttpNpmLatestProbeOpts,
): NpmLatestProbe {
  const timeoutMs = opts.timeoutMs ?? 3000;

  return {
    async latest() {
      const url = `${opts.registry.replace(/\/+$/, "")}/-/package/${encodeURIComponent(CLI_PACKAGE)}/dist-tags`;
      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        const isAbort =
          e instanceof Error &&
          (e.name === "AbortError" || e.name === "TimeoutError");
        return err({
          kind: "probe-error",
          code: isAbort ? "timeout" : "network",
          message: errorMessage(e),
        });
      }
      if (!res.ok) {
        return err({
          kind: "probe-error",
          code: "non-ok-status",
          message: `${res.status} ${res.statusText || "(no status text)"}`,
        });
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch (e) {
        return err({
          kind: "probe-error",
          code: "malformed-response",
          message: `body is not JSON: ${errorMessage(e)}`,
        });
      }
      const parsed = distTagsSchema.safeParse(body);
      if (!parsed.success) {
        return err({
          kind: "probe-error",
          code: "malformed-response",
          message: "dist-tags carry no latest",
        });
      }
      return ok(parsed.data.latest);
    },
  };
}
