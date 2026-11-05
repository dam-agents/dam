import type { UserIdentity } from "api-server-api";

export {
  agentOnBehalfUser,
  type AgentOnBehalfIdentity,
} from "./domain/principal.js";
export { createFailClosedOwnerActive } from "./services/owner-active.js";
export {
  verifyAgentOnBehalf,
  type AgentOnBehalfRefusal,
  type AgentOnBehalfVerifier,
} from "./services/agent-on-behalf-verifier.js";

export type { UserIdentity };
