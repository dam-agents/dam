import { PLATFORM_OUTBOUND_MCP_SERVER } from "api-server-api";

const UNATTENDED =
  "No human will reply in this session, so never pause to ask for confirmation, approval, or a go-ahead — make the reasonable call yourself and run the task through to completion, unattended. ";

// UNIT_BOUNDARY_DESCRIPTION: what a run that may ask is told in place of "nobody will reply": it still decides for itself wherever it can, and puts only a decision that is its owner's to them, through the tool, with the option it would take, since a question in plain text reaches nobody.
const MAY_ASK =
  "Nobody reads this session, so never pause to ask in plain text for confirmation, approval, or a go-ahead: make the reasonable call yourself wherever you can, and run the task through to completion. " +
  `Only when a decision is your owner's to make — it changes what gets built, it is costly to undo, or the task reads two ways and you cannot tell which they want — call the \`ask_owner\` tool on the ${PLATFORM_OUTBOUND_MCP_SERVER} MCP server with one question that covers everything you need, each real choice as its own option (none for an open question), and the answer you would take as the default. Then end your turn at once: the answer arrives as your next message in this conversation, and when nobody answers in time you are told to go on with your default. `;

function autonomousTargetDirective(
  schemaJson: string,
  canAsk: boolean,
): string {
  return (
    "You are running as an autonomous invocation target: your job is to do the task, then report exactly one result. " +
    (canAsk ? MAY_ASK : UNATTENDED) +
    `When the task is done, call the \`report_result\` tool on the ${PLATFORM_OUTBOUND_MCP_SERVER} MCP server with a single \`result\` argument: a JSON object that conforms to this JSON Schema:\n\n` +
    schemaJson +
    "\n\nThe platform validates your result against that schema. If it is rejected you will be told what was wrong — fix it and call `report_result` again until it is accepted. The platform decides you are done only when a call passes validation, so you must call `report_result`; simply finishing your turn does not report a result. Attribution is automatic: the platform resolves this invocation from your agent identity, so you pass no id."
  );
}

const CONTINUATION_NOTICE =
  "Your driver gives you a new task in this same conversation: what you did and learned above is still yours to use. Your earlier result was already reported; this task needs its own.";

// UNIT_BOUNDARY_DESCRIPTION: a run that continues one of the target's sessions says so first, since the model would otherwise read the new task as a retry of the one above it, whose result it already reported. A run its driver waits on through a tool may ask its owner; a script's run may not, since the script polls for an end and nobody would be told of the question.
export function buildInvocationPrompt(input: {
  prompt: string;
  resultSchema: unknown;
  continues?: boolean;
  canAsk?: boolean;
}): string {
  const schemaJson = JSON.stringify(input.resultSchema, null, 2);
  return [
    ...(input.continues ? [CONTINUATION_NOTICE] : []),
    input.prompt.trim(),
    autonomousTargetDirective(schemaJson, input.canAsk ?? false),
  ].join("\n\n");
}
