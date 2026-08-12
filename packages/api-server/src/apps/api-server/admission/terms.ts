import { securityLog } from "../../../core/security-log.js";
import type { IsAcceptedPort } from "../../../modules/terms/index.js";
import type { WsAuthSite } from "./auth.js";

/** The one denial kind this gate can produce — semantic only, encoded by
 *  each deliverer like the auth kinds (see AuthDenialKind in auth.ts). */
export type TermsDenialKind = "terms-stale";

/** WS flavor of the terms gate: surfaces that hold a socket instead of a
 *  request run this at admission time and deliver the denial through their
 *  own mapper. Returns null when accepted. The HTTP flavor lives in
 *  terms-middleware.ts. */
export async function checkWsTermsAccepted(
  isTermsAccepted: IsAcceptedPort,
  sub: string,
  site: WsAuthSite,
): Promise<TermsDenialKind | null> {
  if (await isTermsAccepted(sub)) return null;
  securityLog("warn", "ws.terms_block", {
    category: "authz",
    actor: sub,
    actorKind: "user",
    surface: "ws",
    ...(site.agentId !== undefined ? { agentId: site.agentId } : {}),
    decision: "deny",
    reason: "terms-not-accepted",
    sourceIp: site.sourceIp,
    detail: { relay: site.relay },
  });
  return "terms-stale";
}
