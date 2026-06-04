/** Security audit trail — the structured-field convention layered on the
 *  general `logger` (logger.ts) so a security incident can be reconstructed
 *  from STDOUT: *who did what, to what, and whether it was allowed*.
 *
 *  This is a thin, typed wrapper over `logger[level]` — NOT a new log level
 *  or a separate stream. Every line carries `category`, which is what a log
 *  shipper filters on to isolate the audit trail from operational noise.
 *
 *  Level mapping (the common levels, used as usual):
 *    - `warn`  — a denied / blocked / failed security decision
 *    - `info`  — an allowed / successful security-relevant action or mutation
 *    - `error` — an internal failure on a security path
 *
 *  Actor is the raw (un-pseudonymized) Keycloak `sub`: forensics needs direct
 *  attribution, which is the deliberate difference from the usage subsystem's
 *  HMAC-pseudonymized `activity_events` (those protect analytics-at-rest; this
 *  protects an investigation). The audit stream is therefore PII and is
 *  governed at the log sink. See dam-ops#13.
 *
 *  Redaction is the caller's responsibility: never pass token/secret/PAT
 *  values, raw JWTs, or raw prompts. Pass metadata only (`hasRefresh`,
 *  `secretId`, env key *names*, byte counts). Never spread a whole domain
 *  event into `detail` — project explicit fields. */

import { getLogger, type LogLevel } from "./logger.js";

export type SecurityCategory =
  | "authn" // authentication (who you are)
  | "authz" // authorization (what you may do)
  | "egress" // credentialed egress / ext_authz decisions
  | "approval" // HITL verdicts
  | "authz-list" // allow-list mutations (allowedUsers, egress rules, grants)
  | "credential" // secret / token / connection lifecycle
  | "channel" // messenger inbound/outbound + identity linking
  | "resource" // agent / schedule lifecycle
  | "privileged"; // privileged reads / admin-surface actions

export type ActorKind = "user" | "agent" | "system" | "external";

export type SecuritySurface =
  | "ui"
  | "cli"
  | "other" // an OIDC client that is neither the UI nor the CLI
  | "slack"
  | "telegram"
  | "scheduler"
  | "ext-authz"
  | "mcp"
  | "ws";

export interface SecurityFields {
  /** Coarse class — the field a log shipper filters the audit trail on. */
  category: SecurityCategory;
  /** Raw Keycloak `sub`, `"system:<component>"`, an external id, or null. */
  actor: string | null;
  actorKind: ActorKind;
  surface?: SecuritySurface;
  /** Execution outcome — distinct from `decision` so "what failed" and "what
   *  was denied" stay separable. */
  result?: "success" | "failure";
  /** Policy outcome for gated actions. */
  decision?: "allow" | "deny" | "hold" | "expired";
  agentId?: string;
  /** What was acted on — host / connectionKey / secretId / resource id. */
  target?: string;
  /** Client IP at the HTTP edge (strip any `?token=` before passing a URL). */
  sourceIp?: string;
  /** Ties a multi-site flow together (e.g. ext_authz hold → verdict). */
  correlationId?: string;
  /** Denial cause / failure reason. */
  reason?: string;
  /** Shallow, value-free extras (added/removed subs, changed env key names,
   *  matched rule, byte counts). Never raw secrets/prompts. */
  detail?: Record<string, unknown>;
}

/** Emit one security audit line at the given common level. The dotted `event`
 *  name is the log message; `fields` are merged into the JSON line. */
export function securityLog(
  level: LogLevel,
  event: string,
  fields: SecurityFields,
): void {
  getLogger()[level](fields, event);
}
