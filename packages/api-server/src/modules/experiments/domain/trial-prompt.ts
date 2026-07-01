/** Harness-agnostic framing every trial carries. A trial runs unattended: the
 *  one-shot prompt is the arm's only turn and no human will answer follow-ups,
 *  so a harness that pauses for confirmation (e.g. an approval / cost gate)
 *  stalls here forever and never produces a Run. This tells any harness to
 *  proceed end to end on its own and to report each scored candidate as it
 *  lands, which is what the `platform-experiments` skill turns into `record_run`
 *  calls (dam-p1m). */
const AUTONOMOUS_TRIAL_DIRECTIVE =
  "You are running as an autonomous experiment arm. No human will reply in this session, so never pause to ask for confirmation, approval, or a go-ahead — make the reasonable call yourself and run the task through to completion. Bound the work to a sensible budget and run it unattended. Report every scored candidate as you produce it via the record_run tool (per the platform-experiments skill), one call per scored iteration rather than batched at the end.";

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
