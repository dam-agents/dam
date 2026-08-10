/**
 * Turn provenance for a session that also lives in a messenger thread.
 *
 * A channel worker frames every relayed turn with a `<how-to-respond>` contract
 * naming the thread and the tools that reach it. That text stays in the
 * session's history, so continuing the same conversation from the UI leaves the
 * agent under instructions it was given for a message that arrived somewhere
 * else — it calls the messenger reply tool, and the person typing gets a tool
 * call instead of an answer. The counter-frame below states the provenance of
 * the turn actually in hand.
 *
 * Only the surface knows where a prompt came from, so it says so on the prompt
 * (`_meta.platform.surface`); an unmarked prompt is framed by nothing and falls
 * back to the channel contract's own scoping clause.
 */

/** Surfaces where a person is typing at the agent directly. Only the UI marks
 *  its prompts today; the CLI drives sessions the same way and is framed as
 *  soon as it says so. */
const DIRECT_SURFACES = new Set(["ui", "cli"]);

export function isDirectSurface(surface: string | null): boolean {
  return surface !== null && DIRECT_SURFACES.has(surface);
}

/**
 * Deliberately names no messenger and no product: one contract serves every
 * channel type, and the brand belongs to config, not to a runtime string.
 */
export function directTurnContract(): string {
  return [
    "<how-to-respond>",
    "This message didn't arrive from a messenger — someone is talking with " +
      "you directly here, and your reply text reaches them as you write it. " +
      "Answer in plain text.",
    // Rule first, examples second and explicitly the channel's own set: one
    // contract serves every channel type, and a closed list of one messenger's
    // tools would read as leave to answer with another's.
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

/**
 * Prepend the contract to a `session/prompt` frame's content blocks, returning
 * a new frame — the caller keeps the original, which is what gets logged and
 * fanned out to other viewers, so the framing never shows up as part of what
 * the person typed. A prompt whose blocks aren't an array is passed through
 * untouched rather than reshaped.
 */
export function frameDirectTurn(frame: object): object {
  if (!isNonNullObject(frame)) return frame;
  const params = frame.params;
  if (!isNonNullObject(params) || !Array.isArray(params.prompt)) return frame;
  return {
    ...frame,
    params: {
      ...params,
      prompt: [{ type: "text", text: directTurnContract() }, ...params.prompt],
    },
  };
}
