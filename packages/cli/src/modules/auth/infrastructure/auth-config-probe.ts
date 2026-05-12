import { z } from "zod";
import { err, ok, type Result } from "../../../result.js";
import type { AuthConfigProbeError } from "../domain/errors.js";

/**
 * The shape advertised by `GET <server>/api/auth/config`. The api-server
 * extension landed in issue 1 of #80; deployments that predate that issue
 * surface a 200 with `cliClientId` absent — handled as a distinct
 * `missing-cli-client-id` error rather than a generic malformed response.
 */
export interface AuthConfig {
  issuer: string;
  clientId: string;
  cliClientId: string;
}

export interface AuthConfigProbe {
  probe(serverUrl: string): Promise<Result<AuthConfig, AuthConfigProbeError>>;
}

export interface HttpAuthConfigProbeOpts {
  /** Per-call deadline. Default 5s — matches the version probe; long
   *  enough for a wakeful pod, short enough that login never feels hung. */
  timeoutMs?: number;
}

// Validates only the fields the CLI consumes. The platform may add more
// (idle-timeout hints, brand info, etc.); we ignore the rest.
const authConfigSchema = z.object({
  issuer: z.string().min(1),
  clientId: z.string().min(1),
  // `cliClientId` is allowed to be absent so we can distinguish "server
  // too old" from generic malformed-response. The validator below picks
  // it up explicitly.
  cliClientId: z.string().min(1).optional(),
});

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createAuthConfigProbe(
  opts: HttpAuthConfigProbeOpts = {},
): AuthConfigProbe {
  const timeoutMs = opts.timeoutMs ?? 5000;

  return {
    async probe(serverUrl) {
      const url = `${serverUrl.replace(/\/+$/, "")}/api/auth/config`;

      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        return err({
          kind: "auth-config-probe",
          code: "network",
          message: errorMessage(e),
        });
      }

      if (!res.ok) {
        return err({
          kind: "auth-config-probe",
          code: "non-ok-status",
          message: `${res.status} ${res.statusText || "(no status text)"}`,
        });
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (e) {
        return err({
          kind: "auth-config-probe",
          code: "malformed-response",
          message: `body is not JSON: ${errorMessage(e)}`,
        });
      }

      const parsed = authConfigSchema.safeParse(body);
      if (!parsed.success) {
        return err({
          kind: "auth-config-probe",
          code: "malformed-response",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
        });
      }

      if (parsed.data.cliClientId === undefined) {
        return err({
          kind: "auth-config-probe",
          code: "missing-cli-client-id",
          message:
            "server's /api/auth/config did not advertise cliClientId — the server is older than the CLI auth feature",
        });
      }

      return ok({
        issuer: parsed.data.issuer,
        clientId: parsed.data.clientId,
        cliClientId: parsed.data.cliClientId,
      });
    },
  };
}
