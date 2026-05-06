import { err, ok, type Result } from "../domain/result.js";
import type { ProbeError } from "../domain/errors.js";

export interface VersionInfo {
  serverVersion: string;
  minClientVersion: string;
}

export interface VersionProbe {
  probe(serverUrl: string): Promise<Result<VersionInfo, ProbeError>>;
}

export interface HttpVersionProbeOpts {
  /** Per-call deadline. Default 5s — long enough for a wakeful pod, short
   *  enough that `dam ping` never feels hung. */
  timeoutMs?: number;
}

export function createHttpVersionProbe(
  opts: HttpVersionProbeOpts = {},
): VersionProbe {
  const timeoutMs = opts.timeoutMs ?? 5000;

  return {
    async probe(serverUrl) {
      const url = `${serverUrl.replace(/\/+$/, "")}/api/version`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal });
      } catch (e) {
        const isAbort =
          e instanceof Error &&
          (e.name === "AbortError" || e.name === "TimeoutError");
        return err({
          kind: "probe-error",
          code: isAbort ? "timeout" : "network",
          message: errorMessage(e),
        });
      } finally {
        clearTimeout(timer);
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

      if (!isVersionInfo(body)) {
        return err({
          kind: "probe-error",
          code: "malformed-response",
          message: "response missing serverVersion or minClientVersion",
        });
      }

      return ok({
        serverVersion: body.serverVersion,
        minClientVersion: body.minClientVersion,
      });
    },
  };
}

function isVersionInfo(v: unknown): v is VersionInfo {
  return (
    typeof v === "object" &&
    v !== null &&
    "serverVersion" in v &&
    typeof (v as { serverVersion: unknown }).serverVersion === "string" &&
    "minClientVersion" in v &&
    typeof (v as { minClientVersion: unknown }).minClientVersion === "string"
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
