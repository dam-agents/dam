import type { Logger } from "../../../core/logger.js";
import type { UsageViewGrants } from "./usage-view-grants.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Turns a grant reconcile into exactly one log line.
 *
 * A privilege step that lives in application code is invisible in the release
 * artifact, so the reconcile is only defensible if each start says what it did.
 * The branches are ordered by how much they cost the operator: a role nobody
 * created is the normal case on most installs and only worth an info line,
 * while every state that leaves the consumer unable to read warns, and each
 * warns under its own name so the one that no restart can fix is not confused
 * with the one that a restart heals.
 */
export function reportUsageViewGrants(
  logger: Logger,
  grants: UsageViewGrants,
): void {
  const { role, readable, unreadable, notGrantable, granted, failed } = grants;

  if (failed !== undefined) {
    logger.warn({ role, error: failed }, "usage.grants.failed");
    return;
  }
  if (!grants.rolePresent) {
    logger.info({ role }, "usage.grants.role-absent");
    return;
  }
  if (!grants.canConnect || !grants.canUseSchema) {
    logger.warn(
      {
        role,
        canConnect: grants.canConnect,
        canUseSchema: grants.canUseSchema,
      },
      "usage.grants.unreachable",
    );
    return;
  }
  if (unreadable.length > 0) {
    logger.warn(
      { role, readable, unreadable, notGrantable },
      "usage.grants.incomplete",
    );
    return;
  }
  if (notGrantable.length > 0) {
    logger.warn({ role, readable, notGrantable }, "usage.grants.not-grantable");
    return;
  }
  logger.info({ role, readable, granted }, "usage.grants.reconciled");
}
