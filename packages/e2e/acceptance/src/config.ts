export const baseUrl = process.env.PLATFORM_BASE_URL ?? "http://localhost:4444";

export const keycloakUrl =
  process.env.PLATFORM_KEYCLOAK_URL ?? "http://keycloak.localhost:4444";

export const keycloakRealm = process.env.PLATFORM_KEYCLOAK_REALM ?? "platform";

export const keycloakClientId =
  process.env.PLATFORM_KEYCLOAK_CLIENT_ID ?? "platform-ui";

export const mockTemplateId = "mock";

export const accountPassword =
  process.env.PLATFORM_ACCEPTANCE_PASSWORD ?? "acceptance-e2e";

export const accountSlots = 2;
