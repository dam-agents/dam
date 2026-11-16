// TEST_OVERVIEW: the words on a GitHub sign-in's or App installation's card. A connection made from one reads by what it reaches — the account and repositories, or that it reaches everything — with its permission count and its own name below; any other connection keeps its own name. A card's title is the GitHub login of a sign-in, or the app of an installation, and two sign-ins of one login also name their app, or their own name when the app is the same too. A broken sign-in or installation names what is wrong, its one fix, and what its connections wait for; a connection GitHub refused on its own is fixed by choosing its access again.
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../brand.js", () => ({ getBrand: () => ({ name: "Acme" }) }));

const {
  childCardLabel,
  childRepair,
  parentCardLead,
  parentCardTitles,
  parentRepair,
  signInAppLabel,
} = await import("../../modules/connections/lib/github-card.js");

const connection = (
  id: string,
  fields: Partial<ConnectionView> = {},
): ConnectionView =>
  ({
    id,
    name: id,
    templateId: "github",
    authKind: "oauth",
    status: "active",
    ...fields,
  }) as ConnectionView;

const GITHUB_TEMPLATE = {
  id: "github",
  inputs: [{ name: "appSlug", state: "overridable", presetValue: "acme-dam" }],
} as unknown as ConnectionTemplateView;
const templates = new Map([[GITHUB_TEMPLATE.id, GITHUB_TEMPLATE]]);

describe("a connection made from a sign-in or installation", () => {
  // TEST_SCENARIO: the design's first row: one account, one repository, seven permissions, and the connection's name last, since the name is what an agent's configuration and its tools use.
  it("reads by the account and repositories it reaches", () => {
    const label = childCardLabel(
      connection("github", {
        parentId: "gh",
        githubUserToken: {
          scope: {
            targetId: 1,
            targetLogin: "octocat",
            repositoryIds: [1],
            repositoryNames: ["cuga-agent"],
            permissions: Object.fromEntries(
              ["a", "b", "c", "d", "e", "f", "g"].map((p) => [p, "read"]),
            ),
          },
        },
      }),
    );

    expect(label).toEqual({
      title: "octocat / cuga-agent",
      subtitle: "7 permissions · named github",
    });
  });

  // TEST_SCENARIO: more than three repositories are cut to three and a count, so the title stays on one line.
  it("cuts a long repository list", () => {
    const label = childCardLabel(
      connection("github-dam", {
        parentId: "gh",
        githubUserToken: {
          scope: {
            targetId: 2,
            targetLogin: "dam-agents",
            repositoryIds: [1, 2, 3, 4, 5],
            repositoryNames: ["link-guardian", "dam", "skills", "x", "y"],
            permissions: { contents: "write" },
          },
        },
      }),
    );

    expect(label?.title).toBe(
      "dam-agents / link-guardian, dam, skills and 2 more",
    );
    expect(label?.subtitle).toBe("1 permission · named github-dam");
  });

  // TEST_SCENARIO: full access says in words what it reaches, the installation's or the sign-in's way, and the subtitle says it holds everything of the other kind too.
  it.each([
    [
      "github-app",
      "The whole installation",
      "All permissions · named github-app-installation",
    ],
    [
      "oauth",
      "Everything the app can reach, on every account",
      "All accounts · named github-app-installation",
    ],
  ] as const)(
    "says what full access reaches (%s)",
    (authKind, title, subtitle) => {
      expect(
        childCardLabel(
          connection("github-app-installation", {
            parentId: "p",
            authKind,
            fullAccess: true,
          }),
        ),
      ).toEqual({ title, subtitle });
    },
  );

  // TEST_SCENARIO: a connection made from an installation names the account it is installed on, when the check read it.
  it("names the installation's account", () => {
    expect(
      childCardLabel(
        connection("narrow", {
          parentId: "p",
          authKind: "github-app",
          githubAppScope: { repositories: ["dam"], permissions: {} },
          check: { status: "passed", installedOn: "dam-agents", at: "" },
        }),
      ),
    ).toEqual({
      title: "dam-agents / dam",
      subtitle: "All permissions · named narrow",
    });
  });

  // TEST_SCENARIO: a token, or any connection not made from a sign-in or installation, keeps the row it had.
  it("leaves every other connection as it was", () => {
    expect(
      childCardLabel(connection("pat", { authKind: "header" })),
    ).toBeNull();
  });
});

describe("a sign-in's or installation's card", () => {
  it("titles a sign-in by its login, and one not finished as a GitHub sign-in", () => {
    const titles = parentCardTitles(
      [
        connection("a", { accountLabel: "octocat", isParent: true }),
        connection("b", { status: "pending", isParent: true }),
      ],
      templates,
    );

    expect(titles.get("a")).toBe("octocat");
    expect(titles.get("b")).toBe("GitHub sign-in");
  });

  // TEST_SCENARIO: two sign-ins of one login would read the same; each then names its app, and when the app is the same too, its own name.
  it("tells two sign-ins of one login apart", () => {
    const own = connection("own", {
      accountLabel: "octocat",
      appSlug: "my-app",
      isParent: true,
    });
    const preset = connection("preset", {
      accountLabel: "octocat",
      appSlug: "acme-dam",
      isParent: true,
    });
    const again = connection("again", {
      accountLabel: "octocat",
      appSlug: "acme-dam",
      isParent: true,
    });

    expect([...parentCardTitles([own, preset], templates).values()]).toEqual([
      "octocat · my-app app",
      "octocat · Acme app",
    ]);
    expect([...parentCardTitles([preset, again], templates).values()]).toEqual([
      "octocat · preset",
      "octocat · again",
    ]);
  });

  // TEST_SCENARIO: an installation has no login; its title is its app, read from the bot account the check found, and its header carries its own name.
  it("titles an installation by its app and names it on the header", () => {
    const installation = connection("github-app-installation", {
      templateId: "github-app",
      authKind: "github-app",
      isParent: true,
      check: { status: "passed", account: "my-bot-app[bot]", at: "" },
    });

    expect(
      parentCardTitles([installation], templates).get(installation.id),
    ).toBe("my-bot-app");
    expect(parentCardLead(installation)).toBe(
      "Your own app · named github-app-installation",
    );
    expect(
      parentCardTitles([{ ...installation, check: undefined }], templates).get(
        installation.id,
      ),
    ).toBe("Your GitHub App");
  });

  it("says how a sign-in was made, and never its name", () => {
    expect(parentCardLead(connection("github"))).toBe("Signed in with GitHub");
    expect(
      parentCardLead(connection("ghe", { templateId: "github-enterprise" })),
    ).toBe("Signed in with GitHub Enterprise");
  });

  it("calls the platform's own app by the brand", () => {
    expect(signInAppLabel({ appSlug: "acme-dam" }, GITHUB_TEMPLATE)).toBe(
      "Acme app",
    );
    expect(signInAppLabel({ appSlug: "mine" }, GITHUB_TEMPLATE)).toBe(
      "mine app",
    );
    expect(signInAppLabel({}, GITHUB_TEMPLATE)).toBeUndefined();
  });
});

describe("a broken card", () => {
  const run = () => {};

  // TEST_SCENARIO: each broken state has one badge, one fix in place of New connection, and the words its paused connections show.
  it.each([
    [
      "an expired sign-in",
      connection("s", { status: "expired" }),
      { onReauthenticate: run },
      "Expired",
      "Sign in again",
      "Paused until you sign in again",
    ],
    [
      "a sign-in not finished",
      connection("s", { status: "pending" }),
      { onReauthenticate: run },
      "Not finished",
      "Sign in",
      "Paused until you sign in",
    ],
    [
      "an installation whose key no longer works",
      connection("i", { status: "expired", authKind: "github-app" }),
      { onUpdateCredential: run },
      "Expired",
      "Add a new key",
      "Paused until you add a new key",
    ],
    [
      "a sign-in on a retired host",
      connection("e", {
        status: "disconnected",
        retiredHost: "ghe.example.com",
      }),
      { onMoveHost: run },
      "Host retired",
      "Move to another host",
      "Paused until you move it to another host",
    ],
  ] as const)(
    "names %s and its fix",
    (_, parent, actions, badge, fix, paused) => {
      expect(parentRepair(parent, actions)).toEqual({
        badge,
        fix: { label: fix, run },
        paused,
      });
    },
  );

  it("is no repair while active", () => {
    expect(parentRepair(connection("s"), { onReauthenticate: run })).toBeNull();
  });

  // TEST_SCENARIO: a connection GitHub refused while its sign-in still works is fixed on its own row, by choosing its access again.
  it("offers a refused connection to choose its access again", () => {
    expect(
      childRepair(connection("c", { status: "expired" }), {
        onEditScope: run,
        onReauthenticate: () => {},
      }),
    ).toEqual({ label: "Choose access again", run });
    expect(childRepair(connection("c"), { onEditScope: run })).toBeNull();
  });
});
