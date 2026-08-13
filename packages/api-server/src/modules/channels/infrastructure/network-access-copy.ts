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
