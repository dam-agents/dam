export {
  createSecretStoreRegistry,
  SecretStoreNotFoundError,
} from "./services/secret-store.js";
export type {
  SecretMetadata,
  SecretStore,
  SecretStoreRegistry,
} from "./services/secret-store.js";
export { createFileSecretStore } from "./infrastructure/file-secret-store.js";
export type { FileSecretStoreOpts } from "./infrastructure/file-secret-store.js";
