export interface ReportRetry {
  attempts: number;
  delayMs: number;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Sends one report to the api-server and never
 * throws, because a report is a side channel: a lost one costs a retry or a
 * log line, never the turn that produced it. The caller sets the attempts and
 * the delay — one attempt and no delay, unless a lost report leaves a record
 * that stays wrong.
 */
export async function safeReport(
  send: () => Promise<unknown>,
  log: (msg: string) => void,
  subject: string,
  retry?: ReportRetry,
): Promise<boolean> {
  for (let attempt = 1; ; attempt++) {
    try {
      await send();
      return true;
    } catch (err) {
      if (attempt >= (retry?.attempts ?? 1)) {
        log(
          `${subject} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, retry?.delayMs ?? 0));
    }
  }
}
