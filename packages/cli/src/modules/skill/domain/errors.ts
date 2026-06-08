export type { TransportError, AuthRequiredError } from "../../shared/errors.js";

/** Wake-path verb couldn't make the agent reachable (error state / wake
 *  timeout). The CLI sent an agentId and the server still failed. → exit 7. */
export interface AgentNotReachableError {
  kind: "agent-not-reachable";
  reason: string;
}

/** `catalog` on a private/non-GitHub source with no --agent: the server can't
 *  scan it without a pod. → exit 2 with a "pass --agent" hint. */
export interface PrivateSourceNeedsAgentError {
  kind: "private-source-needs-agent";
}
