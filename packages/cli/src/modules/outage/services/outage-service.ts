import type { OutageAlertNotice, ProviderStatusView } from "api-server-api";
import { ok, type Result } from "../../../result.js";
import type { AuthRequiredError, TransportError } from "../../shared/errors.js";
import { trpcCall } from "../../shared/trpc/classify.js";
import type { TrpcClient } from "../../shared/trpc/trpc-client.js";

export interface OutageRead {
  providerStatus: ProviderStatusView;
  alerts: OutageAlertNotice[];
}

export interface OutageService {
  read(): Promise<Result<OutageRead, TransportError | AuthRequiredError>>;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: reads what a person needs to diagnose a failure
 * from outside, in one answer: the Provider Status query, so a degraded
 * template, the fault on the platform's side and the last check are known,
 * and the caller's own outage alerts, told and recovered, the same ones the
 * bell shows. Both reads are owner-scoped, so an Agent that holds the
 * install's DAM connection reads them for the user it works for.
 */
export function createOutageService(deps: { trpc: TrpcClient }): OutageService {
  return {
    async read() {
      const status = await trpcCall(() =>
        deps.trpc.providerStatus.list.query(),
      );
      if (!status.ok) return status;
      const attention = await trpcCall(() =>
        deps.trpc.attention.listForOwner.query(),
      );
      if (!attention.ok) return attention;
      return ok({
        providerStatus: status.value,
        alerts: attention.value.outageAlerts,
      });
    },
  };
}
