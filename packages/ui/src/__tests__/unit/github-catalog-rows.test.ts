// @vitest-environment happy-dom
// TEST_OVERVIEW: the connection catalog's GitHub section reads at a glance. A provider card lists its connections as flat rows, a sign-in followed by the connections made from it, with no card nested in a card. In each row the icon has a column of its own, the name and its badges sit in one block and the actions in another that wraps below it when the row is narrow, so a button never covers a badge or the name and nothing is hidden. Every row keeps its ⋮ menu at the top right, on the name's line. Under a GitHub sign-in the row lists the accounts its app is installed on — avatars and a count that opens the list, the summary counting a suspended one and the list flagging it — or says in one line, with the install link, that the app is installed nowhere yet; the create form says the same two steps in the same words.
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
    isFetching?: boolean;
    error: Error | null;
    data: GitHubAppInstallations | undefined;
    refetch?: () => Promise<unknown>;
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

const byTestId = (id: string, within: ParentNode = host) =>
  within.querySelector<HTMLElement>(`[data-testid="${id}"]`);

function openMenu(id: string) {
  act(() => {
    byTestId(`catalog-menu-${id}`)!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
  });
}

function render(
  connections: ConnectionView[],
  maintenance: () => {
    onReauthenticate: () => void;
    onEditScope: () => void;
  } = () => ({ onReauthenticate: () => {}, onEditScope: () => {} }),
) {
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
        maintenance,
        onNewChild: () => {},
      }),
    ),
  );
}

const RENDER_TIMEOUT = { timeout: 30_000 };

describe("a GitHub connection row", RENDER_TIMEOUT, () => {
  // TEST_SCENARIO: a connection made from a sign-in shows Full access, Expired, Narrow access, Re-authenticate sign-in and Add to agent at once — the row that overlapped. The badges stay in the name's block and every button in the actions block, which may wrap onto its own line, so the two never share space; both blocks sit on the name's line, not in the middle of a taller row.
  it("keeps the badges with the name and the buttons in their own block", () => {
    render([SIGN_IN, CHILD]);
    const row = byTestId(`catalog-connection-${CHILD.id}`)!;
    const [line] = row.children[1]!.children;
    const [nameBlock, actionsBlock] = line!.children;

    expect(line!.className).toContain("flex-wrap");
    expect(line!.className).toContain("items-start");
    expect(nameBlock!.textContent).toContain(CHILD.name);
    expect(nameBlock!.textContent).toContain("Full access");
    expect(nameBlock!.textContent).toContain("Expired");
    expect(nameBlock!.querySelector("button")).toBeNull();
    for (const id of [
      `catalog-narrow-${CHILD.id}`,
      `catalog-fix-${CHILD.id}`,
      `catalog-add-${CHILD.id}`,
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
    const column = row.children[1]!;

    expect(row.children).toHaveLength(3);
    expect(row.firstElementChild!.textContent).toBe("");
    expect(column.firstElementChild!.textContent).toContain(CHILD.name);
    expect(
      column.contains(byTestId(`catalog-connection-account-${CHILD.id}`)),
    ).toBe(true);
  });

  // TEST_SCENARIO: the expired connection's fix stays on the row at every width. Narrow access leaves a narrow row, so the row keeps two controls rather than stacking three; the menu's Edit repositories & permissions opens the same dialog there.
  it("keeps the fix on a narrow row, and leaves Narrow access to the menu there", () => {
    let narrowed = 0;
    render([SIGN_IN, CHILD], () => ({
      onReauthenticate: () => {},
      onEditScope: () => narrowed++,
    }));
    const classes = (id: string) => byTestId(id)!.className.split(" ");

    expect(classes(`catalog-fix-${CHILD.id}`)).not.toContainEqual(
      expect.stringMatching(/(^|:)hidden$/),
    );
    expect(classes(`catalog-narrow-${CHILD.id}`)).toContain("@max-md:hidden");
    expect(classes(`catalog-narrow-${CHILD.id}`)).not.toContain("hidden");

    openMenu(CHILD.id);
    act(() => byTestId(`catalog-edit-scope-${CHILD.id}`, document)!.click());

    expect(narrowed).toBe(1);
  });

  // TEST_SCENARIO: the Full access badge names the access; the detail line under it says only what that reaches.
  it("says Full access once", () => {
    render([SIGN_IN, CHILD]);
    const row = byTestId(`catalog-connection-${CHILD.id}`)!;

    expect(row.textContent!.match(/Full access/g)).toHaveLength(1);
  });

  // TEST_SCENARIO: a connection with full access and any status shows one badge that says both — expired, authorizing or disconnected alike — so the same state looks the same on every row.
  it.each([
    ["expired", "Expired"],
    ["pending", "Authorizing…"],
    ["disconnected", "Disconnected"],
  ] as const)("merges Full access and %s into one badge", (status, label) => {
    render([SIGN_IN, { ...CHILD, status }]);
    const [, column] = byTestId(`catalog-connection-${CHILD.id}`)!.children;
    const nameBlock = column!.firstElementChild!.firstElementChild!;

    expect(byTestId(`connection-full-access-${CHILD.id}`)!.textContent).toBe(
      `Full access · ${label}`,
    );
    expect(nameBlock.querySelectorAll(".rounded-full")).toHaveLength(2);
  });

  // TEST_SCENARIO: the ⋮ menu sits in the same place on every row, the sign-in's and its connections': last in the row, in a column of its own at the top right, on the name's line.
  it("puts the menu at the top right of every row", () => {
    render([SIGN_IN, CHILD]);

    for (const id of [SIGN_IN.id, CHILD.id]) {
      const row = byTestId(`catalog-connection-${id}`)!;
      const menuColumn = row.lastElementChild!;
      expect(row.className).toContain("items-start");
      expect(menuColumn.firstElementChild).toBe(byTestId(`catalog-menu-${id}`));
      expect(menuColumn.className).toContain("h-8");
    }
  });

  // TEST_SCENARIO: the detail line wraps instead of cutting its sentence, so a narrow row still says what Full access reaches.
  it("wraps the detail line rather than cutting it", () => {
    render([SIGN_IN, CHILD]);
    const detail = byTestId(`catalog-connection-account-${CHILD.id}`)!;

    expect(detail.className).not.toContain("truncate");
    expect(detail.className).toContain("break-words");
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

  // TEST_SCENARIO: a light rule above the connections made from a sign-in ends the sign-in's own block, its account list included, so the list does not run into them.
  it("separates the sign-in's block from its connections", () => {
    render([SIGN_IN, CHILD]);

    expect(byTestId(`connection-children-${SIGN_IN.id}`)!.className).toContain(
      "border-t",
    );
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

  // TEST_SCENARIO: a suspended installation is the one that makes an agent fail, so the closed summary already counts it, in warning text; with none suspended the summary says only the count.
  it("counts the suspended accounts in the closed summary", () => {
    fake.installations.data = {
      accounts: [
        {
          login: "acme",
          targetId: 1,
          kind: "organization",
          repositorySelection: "all",
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
    render([SIGN_IN]);
    const toggle = byTestId(`github-installations-${SIGN_IN.id}-toggle`)!;
    const suspended = byTestId(`github-installations-${SIGN_IN.id}-suspended`)!;

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("Installed on 2 accounts · 1 suspended");
    expect(suspended.className).toContain("text-warning-fg");

    fake.installations.data = {
      accounts: [fake.installations.data.accounts[0]!],
    };
    render([SIGN_IN]);

    expect(
      byTestId(`github-installations-${SIGN_IN.id}-toggle`)!.textContent,
    ).toBe("Installed on 1 account");
    expect(byTestId(`github-installations-${SIGN_IN.id}-suspended`)).toBeNull();
  });

  // TEST_SCENARIO: the link to install on another account is not a second control on the toggle's line; it ends the opened list.
  it("offers another account's install at the end of the opened list", () => {
    fake.installations.data = {
      accounts: [
        {
          login: "acme",
          targetId: 1,
          kind: "organization",
          repositorySelection: "all",
        },
      ],
    };
    render([SIGN_IN]);
    const install = `github-installations-${SIGN_IN.id}-install`;

    expect(byTestId(install)).toBeNull();

    act(() => byTestId(`github-installations-${SIGN_IN.id}-toggle`)!.click());
    const list = byTestId(`github-installations-${SIGN_IN.id}`)!.querySelector(
      "ul",
    )!;

    expect(list.lastElementChild!.contains(byTestId(install))).toBe(true);
    expect(byTestId(install)!.textContent).toBe("Install on another account");
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

  // TEST_SCENARIO: a list GitHub could not answer says so in warning colour, and offers Try again first — it reads the list again — with the install link after it, since installing does not fix a failed read.
  it("offers Try again first when the check failed", () => {
    const refetch = vi.fn(() => Promise.resolve());
    fake.installations = {
      isPending: false,
      isError: true,
      isFetching: false,
      error: new Error("401"),
      data: undefined,
      refetch,
    };
    render([SIGN_IN, CHILD]);
    const line = byTestId(`github-installations-${SIGN_IN.id}`)!;
    const retry = byTestId(`github-installations-${SIGN_IN.id}-retry`)!;

    expect(line.textContent).toBe(
      "Couldn't check where the app is installed. Try again or install the app",
    );
    expect(line.querySelector(".text-warning")).not.toBeNull();
    expect(
      retry.compareDocumentPosition(
        byTestId(`github-installations-${SIGN_IN.id}-install`)!,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => retry.click());

    expect(refetch).toHaveBeenCalledOnce();
  });

  // TEST_SCENARIO: the warning colour belongs to the failed read; the empty state is no error and shows none.
  it("keeps the warning colour off the empty state", () => {
    render([SIGN_IN]);

    expect(
      byTestId(`github-installations-${SIGN_IN.id}`)!.querySelector(
        ".text-warning",
      ),
    ).toBeNull();
  });

  // TEST_SCENARIO: the loading line keeps the height of the avatar row that replaces it, so the row does not jump.
  it("reserves the avatar row's height while loading", () => {
    fake.installations = {
      isPending: true,
      isError: false,
      error: null,
      data: undefined,
    };
    render([SIGN_IN]);

    expect(byTestId(`github-installations-${SIGN_IN.id}`)!.className).toContain(
      "min-h-5",
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
