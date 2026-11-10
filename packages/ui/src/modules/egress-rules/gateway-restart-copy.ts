export const GATEWAY_RESTART_TITLE = "Restart network access?";

export const AGENT_KEEPS_RUNNING =
  "The agent keeps running — its outbound requests are briefly interrupted.";

export function describeWebSearchControlRestart(on: boolean): string {
  return `Network access restarts (~5–15s) to ${on ? "start" : "stop"} reading the agent's model requests for web searches. ${AGENT_KEEPS_RUNNING}`;
}
