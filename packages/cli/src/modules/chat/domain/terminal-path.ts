export type TerminalConnect = "attach" | "reset" | "reconnect";

const CONNECT_QUERY: Record<TerminalConnect, Record<string, string>> = {
  attach: {},
  reset: { reset: "1" },
  reconnect: { wake: "0" },
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: the terminal-relay path for one connection of
 * `dam chat`. `reset` asks the runtime to kill the Session's PTY and start a
 * fresh one. A `reconnect` is the CLI's own connect after a lost connection,
 * not the user's, so it never carries `reset=1`, which would kill the Session it
 * is trying to reach, and it carries `wake=0`, so it does not wake an Agent
 * that its owner put to sleep while the connection was down.
 */
export function terminalPath(
  agentId: string,
  sessionId: string,
  connect: TerminalConnect,
): string {
  const query = new URLSearchParams({ sessionId, ...CONNECT_QUERY[connect] });
  return `/api/agents/${encodeURIComponent(agentId)}/terminal?${query.toString()}`;
}
