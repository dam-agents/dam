import { z } from "zod";
import { err, ok, type Result } from "../../../result.js";
import type { OidcDiscoveryError } from "../domain/errors.js";
import { errorMessage } from "../../shared/error-message.js";

export interface OidcMetadata {
  deviceAuthorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
}

export interface OidcDiscovery {
  discover(issuer: string): Promise<Result<OidcMetadata, OidcDiscoveryError>>;
}

const TIMEOUT_MS = 5000;

const oidcDiscoverySchema = z.object({
  token_endpoint: z.string().min(1),
  revocation_endpoint: z.string().min(1),
  device_authorization_endpoint: z.string().min(1).optional(),
});

export function createOidcDiscovery(): OidcDiscovery {
  return {
    async discover(issuer) {
      const url = `${issuer.replace(/\/+$/, "")}/.well-known/openid-configuration`;

      let res: Response;
      try {
        res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch (e) {
        return err({
          kind: "oidc-discovery",
          code: "network",
          message: errorMessage(e),
        });
      }

      if (!res.ok) {
        return err({
          kind: "oidc-discovery",
          code: "non-ok-status",
          message: `${res.status} ${res.statusText || "(no status text)"}`,
        });
      }

      let body: unknown;
      try {
        body = await res.json();
      } catch (e) {
        return err({
          kind: "oidc-discovery",
          code: "malformed-response",
          message: `body is not JSON: ${errorMessage(e)}`,
        });
      }

      const parsed = oidcDiscoverySchema.safeParse(body);
      if (!parsed.success) {
        return err({
          kind: "oidc-discovery",
          code: "malformed-response",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
        });
      }

      if (parsed.data.device_authorization_endpoint === undefined) {
        return err({
          kind: "oidc-discovery",
          code: "missing-device-endpoint",
          message:
            "issuer discovery document does not advertise device_authorization_endpoint — the realm is not configured for the OAuth 2.0 Device Authorization Grant",
        });
      }

      return ok({
        deviceAuthorizationEndpoint: parsed.data.device_authorization_endpoint,
        tokenEndpoint: parsed.data.token_endpoint,
        revocationEndpoint: parsed.data.revocation_endpoint,
      });
    },
  };
}
