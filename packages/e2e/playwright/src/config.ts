export const baseUrl = process.env.PLATFORM_BASE_URL ?? "http://localhost:4444";

export const keycloakUrl =
  process.env.PLATFORM_KEYCLOAK_URL ?? "http://keycloak.localhost:4444";

export const keycloakRealm = process.env.PLATFORM_KEYCLOAK_REALM ?? "platform";

export const keycloakClientId =
  process.env.PLATFORM_KEYCLOAK_CLIENT_ID ?? "platform-ui";

export const testUser = {
  username: process.env.PLATFORM_E2E_USERNAME ?? "dev",
  password: process.env.PLATFORM_E2E_PASSWORD ?? "dev",
};

export const testUser2 = {
  username: process.env.PLATFORM_E2E_USERNAME2 ?? "dev2",
  password: process.env.PLATFORM_E2E_PASSWORD2 ?? "dev2",
};
