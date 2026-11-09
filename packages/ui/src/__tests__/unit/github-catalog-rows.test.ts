// @vitest-environment happy-dom
// TEST_OVERVIEW: the connection catalog's GitHub section reads at a glance. A provider card lists its connections as flat rows, a sign-in followed by the connections made from it, with no card nested in a card. In each row the icon has a column of its own, the name and its badges sit in one block and the actions in another that wraps below it when the row is narrow, so a button never covers a badge or the name and nothing is hidden. Under a GitHub sign-in the row lists the accounts its app is installed on — avatars and a count that opens the list, a badge only on a suspended one — or says in one line, with the install link, that the app is installed nowhere yet; the create form says the same two steps in the same words.
import type {
  ConnectionTemplateView,
  ConnectionView,
  GitHubAppInstallations,
} from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  installations: {
    isPending: false,
    isError: false,
    error: null,
    data: undefined,
  } as {
    isPending: boolean;
    isError: boolean;
    error: Error | null;
    data: GitHubAppInstallations | undefined;
  },
  asked: [] as { connectionId: string; enabled: boolean }[],
}));

vi.mock("../../brand.js", () => ({ getBrand: () => ({ name: "Acme" }) }));
vi.mock("../../modules/connections/api/queries.js", () => ({
  useGitHubAppInstallations: (connectionId: string, enabled: boolean) => {
    fake.asked.push({ connectionId, enabled });
    return fake.installations;
  },
}));

const { CatalogProviderCard } =
  await import("../../modules/connections/components/catalog-provider-card.js");
const { GithubStepsCallout } =
  await import("../../modules/connections/forms/github-steps-callout.js");

const SIGN_IN: ConnectionView = {
  id: "conn-sign-in",
  ownerId: "me",
  name: "github",
  templateId: "github",
  category: "app",
  status: "active",
  authKind: "oauth",
  contributions: [],
  hosts: ["api.github.com"],
  accountLabel: "octocat",
  appSlug: "acme-dam",
  isParent: true,
};

const CHILD: ConnectionView = {
  ...SIGN_IN,
  id: "conn-child",
  name: "github-app-installation-with-a-long-name",
  isParent: undefined,
  parentId: SIGN_IN.id,
  status: "expired",
  fullAccess: true,
};

const TEMPLATE = {
  id: "github",
  name: "GitHub",
  iconSlug: "github",
  authKind: "oauth",
} as unknown as ConnectionTemplateView;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.asked = [];
  fake.installations = {
    isPending: false,
    isError: false,
    error: null,
    data: { accounts: [] },
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

const byTestId = (id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function render(connections: ConnectionView[]) {
  act(() =>
    root.render(
      createElement(CatalogProviderCard, {
        group: {
          provider: { id: "github", title: "GitHub", iconSlug: "github" },
          templates: [TEMPLATE],
          connections,
        } as never,
        templateById: new Map([[TEMPLATE.id, TEMPLATE]]),
        sandbox: {
          grantedIds: new Set<string>(),
          onToggleGrant: () => {},
          onRevoke: () => {},
        },
        onNew: () => {},
        onDelete: () => {},
        deletingId: null,
        maintenance: () => ({
          onReauthenticate: () => {},
          onEditScope: () => {},
        }),
        onNewChild: () => {},
      }),
    ),
  );
}

const RENDER_TIMEOUT = { timeout: 30_000 };

describe("a GitHub connection row", RENDER_TIMEOUT, () => {
  // TEST_SCENARIO: a connection made from a sign-in shows Full access, Expired, Narrow access, Re-authenticate sign-in and Add to agent at once — the row that overlapped. The badges stay in the name's block and every button in the actions block, which may wrap onto its own line, so the two never share space.
  it("keeps the badges with the name and the buttons in their own block", () => {
    render([SIGN_IN, CHILD]);
    const row = byTestId(`catalog-connection-${CHILD.id}`)!;
    const [line] = row.lastElementChild!.children;
    const [nameBlock, actionsBlock] = line!.children;

    expect(line!.className).toContain("flex-wrap");
    expect(nameBlock!.textContent).toContain(CHILD.name);
    expect(nameBlock!.textContent).toContain("Full access");
    expect(nameBlock!.textContent).toContain("Expired");
    expect(nameBlock!.querySelector("button")).toBeNull();
    for (const id of [
      `catalog-narrow-${CHILD.id}`,
      `catalog-fix-${CHILD.id}`,
      `catalog-add-${CHILD.id}`,
      `catalog-menu-${CHILD.id}`,
    ])
      expect(actionsBlock!.contains(byTestId(id))).toBe(true);
    expect(byTestId(`catalog-fix-${CHILD.id}`)!.textContent).toBe(
      "Re-authenticate sign-in",
    );
  });

  // TEST_SCENARIO: the icon sits in a column of its own, so badges that wrap start under the name, in line with the detail line below it.
  it("keeps the icon out of the column the name, badges and detail wrap in", () => {
    render([SIGN_IN, CHILD]);
    const row = byTestId(`catalog-connection-${CHILD.id}`)!;
    const column = row.lastElementChild!;

    expect(row.children).toHaveLength(2);
    expect(row.firstElementChild!.textContent).toBe("");
    expect(column.firstElementChild!.textContent).toContain(CHILD.name);
    expect(
      column.contains(byTestId(`catalog-connection-account-${CHILD.id}`)),
    ).toBe(true);
  });

  // TEST_SCENARIO: Narrow access and the expired connection's fix stay on the row at every width; a narrow row wraps them, it does not move them into the menu.
  it("hides no button when the row is narrow", () => {
    render([SIGN_IN, CHILD]);

    for (const id of [`catalog-narrow-${CHILD.id}`, `catalog-fix-${CHILD.id}`])
      expect(byTestId(id)!.className.split(" ")).not.toContainEqual(
        expect.stringMatching(/(^|:)hidden$/),
      );
  });

  // TEST_SCENARIO: the Full access badge names the access; the detail line under it says only what that reaches.
  it("says Full access once", () => {
    render([SIGN_IN, CHILD]);
    const row = byTestId(`catalog-connection-${CHILD.id}`)!;

    expect(row.textContent!.match(/Full access/g)).toHaveLength(1);
  });

  it("lists the sign-in and its connections as flat rows, not cards in a card", () => {
    render([SIGN_IN, CHILD]);
    const card = byTestId("catalog-provider-github")!;
    const parent = byTestId(`connection-parent-${SIGN_IN.id}`)!;

    expect(parent.className).not.toContain("border");
    expect(card.querySelectorAll(".rounded-lg")).toHaveLength(0);
    expect(
      byTestId(`connection-children-${SIGN_IN.id}`)!.textContent,
    ).toContain(CHILD.name);
  });
});

describe("where a sign-in's app is installed", RENDER_TIMEOUT, () => {
  it("shows the organizations' avatars and count, and lists them on a click", () => {
    fake.installations.data = {
      accounts: [
        {
          login: "acme",
          targetId: 1,
          kind: "organization",
          repositorySelection: "all",
          avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        },
        {
          login: "beta",
          targetId: 2,
          kind: "organization",
          repositorySelection: "selected",
          suspended: true,
        },
      ],
    };
    render([SIGN_IN, CHILD]);
    const line = byTestId(`github-installations-${SIGN_IN.id}`)!;

    expect(line.textContent).toContain("Installed on 2 accounts");
    expect(line.querySelector("img")!.getAttribute("src")).toBe(
      "https://avatars.githubusercontent.com/u/1?v=4&s=40",
    );
    expect(
      byTestId(`github-installations-${SIGN_IN.id}-account-acme`),
    ).toBeNull();

    act(() => byTestId(`github-installations-${SIGN_IN.id}-toggle`)!.click());

    expect(
      byTestId(`github-installations-${SIGN_IN.id}-account-acme`)!.textContent,
    ).toBe("acmeAll repositories");
    expect(
      byTestId(`github-installations-${SIGN_IN.id}-account-beta`)!.textContent,
    ).toBe("betaSelected repositoriesSuspended");
  });

  // TEST_SCENARIO: the avatars stop at five and a +N chip counts the rest, so they add up to the count beside them.
  it("counts the accounts past the fifth avatar", () => {
    fake.installations.data = {
      accounts: Array.from({ length: 7 }, (_, i) => ({
        login: `org-${i}`,
        targetId: i,
        kind: "organization" as const,
        repositorySelection: "all" as const,
      })),
    };
    render([SIGN_IN]);
    const toggle = byTestId(`github-installations-${SIGN_IN.id}-toggle`)!;

    expect(toggle.querySelectorAll("[title^='org-']")).toHaveLength(5);
    expect(toggle.textContent).toBe("+2Installed on 7 accounts");
  });

  // TEST_SCENARIO: a sign-in whose app is on no account yet says so in one line under its row, with the install link inside the sentence, where the two-step box and a filled Install button used to be.
  it("says in one line that the app is installed nowhere yet", () => {
    render([SIGN_IN, CHILD]);
    const line = byTestId(`github-installations-${SIGN_IN.id}`)!;

    expect(line.textContent).toBe(
      "Installed on no account yet. Install the app on each account whose repositories agents need.",
    );
    expect(
      byTestId(`github-installations-${SIGN_IN.id}-install`)!.getAttribute(
        "href",
      ),
    ).toBe("https://github.com/apps/acme-dam/installations/new");
    expect(host.textContent).not.toContain("2 steps required");
    expect(host.querySelector(".bg-primary")).toBeNull();
  });

  // TEST_SCENARIO: the create form names the two steps with the same words as the row, not as a box of its own.
  it("words the create form's hint like the row", () => {
    act(() =>
      root.render(createElement(GithubStepsCallout, { templateId: "github" })),
    );

    expect(host.textContent).toBe(
      "Sign in with GitHub, then install the Acme app on each account whose repositories agents need.",
    );
  });

  it("says when the check failed rather than hiding the line", () => {
    fake.installations = {
      isPending: false,
      isError: true,
      error: new Error("401"),
      data: undefined,
    };
    render([SIGN_IN, CHILD]);

    expect(byTestId(`github-installations-${SIGN_IN.id}`)!.textContent).toBe(
      "Couldn't check where the app is installed. Install the app",
    );
  });

  // TEST_SCENARIO: only an active sign-in made through an app the platform knows lists installations; a connection made from it, a sign-in still authorizing, and an installation (its account is already on the row) ask GitHub nothing.
  it("asks only for an active sign-in", () => {
    render([
      SIGN_IN,
      CHILD,
      { ...SIGN_IN, id: "pending", status: "pending" },
      {
        ...SIGN_IN,
        id: "app",
        templateId: "github-app",
        authKind: "github-app",
      },
    ]);

    expect(
      fake.asked.filter((a) => a.enabled).map((a) => a.connectionId),
    ).toEqual([SIGN_IN.id]);
    expect(byTestId(`github-installations-${CHILD.id}`)).toBeNull();
    expect(byTestId("github-installations-pending")).toBeNull();
  });
});
