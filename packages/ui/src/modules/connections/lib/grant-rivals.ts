import { type ConnectionView, unaddressableRivalHost } from "api-server-api";

interface GrantRivalry {
  connection: ConnectionView;
  rival: ConnectionView;
  host: string;
}

export function grantRivalry(
  candidate: ConnectionView,
  granted: readonly ConnectionView[],
): GrantRivalry | undefined {
  for (const rival of granted) {
    const host = unaddressableRivalHost(candidate, rival);
    if (host !== undefined) return { connection: candidate, rival, host };
  }
  return undefined;
}

export function grantRivalries(
  granted: readonly ConnectionView[],
): GrantRivalry[] {
  return granted.flatMap((connection, index) => {
    const rivalry = grantRivalry(connection, granted.slice(index + 1));
    return rivalry ? [rivalry] : [];
  });
}

export function grantBlockedReason({ rival, host }: GrantRivalry): string {
  return `This agent already signs in to ${host} as "${rival.name}". Remove it from the agent to use this account instead.`;
}

export function grantSkippedMessage({
  connection,
  rival,
  host,
}: GrantRivalry): string {
  return `Created "${connection.name}", but did not add it to this agent: it already signs in to ${host} as "${rival.name}".`;
}

export function grantRivalryWarning({
  connection,
  rival,
  host,
}: GrantRivalry): string {
  return `"${connection.name}" and "${rival.name}" both sign in to ${host}. This agent cannot tell them apart, so the requests both would sign there are refused. Remove one of them.`;
}
