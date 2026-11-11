export const GATEWAY_RESTART_TITLE = "Restart network access?";

export const AGENT_KEEPS_RUNNING =
  "The agent keeps running — its outbound requests are briefly interrupted.";

export function describeWebSearchControlRestart(
  on: boolean,
  storedRuleLabel?: string,
): string {
  const restart = `Network access restarts (~5–15s) to ${on ? "start" : "stop"} reading the agent's model requests for web searches. ${AGENT_KEEPS_RUNNING}`;
  if (!on || !storedRuleLabel) return restart;
  return `${restart} The agent's stored web search rule, "${storedRuleLabel}", then answers every search without asking you. Change it under "When the agent searches".`;
}
