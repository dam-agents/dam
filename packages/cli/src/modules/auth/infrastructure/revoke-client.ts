import { err, ok, type Result } from "../../../result.js";
import type { RevokeError } from "../domain/errors.js";

export interface RevokeClient {
  revoke(input: {
    revocationEndpoint: string;
    clientId: string;
    refreshToken: string;
  }): Promise<Result<void, RevokeError>>;
}

export interface HttpRevokeClientOpts {
  timeoutMs?: number;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createRevokeClient(
  opts: HttpRevokeClientOpts = {},
): RevokeClient {
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return {
    async revoke({ revocationEndpoint, clientId, refreshToken }) {
      const body = new URLSearchParams({
        token: refreshToken,
        token_type_hint: "refresh_token",
        client_id: clientId,
      });

      let res: Response;
      try {
        res = await fetch(revocationEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        return err({ kind: "revoke-failed", reason: errorMessage(e) });
      }

      if (!res.ok) {
        return err({
          kind: "revoke-failed",
          reason: `${res.status} ${res.statusText || "(no status text)"}`,
        });
      }
      return ok(undefined);
    },
  };
}
