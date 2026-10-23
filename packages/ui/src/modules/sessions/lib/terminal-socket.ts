import type { TerminalDrop } from "api-server-api";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the terminal-relay URL of one connection of the
 * web terminal. Without `wakes` the URL carries `wake=0`, so a connect the user
 * did not ask for, such as a reconnect, does not wake an Agent.
 */
export function terminalSocketUrl(input: {
  location: Pick<Location, "protocol" | "host">;
  agentId: string;
  sessionId: string;
  token: string;
  reset: boolean;
  wakes: boolean;
  lease: Record<string, string> | null;
}): string {
  const query = new URLSearchParams({
    token: input.token,
    sessionId: input.sessionId,
    ...(input.reset && { reset: "1" }),
    ...(!input.wakes && { wake: "0" }),
    ...input.lease,
  });
  const scheme = input.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${input.location.host}/api/agents/${input.agentId}/terminal?${query.toString()}`;
}

export function terminalCloseDrop(code: number, reason: string): TerminalDrop {
  return code === 1006
    ? { kind: "lost", reason: "connection lost" }
    : { kind: "closed", code, reason };
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: `reset=1` kills the Session's PTY and starts a
 * fresh one. A fresh terminal asks for it until one of its connections carries
 * a frame, which shows the runtime has attached it to the new PTY. After that
 * no connection asks for it: a reconnect, by itself or by the user, must reach
 * the PTY that the reset started, not kill it again. A reconnect by itself
 * happens only after a connection that carried a frame, so it never resets.
 */
export function freshPty(): {
  reset: (fresh: boolean) => boolean;
  attached: () => void;
} {
  let attached = false;
  return {
    reset: (fresh) => fresh && !attached,
    attached: () => {
      attached = true;
    },
  };
}
