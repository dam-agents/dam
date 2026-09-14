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

/**
 * UNIT_BOUNDARY_DESCRIPTION: Turns the result of one Precheck process into a
 * verdict, so no caller reads an exit code itself. The split follows grep: `0`
 * allows the run, `1` declines it, and every other way the command can end — a
 * higher exit code, the deadline, a command that will not spawn — is the
 * Precheck breaking rather than saying no, which allows the run and carries the
 * reason. Keeping the broken case apart from the declining one is the whole
 * point: a typo that exited 127 would otherwise silence a Schedule forever and
 * look exactly like "nothing changed". Stdout becomes context appended to the
 * task prompt, capped so a runaway `git log` cannot flood the turn it was meant
 * to save; stderr belongs to the pod log and never reaches the prompt.
 */
export function verdictFor(result: RunOnceResult): PrecheckOutcome {
  if (result.ok) {
    const context = capped(result.value.stdout);
    return { verdict: "allowed", ...(context ? { context } : {}) };
  }
  if (result.error.kind === "exited" && result.error.code === 1)
    return { verdict: "declined" };
  return {
    verdict: "precheck-failed",
    detail: describeFailure("precheck", result.error),
  };
}
