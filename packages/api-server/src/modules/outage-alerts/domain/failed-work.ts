export type FailedWork = {
  readonly kind: "session";
  readonly agentId: string;
  readonly sessionId: string;
};

export const FAILED_WORK_KEPT_MS = 24 * 60 * 60 * 1000;
