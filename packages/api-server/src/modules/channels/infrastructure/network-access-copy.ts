/** Agent-facing framing for the one failure a channel turn cannot recover
 *  from on its own, shared by the channel workers.
 *
 *  Reaching a host the owner hasn't allowed normally holds the request open
 *  until a human decides. From a messenger nobody can: the owner isn't
 *  necessarily present and the conversation's other members aren't the owner,
 *  so the request is refused as soon as it is recorded. The agent only ever
 *  sees the wire symptom of that (a closed connection, or a 403 from the
 *  proxy), which reads like the host being down — so the turn is told what the
 *  symptom means and what to say, rather than being left to guess or to retry
 *  into the same refusal.
 *
 *  Stated on every channel turn regardless of the agent's rules: an agent
 *  allowed everything never hits it, and the sentence is conditional, so it
 *  costs those turns a line and nothing else. */
export function channelNetworkAccessGuidance(brandName: string): string {
  return [
    "<network-access>",
    "You can only reach hosts your owner has allowed. A request to any " +
      "other host is refused immediately — you'll see a closed connection " +
      "or a 403 from the proxy — and it cannot be approved from this " +
      `conversation: only your owner can allow a host, in ${brandName}. ` +
      "If it happens, don't retry the same host in a loop. Name the host " +
      "you needed and why, say that the agent's owner has to allow it in " +
      `${brandName} (the request is already waiting for them there), and ` +
      "offer either an approach using hosts you can already reach or to " +
      "finish the task once it's allowed.",
    "</network-access>",
  ].join("\n");
}
