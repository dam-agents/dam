const DIRECT_SURFACES = new Set(["ui", "cli"]);

export function isDirectSurface(surface: string | null): boolean {
  return surface !== null && DIRECT_SURFACES.has(surface);
}

export function directTurnContract(): string {
  return [
    "<how-to-respond>",
    "This message didn't arrive from a messenger — someone is talking with " +
      "you directly here, and your reply text reaches them as you write it. " +
      "Answer in plain text.",
    "Don't answer it with a messenger tool — whichever ones your channel " +
      "gives you (reply, react, no_reply_needed, send_channel_message): they " +
      "belong to a messenger turn and deliver nothing here. Post to a " +
      "messenger on this turn only if you're asked to.",
    "</how-to-respond>",
  ].join("\n");
}

function isNonNullObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isTextBlock(
  block: unknown,
): block is Record<string, unknown> & { type: "text"; text: string } {
  return (
    isNonNullObject(block) &&
    block.type === "text" &&
    typeof block.text === "string"
  );
}

function withContract(prompt: unknown[]): unknown[] {
  const contract = directTurnContract();
  const first = prompt.findIndex(isTextBlock);
  if (first === -1) return [{ type: "text", text: contract }, ...prompt];
  return prompt.map((block, i) =>
    i === first && isTextBlock(block)
      ? { ...block, text: `${contract}\n\n${block.text}` }
      : block,
  );
}

export function frameDirectTurn(frame: object): object {
  if (!isNonNullObject(frame)) return frame;
  const params = frame.params;
  if (!isNonNullObject(params) || !Array.isArray(params.prompt)) return frame;
  return {
    ...frame,
    params: { ...params, prompt: withContract(params.prompt) },
  };
}
