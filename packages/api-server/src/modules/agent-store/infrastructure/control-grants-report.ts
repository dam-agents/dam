import type { Logger } from "../../../core/logger.js";
import type { ControlGrants } from "./control-grants.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Turns the controller's grant reconcile into one
 * log line.
 *
 * The grants live in application code, so the only record of what the
 * controller was given is what each start says. A role nobody created is a
 * state, not a fault — the install may not run a Postgres-backed controller —
 * so it is one info line; every state that leaves the controller unable to
 * reconcile warns under its own name, because a privilege this role cannot be
 * given needs an operator while a restart heals the rest.
 */
export function reportControlGrants(
  logger: Logger,
  grants: ControlGrants,
): void {
  const { role, missing, failed } = grants;

  if (failed !== undefined) {
    logger.warn({ role, error: failed }, "control.grants.failed");
    return;
  }
  if (!grants.rolePresent) {
    logger.info({ role }, "control.grants.role-absent");
    return;
  }
  if (grants.skipped) {
    logger.info({ role }, "control.grants.skipped");
    return;
  }
  if (missing.length > 0) {
    logger.warn({ role, missing }, "control.grants.incomplete");
    return;
  }
  logger.info({ role, granted: grants.granted }, "control.grants.reconciled");
}
