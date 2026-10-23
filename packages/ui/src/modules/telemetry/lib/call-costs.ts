import type {
  SpendCallCost,
  TelemetryLog,
  TelemetrySpan,
  TurnDetail,
} from "api-server-api";

export const ROUTER_CALL_ID = "platform.call.id";
const REQUEST_ID = "request_id";

export type CallCostOf = {
  log(log: TelemetryLog): SpendCallCost | undefined;
  span(
    span: TelemetrySpan,
    logs: readonly TelemetryLog[],
  ): SpendCallCost | undefined;
};

export function routerCallIdsOf(turn: TurnDetail): string[] {
  return [
    ...new Set(
      turn.logs.flatMap((log) => {
        const id = log.attributes[ROUTER_CALL_ID];
        return id ? [id] : [];
      }),
    ),
  ];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: a cost row names the Model Router's call id,
 * which only the router's own record carries; a harness's record of the same
 * call, and a span, reach the cost through the request id they share with
 * that record.
 */
export function callCostOf(
  turn: TurnDetail,
  costs: ReadonlyMap<string, SpendCallCost>,
): CallCostOf {
  const byRequest = new Map<string, SpendCallCost>();
  for (const log of turn.logs) {
    const cost = costs.get(log.attributes[ROUTER_CALL_ID] ?? "");
    const request = log.attributes[REQUEST_ID];
    if (cost && request) byRequest.set(request, cost);
  }
  const log = (record: TelemetryLog) =>
    costs.get(record.attributes[ROUTER_CALL_ID] ?? "") ??
    byRequest.get(record.attributes[REQUEST_ID] ?? "");
  return {
    log,
    span: (span, logs) =>
      byRequest.get(span.attributes[REQUEST_ID] ?? "") ??
      logs.map(log).find((cost) => cost !== undefined),
  };
}
