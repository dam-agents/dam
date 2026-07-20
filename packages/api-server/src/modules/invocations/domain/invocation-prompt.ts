/** Harness-agnostic framing every Invocation target carries. A target runs
 *  unattended: the one-shot prompt is its only turn and no human will answer
 *  follow-ups, so a harness that pauses for confirmation stalls forever and
 *  never reports. This directive tells any harness to run end to end on its own
 *  and carries the `report_result` reporting contract inline, distilled to
 *  prose. It lives in the prompt (session-scoped, harness-agnostic) rather than
 *  a skill, which would reach only Claude-family harnesses and leak into
 *  agents that are not Invocation targets. */
function autonomousTargetDirective(schemaJson: string): string {
  return (
    "You are running as an autonomous invocation target: your job is to do the task, then report exactly one result. " +
    "No human will reply in this session, so never pause to ask for confirmation, approval, or a go-ahead — make the reasonable call yourself and run the task through to completion, unattended. " +
    "When the task is done, call the `report_result` tool on the platform-outbound MCP server with a single `result` argument: a JSON object that conforms to this JSON Schema:\n\n" +
    schemaJson +
    "\n\nThe platform validates your result against that schema. If it is rejected you will be told what was wrong — fix it and call `report_result` again until it is accepted. The platform decides you are done only when a call passes validation, so you must call `report_result`; simply finishing your turn does not report a result. Attribution is automatic: the platform resolves this invocation from your agent identity, so you pass no id."
  );
}

export function buildInvocationPrompt(input: {
  prompt: string;
  /** The result JSON Schema, echoed into the contract so the harness knows the
   *  exact shape to aim for. */
  resultSchema: unknown;
}): string {
  const schemaJson = JSON.stringify(input.resultSchema, null, 2);
  return [input.prompt.trim(), autonomousTargetDirective(schemaJson)].join(
    "\n\n",
  );
}
