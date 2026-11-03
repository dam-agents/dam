import { HARNESS_CALL_COSTS_MAX, type SpendCallCost } from "api-server-api";
import type { RouterExtension } from "./model-router.js";

export const CALL_COSTS_PATH = "/platform/call-costs";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the measured cost of model calls the router
 * forwarded, by the call id it returns on each reply in `x-platform-call`.
 * Pi prices nothing itself on the router, so its extension asks here after a
 * call ends and adds the answer to the Session's cost; the figure is the
 * api-server's ledger, the one the Usage page shows. A call the ledger has not
 * priced yet is left out, and the harness asks again.
 */
export function createCallCostsEndpoint(
  callCosts: (routerCallIds: string[]) => Promise<SpendCallCost[]>,
  log: (msg: string) => void,
): RouterExtension {
  const json = (
    res: {
      writeHead(status: number, headers: Record<string, string>): unknown;
      end(body: string): unknown;
    },
    status: number,
    body: unknown,
  ): true => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
    return true;
  };
  return {
    name: "call-costs",
    async handle({ req, res, path }) {
      if (req.method !== "GET" || path !== CALL_COSTS_PATH) return false;
      const ids = [
        ...new Set(
          new URL(req.url ?? "/", "http://router").searchParams.getAll("id"),
        ),
      ];
      if (ids.length === 0 || ids.length > HARNESS_CALL_COSTS_MAX)
        return json(res, 400, {
          error: `name 1 to ${HARNESS_CALL_COSTS_MAX} calls with ?id=`,
        });
      try {
        const costs = await callCosts(ids);
        return json(res, 200, {
          data: costs.map((c) => ({
            id: c.routerCallId,
            unit: c.unit,
            costMicros: c.costMicros,
            estimated: c.estimated,
          })),
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        log(`[model-router] call costs unavailable: ${reason}`);
        return json(res, 502, { error: `call costs unavailable: ${reason}` });
      }
    },
  };
}
