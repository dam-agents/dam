import type { PrecheckVerdict } from "api-server-api";

import { describeFailure } from "../../../core/run-once.js";
import type { RunOnceResult } from "../../../core/run-once.js";

const CONTEXT_CAP_BYTES = 8 * 1024;

export interface PrecheckOutcome {
  verdict: PrecheckVerdict;
  context?: string;
  detail?: string;
}

function capped(stdout: string): string | undefined {
  const text = stdout.trim();
  if (!text) return undefined;
  if (Buffer.byteLength(text) <= CONTEXT_CAP_BYTES) return text;
  const kept = Buffer.from(text).subarray(0, CONTEXT_CAP_BYTES).toString();
  return `${kept}\n[truncated at ${CONTEXT_CAP_BYTES} bytes]`;
}

export function verdictFor(result: RunOnceResult): PrecheckOutcome {
  if (result.ok) {
    const context = capped(result.value.stdout);
    return { verdict: "allowed", ...(context ? { context } : {}) };
  }
  if (result.error.kind === "exited" && result.error.code === 1)
    return { verdict: "declined" };

  const detail = describeFailure("precheck", result.error);
  const printed =
    result.error.kind === "exited" ? capped(result.error.stdout) : undefined;
  return {
    verdict: "precheck-failed",
    detail,
    context: printed
      ? `${printed}\n\n[The precheck failed after printing the above (${detail}), so it may be incomplete. Check it before acting on it.]`
      : `[none — the precheck failed (${detail}). This run started anyway, so there is no precheck result to work from.]`,
  };
}
