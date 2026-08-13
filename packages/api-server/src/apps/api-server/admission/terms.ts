import { securityLog } from "../../../core/security-log.js";
import type { IsAcceptedPort } from "../../../modules/terms/index.js";
import type { WsAuthSite } from "./auth.js";

export type TermsDenialKind = "terms-stale";

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
