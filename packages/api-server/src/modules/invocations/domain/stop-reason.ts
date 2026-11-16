import type { DelegationStopped } from "api-server-api";

const BY_USER = "stopped by the user";
const BY_DRIVER = "stopped by its driver";

export const userStopReason = (): string => BY_USER;

export const driverStopReason = (reason?: string): string =>
  reason ? `${BY_DRIVER}: ${reason}` : BY_DRIVER;

/**
 * UNIT_BOUNDARY_DESCRIPTION: who stopped a failed run, read back from the
 * reason the stop wrote, which only the two builders above write; any other
 * reason is a failure. The driver's own words follow its prefix.
 */
export function stoppedOf(
  errorReason: string | null,
): DelegationStopped | null {
  if (errorReason === BY_USER) return { by: "user", reason: null };
  if (errorReason === BY_DRIVER) return { by: "driver", reason: null };
  if (errorReason?.startsWith(`${BY_DRIVER}: `))
    return { by: "driver", reason: errorReason.slice(BY_DRIVER.length + 2) };
  return null;
}
