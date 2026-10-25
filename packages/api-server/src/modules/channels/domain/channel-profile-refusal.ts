/**
 * UNIT_BOUNDARY_DESCRIPTION: a channel whose row names a profile that cannot
 * run on its agent (D91). The turn is refused with that reason and the thread
 * is told, rather than the turn running on the agent's default — a substitute
 * the owner never chose.
 */
export class ChannelProfileRefusedError extends Error {
  constructor(
    readonly profileName: string,
    readonly detail: string,
  ) {
    super(
      `this channel's profile "${profileName}" cannot run on this agent: ${detail}`,
    );
    this.name = "ChannelProfileRefusedError";
  }
}
