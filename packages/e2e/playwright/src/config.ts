export const baseUrl = process.env.PLATFORM_BASE_URL ?? "http://localhost:4444";

export const keycloakUrl =
  process.env.PLATFORM_KEYCLOAK_URL ?? "http://keycloak.localhost:4444";

export const keycloakRealm = process.env.PLATFORM_KEYCLOAK_REALM ?? "platform";

export const keycloakClientId =
  process.env.PLATFORM_KEYCLOAK_CLIENT_ID ?? "platform-ui";

export const keycloakCliClientId =
  process.env.PLATFORM_KEYCLOAK_CLI_CLIENT_ID ?? "platform-cli";

export const testUser = {
  username: process.env.PLATFORM_E2E_USERNAME ?? "dev",
  password: process.env.PLATFORM_E2E_PASSWORD ?? "dev",
};

/* UNIT_BOUNDARY_DESCRIPTION: the name the install gives its assistant, which the chart's brand default sets and no e2e overlay changes; a spec reads it here rather than spelling it out. */
export const assistantName = process.env.PLATFORM_E2E_ASSISTANT_NAME ?? "Dammy";

/* UNIT_BOUNDARY_DESCRIPTION: the accounts 16-assistant.spec.ts signs in as, which no other spec uses: the install's assistant is on by default, so a spec that needs it to be on must not share an account whose switch another lane stored. */
export const assistantFirstUser = {
  username: process.env.PLATFORM_E2E_ASSISTANT_FIRST_USERNAME ?? "dammy-first",
  password: process.env.PLATFORM_E2E_ASSISTANT_PASSWORD ?? "dammy-e2e",
};

export const assistantOwnerUser = {
  username: process.env.PLATFORM_E2E_ASSISTANT_OWNER_USERNAME ?? "dammy-owner",
  password: process.env.PLATFORM_E2E_ASSISTANT_PASSWORD ?? "dammy-e2e",
};
