import { keycloakUrl, testUser } from "./config.js";
import { createApiClient } from "./lib/api-client.js";
import { acceptTerms, getAccessToken } from "./lib/auth.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the state every other spec's account holds before
 * the suite runs, so no lane depends on the assistant being on. The install
 * keeps the chart's `experimental` mode and the assistant is on by default, so
 * the shared account stores the switch off for itself — what a person who does
 * not want one does — and 16-assistant.spec.ts signs in as its own accounts,
 * which store nothing and so keep the default.
 *
 * Keycloak's realm import is the install's own step; a rerun against a warm
 * cluster finds the accounts already there and only re-stores the switch.
 */
export default async function globalSetup(): Promise<void> {
  await assertKeycloakUp();
  const api = createApiClient(await getAccessToken(testUser));
  await acceptTerms(api);
  await api.features.setFlag.mutate({
    feature: "dambledore",
    enabled: false,
  });
}

async function assertKeycloakUp(): Promise<void> {
  const res = await fetch(
    `${keycloakUrl}/realms/platform/.well-known/openid-configuration`,
    {
      signal: AbortSignal.timeout(30_000),
    },
  ).catch((err: unknown) => {
    throw new Error(
      `Keycloak is not answering at ${keycloakUrl}: ${String(err)}`,
    );
  });
  if (!res.ok)
    throw new Error(
      `Keycloak is not answering at ${keycloakUrl}: ${String(res.status)}`,
    );
}
