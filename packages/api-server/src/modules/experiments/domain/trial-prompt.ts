/** Harness-agnostic framing every trial carries. A trial runs unattended: the
 *  one-shot prompt is the arm's only turn and no human will answer follow-ups,
 *  so a harness that pauses for confirmation (e.g. an approval / cost gate)
 *  stalls here forever and never produces a Run. This directive tells any
 *  harness to proceed end to end on its own and carries the full record_run /
 *  finish_arm reporting contract inline, distilled to prose. It lives in the
 *  prompt (session-scoped, harness-agnostic) rather than a skill, which would
 *  reach only Claude-family harnesses and leak into every non-experiment agent
 *  (dam-rvc). */
function autonomousTrialDirective(candidateCap: string): string {
  return (
    "You are running as an autonomous experiment arm: your work produces one or more scored candidates. It may be a single run or an iterate-and-score loop — either is fine. No human will reply in this session, so never pause to ask for confirmation, approval, or a go-ahead — make the reasonable call yourself and run the task through to completion, unattended and bounded to a sensible budget. " +
    "Report every scored candidate the moment its score lands, one report per candidate and never batched at the end, using the tools on the platform-outbound MCP server. " +
    "For each candidate, write it to a file in your workspace, call request_candidate_upload to get an upload link, upload the file to that link with a plain HTTP PUT (for example: curl -sS -f -X PUT --upload-file <file> '<uploadUrl>' — keep your environment's default proxy settings), then call record_run with the candidate's score (a single number, higher is better — negate your metric if it is naturally lower-is-better, such as loss, error, latency, or cost) and candidateRef set to the reference the upload tool returned." +
    " Each candidate file is capped at " +
    candidateCap +
    ". " +
    "Once you have reported your last candidate — the single run is done, the search is exhausted, the budget is spent, or the metric has converged — call finish_arm exactly once, after your final record_run, to mark the arm complete. Attribution is automatic for all these tools: the platform resolves your experiment arm from your agent identity, so you never pass an experiment or arm id."
  );
}

/** Whole MiB when it is one, raw bytes otherwise. */
export function formatByteCap(bytes: number): string {
  const mib = 1024 * 1024;
  return bytes % mib === 0 ? `${bytes / mib} MiB` : `${bytes} bytes`;
}

export function buildTrialPrompt(input: {
  prompt: string;
  armVariation: string;
  /** Quoted in the contract so the harness self-limits to the real cap. */
  maxArtifactBytes: number;
}): string {
  const parts = [input.prompt.trim()];
  const variation = input.armVariation.trim();
  if (variation.length > 0) {
    parts.push(`Arm variation:\n${variation}`);
  }
  parts.push(autonomousTrialDirective(formatByteCap(input.maxArtifactBytes)));
  return parts.join("\n\n");
}
