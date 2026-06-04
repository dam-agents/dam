export {
  createSecretStoreRegistry,
  SecretStoreNotFoundError,
} from "./services/secret-store.js";
export type {
  SecretMetadata,
  SecretStore,
  SecretStoreRegistry,
} from "./services/secret-store.js";
export { createKubernetesSecretStore } from "./infrastructure/k8s-secret-store.js";
export type { KubernetesSecretStoreOpts } from "./infrastructure/k8s-secret-store.js";
