export { composeAgentsModule } from "./compose.js";
export type {
  AgentCleanupHook,
  PresetSeeder,
  ContributionsSettledPort,
} from "./services/agents-service.js";
export {
  createAgentsRepository,
  type AgentsRepository,
} from "./infrastructure/agents-repository.js";
export {
  createAgentRegistrySecretPort,
  type AgentRegistrySecretPort,
} from "./infrastructure/agent-registry-secret-port.js";
export {
  createKeycloakUserDirectory,
  type KeycloakUserDirectory,
} from "./infrastructure/keycloak-user-directory.js";
export { startChannelSecretCleanupSaga } from "./sagas/channel-secret-cleanup.js";
export { startChannelCleanupSaga } from "./sagas/channel-cleanup.js";
export type { InfraAgent } from "./infrastructure/agent-mappers.js";
export {
  deleteChannelsByAgent,
  listChannelsByOwner,
  findBySlackChannelId,
  findSlackChannelByAgent,
} from "./infrastructure/channel-bindings-repository.js";
