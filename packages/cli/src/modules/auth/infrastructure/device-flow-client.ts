import { z } from "zod";
import { err, ok, type Result } from "../../../result.js";
import type { DeviceFlowError } from "../domain/errors.js";

/** Scopes hardcoded per analysis §3.1. `offline_access` is required so
 *  the refresh token isn't bound to Keycloak's SSO Session Idle window. */
export const DEVICE_FLOW_SCOPE = "openid profile email offline_access";

export interface DeviceAuthorizationResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Present on real Keycloak; spec-optional (RFC 8628 §3.2). */
  verificationUriComplete?: string;
  /** Seconds. */
  expiresIn: number;
  /** Seconds. */
  interval: number;
}

export interface DeviceFlowClient {
  authorize(input: {
    deviceAuthorizationEndpoint: string;
    clientId: string;
    scope?: string;
  }): Promise<Result<DeviceAuthorizationResponse, DeviceFlowError>>;
}

export interface HttpDeviceFlowClientOpts {
  /** Per-call deadline. Default 10s — slightly longer than the discovery
   *  probes since the IdP often does a fresh code/grant write here. */
  timeoutMs?: number;
}

// `interval` is OPTIONAL in RFC 8628 §3.2 with a recommended default of 5
// seconds. Keycloak always emits it; defaulting here keeps non-Keycloak
// IdPs from tripping `malformed-response`.
const deviceAuthorizationSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1),
  verification_uri: z.string().min(1),
  verification_uri_complete: z.string().min(1).optional(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive().default(5),
});

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createDeviceFlowClient(
  opts: HttpDeviceFlowClientOpts = {},
): DeviceFlowClient {
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return {
    async authorize({ deviceAuthorizationEndpoint, clientId, scope }) {
      const body = new URLSearchParams({
        client_id: clientId,
        scope: scope ?? DEVICE_FLOW_SCOPE,
      });

      let res: Response;
      try {
        res = await fetch(deviceAuthorizationEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (e) {
        return err({
          kind: "device-flow",
          code: "network",
          message: errorMessage(e),
        });
      }

      if (!res.ok) {
        return err({
          kind: "device-flow",
          code: "non-ok-status",
          message: `${res.status} ${res.statusText || "(no status text)"}`,
        });
      }

      let raw: unknown;
      try {
        raw = await res.json();
      } catch (e) {
        return err({
          kind: "device-flow",
          code: "malformed-response",
          message: `body is not JSON: ${errorMessage(e)}`,
        });
      }

      const parsed = deviceAuthorizationSchema.safeParse(raw);
      if (!parsed.success) {
        return err({
          kind: "device-flow",
          code: "malformed-response",
          message: parsed.error.issues
            .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
            .join("; "),
        });
      }

      return ok({
        deviceCode: parsed.data.device_code,
        userCode: parsed.data.user_code,
        verificationUri: parsed.data.verification_uri,
        verificationUriComplete: parsed.data.verification_uri_complete,
        expiresIn: parsed.data.expires_in,
        interval: parsed.data.interval,
      });
    },
  };
}
