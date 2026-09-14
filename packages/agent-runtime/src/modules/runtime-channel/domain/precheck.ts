import type { PrecheckVerdict } from "api-server-api";

import { describeFailure, runOnce } from "../../../core/run-once.js";

const PRECHECK_TIMEOUT_MS = 2 * 60 * 1000;

const CONTEXT_CAP_BYTES = 8 * 1024;

export interface PrecheckInput {
  command: string;
  workDir: string;
  scheduleId: string;
  fireAt?: string;
  lastRunAt?: string;
}

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
 * UNIT_BOUNDARY_DESCRIPTION: Runs one Schedule's Precheck and turns the process
 * into a verdict, so the trigger handler never reads an exit code itself. The
 * split follows grep: `0` allows the run, `1` declines it, and every other way
 * the command can end — a higher exit code, the two-minute deadline, a command
 * that will not spawn — is the Precheck breaking rather than saying no, which
 * allows the run and carries the reason. Keeping the broken case apart from the
 * declining one is the whole point: a typo that exited 127 would otherwise
 * silence a Schedule forever and look exactly like "nothing changed". Stdout
 * becomes context appended to the task prompt (capped, so a runaway `git log`
 * cannot flood the turn it was meant to save); stderr belongs to the pod log
 * and never reaches the prompt.
 */
export async function runPrecheck(
  input: PrecheckInput,
  log: (msg: string) => void,
): Promise<PrecheckOutcome> {
  const result = await runOnce({
    command: ["bash", "-lc", input.command],
    cwd: input.workDir,
    timeoutMs: PRECHECK_TIMEOUT_MS,
    env: {
      ...process.env,
      PLATFORM_SCHEDULE_ID: input.scheduleId,
      ...(input.fireAt ? { PLATFORM_FIRE_AT: input.fireAt } : {}),
      PLATFORM_LAST_RUN_AT: input.lastRunAt ?? "",
    },
  });

  if (result.ok) {
    const context = capped(result.value.stdout);
    return { verdict: "allowed", ...(context ? { context } : {}) };
  }

  if (result.error.kind === "exited" && result.error.code === 1) {
    log(`[precheck] ${input.scheduleId} declined this fire`);
    return { verdict: "declined" };
  }

  const detail = describeFailure("precheck", result.error);
  log(`[precheck] ${input.scheduleId} ${detail}; running anyway`);
  return { verdict: "precheck-failed", detail };
}
