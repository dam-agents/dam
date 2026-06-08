export type { SkillsService } from "./services/skills-service.js";
export { createSkillsService } from "./services/skills-service.js";
export type {
  TransportError,
  AuthRequiredError,
  AgentNotReachableError,
  PrivateSourceNeedsAgentError,
  SourceNeedsConnectionError,
} from "./domain/errors.js";
