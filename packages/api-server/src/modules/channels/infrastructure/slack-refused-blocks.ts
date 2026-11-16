const REFUSED_BLOCKS = new Set([
  "invalid_blocks",
  "invalid_blocks_format",
  "msg_blocks_too_long",
]);

interface SlackRefusal {
  error: string;
  errors?: unknown;
  response_metadata?: { messages?: unknown };
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Slack is the judge of a Channel Card's blocks:
 * the platform does not know their schema. When Slack refuses a message for
 * its blocks, this turns Slack's answer into the error the Agent reads, with
 * Slack's own wording of what is wrong, so the Agent can fix the blocks.
 * Any other failure gives null and stays what it was. The error keeps
 * Slack's `data`, so a caller that reads the refusal code still finds it.
 */
export function slackBlocksRefusal(err: unknown): Error | null {
  const data = (err as { data?: Partial<SlackRefusal> } | null)?.data;
  if (typeof data?.error !== "string" || !REFUSED_BLOCKS.has(data.error))
    return null;
  const details = [
    ...strings(data.response_metadata?.messages),
    ...strings(data.errors),
  ];
  const wording = details.length > 0 ? `: ${details.join("; ")}` : "";
  return Object.assign(
    new Error(
      `Slack refused the blocks (${data.error})${wording}. Nothing was sent. Fix the blocks, or send the message as text.`,
    ),
    { data },
  );
}
