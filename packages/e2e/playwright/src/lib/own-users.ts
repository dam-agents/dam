import { type E2eUser, ownUsers, testUser } from "../config.js";

export type OwnUserSpec = keyof typeof ownUsers;

export interface SpecUser {
  user: E2eUser;
  storageState: string;
  own: boolean;
}

const sharedStorageState = "./.auth/user.json";

// UNIT_BOUNDARY_DESCRIPTION: the e2e user that a spec which must not share the dev user's machines runs as. The backend spec deletes its owner's VM runner, and every machine of that owner reboots with it. The runtime migration spec turns its owner's vm-sandboxes experiment off and on, which changes the Backend of any agent the UI creates for that owner meanwhile. On the dev user, the Playwright config must run both after the rest of the suite. With E2E_OWN_USERS=1 each runs as a Keycloak user of its own (keycloak.extraTestUsers in helm/values-e2e.yaml), with its own login, storage state and VM runner, so both run beside the rest of the suite. It depends on the config module alone, so the Playwright config can import it.
export function specUser(spec: OwnUserSpec): SpecUser {
  if (process.env.E2E_OWN_USERS !== "1")
    return { user: testUser, storageState: sharedStorageState, own: false };
  const user = ownUsers[spec];
  return { user, storageState: `./.auth/${user.username}.json`, own: true };
}
