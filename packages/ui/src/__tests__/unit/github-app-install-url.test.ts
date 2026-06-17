import { describe, expect, test } from "vitest";

import { githubAppInstallUrl } from "../../modules/connections/lib/github-app-install-url.js";

describe("githubAppInstallUrl", () => {
  test("github.com uses the /apps/ segment", () => {
    expect(
      githubAppInstallUrl({ templateId: "github", appSlug: "my-app" }),
    ).toBe("https://github.com/apps/my-app/installations/new");
  });

  test("ignores host on a github.com connection", () => {
    expect(
      githubAppInstallUrl({
        templateId: "github",
        host: "ghe.acme.com",
        appSlug: "my-app",
      }),
    ).toBe("https://github.com/apps/my-app/installations/new");
  });

  test("GitHub Enterprise Server uses the /github-apps/ segment on its host", () => {
    expect(
      githubAppInstallUrl({
        templateId: "github-enterprise",
        host: "ghe.acme.com",
        appSlug: "my-app",
      }),
    ).toBe("https://ghe.acme.com/github-apps/my-app/installations/new");
  });

  test("returns null without an app slug", () => {
    expect(githubAppInstallUrl({ templateId: "github" })).toBeNull();
    expect(
      githubAppInstallUrl({
        templateId: "github-enterprise",
        host: "ghe.acme.com",
      }),
    ).toBeNull();
  });

  test("returns null for an enterprise connection missing its host", () => {
    expect(
      githubAppInstallUrl({
        templateId: "github-enterprise",
        appSlug: "my-app",
      }),
    ).toBeNull();
  });
});
