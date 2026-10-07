import { err, ok, type Result } from "../../../result.js";
import type { RevokeError } from "../domain/errors.js";
import { errorMessage } from "../../shared/error-message.js";

export interface RevokeClient {
  revoke(input: {
    revocationEndpoint: string;
    clientId: string;
    refreshToken: string;
  }): Promise<Result<void, RevokeError>>;
}

const TIMEOUT_MS = 10_000;

export function createRevokeClient(): RevokeClient {
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
          signal: AbortSignal.timeout(TIMEOUT_MS),
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
