import { match } from "ts-pattern";

export type OwnerRequestReach = "ok" | "unlinked" | "muted";

const REFUSED_AT_ONCE = (brandName: string) =>
  "You can only reach hosts your owner has allowed. A request to any " +
  "other host is refused immediately — you'll see a closed connection " +
  "or a 403 from the proxy — and it cannot be approved from this " +
  `conversation: only your owner can allow a host, in ${brandName}. ` +
  "If it happens, don't retry the same host in a loop. Name the host " +
  "you needed and why, say that the agent's owner has to allow it in " +
  `${brandName} (the request is already waiting for them there), and ` +
  "offer either an approach using hosts you can already reach or to " +
  "finish the task once it's allowed.";

const ASKS_THE_OWNER =
  "You can only reach hosts your owner has allowed. A request to another " +
  "host, a web search or a tool call that needs approval goes to your " +
  "owner in Slack, and it waits for the answer while your tool waits; " +
  "nothing promises how long. The person who asked can press \"Don't " +
  "wait\" under the thread's line to go on without the step. When such a " +
  "request ends without an answer (your tool gave up, the connection " +
  "closed, or the proxy said the wait was ended in Slack), it was not " +
  "denied: don't retry it in a loop. Finish your answer without that " +
  "step, and tell the person who asked that the thread will say when the " +
  "owner allows it, and that they can then ask again.";

// UNIT_BOUNDARY_DESCRIPTION: what a channel turn's agent reads about hosts, web searches and tool calls that need its owner's approval. On an addressed Slack turn of an owner who can get cards, the request goes to the owner in Slack and waits while the agent's tool waits, with no promised time; everywhere else it is refused at once and waits for the owner in the app. For an owner who has not linked Slack, the agent also says that the owner can answer such requests from Slack after linking with the login command; for an owner who turned the cards off, that the owner does not take such requests in Slack now.
export function channelNetworkAccessGuidance(
  brandName: string,
  ownerRequests?: { reach: OwnerRequestReach; loginCommand: string },
): string {
  const body = match(ownerRequests?.reach)
    .with("ok", () => ASKS_THE_OWNER)
    .with(
      "unlinked",
      () =>
        `${REFUSED_AT_ONCE(brandName)} Also say that the agent's owner can ` +
        "answer such requests here in Slack after linking their Slack " +
        `account with \`${ownerRequests?.loginCommand ?? ""}\`.`,
    )
    .with(
      "muted",
      () =>
        `${REFUSED_AT_ONCE(brandName)} Also say that the agent's owner does ` +
        "not take such requests in Slack now.",
    )
    .with(undefined, () => REFUSED_AT_ONCE(brandName))
    .exhaustive();
  return ["<network-access>", body, "</network-access>"].join("\n");
}
