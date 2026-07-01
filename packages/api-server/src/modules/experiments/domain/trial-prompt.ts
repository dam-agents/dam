/** Harness-agnostic framing every trial carries. A trial runs unattended: the
 *  one-shot prompt is the arm's only turn and no human will answer follow-ups,
 *  so a harness that pauses for confirmation (e.g. an approval / cost gate)
 *  stalls here forever and never produces a Run. This directive tells any
 *  harness to proceed end to end on its own and carries the full record_run /
 *  finish_arm reporting contract inline, distilled to prose. It lives in the
 *  prompt (session-scoped, harness-agnostic) rather than a skill, which would
 *  reach only Claude-family harnesses and leak into every non-experiment agent
 *  (dam-rvc). */
const AUTONOMOUS_TRIAL_DIRECTIVE =
  "You are running as an autonomous experiment arm: your work produces one or more scored candidates. It may be a single run or an iterate-and-score loop — either is fine. No human will reply in this session, so never pause to ask for confirmation, approval, or a go-ahead — make the reasonable call yourself and run the task through to completion, unattended and bounded to a sensible budget. " +
  "Report every scored candidate the moment its score lands, one report per candidate and never batched at the end, using the record_run and finish_arm tools on the platform-outbound MCP server. For each candidate, write it to a file in your workspace, then call record_run with the candidate's score (a single number, higher is better — negate your metric if it is naturally lower-is-better, such as loss, error, latency, or cost) and candidate set to that file's path (absolute under $HOME or relative to your workspace). Do not delete the file before the call returns; the platform reads it during the call. Each candidate file is capped at 10 MiB. " +
  "Once you have reported your last candidate — the single run is done, the search is exhausted, the budget is spent, or the metric has converged — call finish_arm exactly once, after your final record_run, to mark the arm complete. Attribution is automatic for both tools: the platform resolves your experiment arm from your agent identity, so you never pass an experiment or arm id.";

export function buildTrialPrompt(input: {
  prompt: string;
  armVariation: string;
}): string {
  const parts = [input.prompt.trim()];
  const variation = input.armVariation.trim();
  if (variation.length > 0) {
    parts.push(`Arm variation:\n${variation}`);
  }
  parts.push(AUTONOMOUS_TRIAL_DIRECTIVE);
  return parts.join("\n\n");
}
