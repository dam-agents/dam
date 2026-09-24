import type { ReportableTurn } from "./acp-runtime/acp-runtime.js";
import type { TriggerSessionDriver } from "./trigger-session-driver.js";

export function reportPrompt(report: ReportableTurn): string {
  const text = report.text.trim() || "(the task produced no text)";
  const cut = report.truncated ? "\n\n(the result was cut short)" : "";
  return `[Result of one-time task "${report.reportName}", run in session ${report.sessionId}]\n\n${text}${cut}`;
}

export function createOnceReporter(deps: {
  driver: TriggerSessionDriver;
  findSessionByRef: (ref: string) => string | undefined;
  log: (msg: string) => void;
}): (report: ReportableTurn) => void {
  return (report) => {
    const origin = deps.findSessionByRef(report.reportTo);
    if (!origin) {
      deps.log(
        `one-time task result from ${report.sessionId} dropped: the session that scheduled it is gone`,
      );
      return;
    }
    void deps.driver
      .start({
        task: reportPrompt(report),
        resumeSessionId: origin,
        unattended: true,
      })
      .catch((err: Error) =>
        deps.log(
          `one-time task result from ${report.sessionId} not delivered to ${origin}: ${err.message}`,
        ),
      );
  };
}
