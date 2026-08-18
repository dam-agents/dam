export { composeAgentsModule } from "./compose.js";
export type {
  AgentCleanupHook,
  PresetSeeder,
  ContributionsProgressPort,
  ContributionsProgress,
  RuntimeProgressPort,
} from "./services/agents-service.js";
export {
  createAgentsRepository,
  type AgentsRepository,
} from "./infrastructure/agents-repository.js";
export {
  createAgentEnvRepository,
  type AgentEnvRepository,
} from "./infrastructure/agent-env-repository.js";
export {
  createAgentRegistrySecretPort,
  type AgentRegistrySecretPort,
} from "./infrastructure/agent-registry-secret-port.js";
export {
  createKeycloakUserDirectory,
  type KeycloakUserDirectory,
} from "./infrastructure/keycloak-user-directory.js";
export { startChannelCleanupSaga } from "./sagas/channel-cleanup.js";
export type { InfraAgent } from "./infrastructure/agent-mappers.js";
export {
  createAgentSweep,
  isSweepDue,
  type AgentSweep,
} from "./services/agent-sweep.js";
export {
  AgentWakeTimeoutError,
  isAgentWakeTimeoutError,
  isTransientWakeFailure,
  wakeFailureReasonToken,
  type WakeFailureCause,
} from "./domain/wake-failure.js";
export {
  AgentStoppedError,
  isAgentStoppedError,
} from "./domain/agent-stopped.js";
export { buildAppendAgentsMdCommand } from "./domain/agents-md.js";
export {
  deleteChannelsByAgent,
  listChannelsByOwner,
  findBySlackChannelId,
  findSlackChannelsByAgent,
  deleteSlackChannelByAgent,
  deleteSlackChannelBinding,
  setSlackChannelAmbient,
} from "./infrastructure/channel-bindings-repository.js";
