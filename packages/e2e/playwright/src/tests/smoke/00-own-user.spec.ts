import { test } from "@playwright/test";

import { createApiClient } from "../../lib/api-client.js";
import { getAccessToken, loginViaUi } from "../../lib/auth.js";
import {
  laneBackend,
  requireBackend,
  setVmSandboxes,
} from "../../lib/backend.js";
import { type OwnUserSpec, specUser } from "../../lib/own-users.js";

// TEST_OVERVIEW: the setup of a spec's own e2e user. The Playwright config runs it only with E2E_OWN_USERS=1, once per own user, before the spec that runs as that user; the project's metadata names that spec. It does for the user what the auth project does for the dev user: log in through Keycloak, accept the terms, save the storage state the spec's pages load, and put the user on the lane's Backend.

// TEST_SCENARIO: the user must end logged in with the terms accepted, and its vm-sandboxes experiment must match the lane, as the dev user's does after the auth project. The vm lane fails here, once, on an install without the vm backend.
test("a spec's own user logs in and matches the lane's Backend", async ({
  page,
}) => {
  const spec = test.info().project.metadata.ownUserOf as OwnUserSpec;
  const { user, storageState } = specUser(spec);
  await loginViaUi(page, user);
  await page.context().storageState({ path: storageState });
  const api = createApiClient(await getAccessToken(user));
  await requireBackend(api, laneBackend);
  await setVmSandboxes(api, laneBackend === "vm");
});
