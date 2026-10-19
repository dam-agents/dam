export interface GatewayCall {
  readonly payer: string;
  readonly providers: readonly string[];
  readonly status: number | null;
  readonly refusedByGate: boolean;
  readonly endedAt: Date;
}

export interface CallOutcome {
  readonly templateId: string;
  readonly payer: string;
  readonly failed: boolean;
  readonly endedAt: Date;
}

const PROVIDER_FAILURE_STATUSES: ReadonlySet<number> = new Set([
  500, 502, 503, 504, 529,
]);

export function outcomeOf(call: GatewayCall): CallOutcome | null {
  if (call.refusedByGate || call.status === null) return null;
  const [templateId, ...others] = call.providers;
  if (!templateId || others.length > 0) return null;
  return {
    templateId,
    payer: call.payer,
    failed: PROVIDER_FAILURE_STATUSES.has(call.status),
    endedAt: call.endedAt,
  };
}
