/** Replaces `oidc-client-ts` in Storybook: always signed in, never redirects. */

export const storybookUser = {
  access_token: "storybook-token",
  expired: false,
  profile: {
    sub: "a3f1c2d4-5e6b-4c7d-8e9f-0a1b2c3d4e5f",
    preferred_username: "jamie",
    name: "Jamie",
    email: "jamie@example.com",
  },
};

export type User = typeof storybookUser;

export class WebStorageStateStore {}

export class UserManager {
  async getUser() {
    return storybookUser;
  }
  async signinSilent() {
    return storybookUser;
  }
  async signinRedirectCallback() {
    return storybookUser;
  }
  async signinRedirect() {}
  async signoutRedirect() {}
}
