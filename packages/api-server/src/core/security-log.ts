import { getLogger, type LogLevel } from "./logger.js";

export type SecurityCategory =
  | "authn"
  | "authz"
  | "egress"
  | "approval"
  | "authz-list"
  | "credential"
  | "channel"
  | "resource"
  | "privileged";

export type ActorKind = "user" | "agent" | "system" | "external";

export type SecuritySurface =
  | "ui"
  | "cli"
  | "other"
  | "slack"
  | "telegram"
  | "scheduler"
  | "ext-authz"
  | "mcp"
  | "ws";

export interface SecurityFields {
  category: SecurityCategory;
  actor: string | null;
  actorKind: ActorKind;
  surface?: SecuritySurface;
  result?: "success" | "failure";
  decision?: "allow" | "deny" | "hold" | "expired";
  agentId?: string;
  target?: string;
  sourceIp?: string;
  correlationId?: string;
  reason?: string;
  detail?: Record<string, unknown>;
}

export function securityLog(
  level: LogLevel,
  event: string,
  fields: SecurityFields,
): void {
  getLogger()[level](fields, event);
}
