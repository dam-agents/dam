import type { UserIdentity } from "api-server-api";

export {
  AGENT_TOKEN_TTL_MS,
  createAgentTokenCodec,
  isAgentToken,
  type AgentTokenCodec,
  type AgentTokenIdentity,
} from "./domain/token.js";
export {
  agentOnBehalfUser,
  type AgentOnBehalfIdentity,
} from "./domain/principal.js";
export {
  createAgentTokenVerifier,
  type AgentTokenRefusal,
  type VerifiedAgentIdentity,
} from "./services/agent-token-verifier.js";

export type { UserIdentity };
