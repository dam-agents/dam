import {
  securityLog,
  type SecuritySurface,
} from "../../../core/security-log.js";

export function channelDeny(
  surface: Extract<SecuritySurface, "slack" | "telegram">,
  deny: {
    actor: string | null;
    agentId?: string | null;
    reason: string;
    detail: Record<string, unknown>;
  },
): void {
  securityLog("warn", "channel.authz_deny", {
    category: "channel",
    actor: deny.actor,
    actorKind: deny.actor ? "user" : "external",
    surface,
    ...(deny.agentId !== undefined ? { agentId: deny.agentId } : {}),
    decision: "deny",
    reason: deny.reason,
    detail: deny.detail,
  });
}
