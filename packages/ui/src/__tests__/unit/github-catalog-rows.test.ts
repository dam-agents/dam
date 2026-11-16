// @vitest-environment happy-dom
// TEST_OVERVIEW: a provider's GitHub connections read at a glance, in an agent's connection catalog and on the Connections page. The provider's name and New sit on one line above its cards. Each GitHub sign-in or App installation is a card: a header with the account or app, how it was made, New connection and its ⋮ menu, and below it the connections made from it, each read by what it reaches. A token is a card of one row and no header. In the catalog a row offers Add to agent; on the Connections page it says which agents use it instead. A broken sign-in shows its badge and its one fix on the header, in place of New connection, and its connections turn grey and say what they wait for; a connection GitHub refused on its own offers Choose access again. In each row the name and its badges sit in one block and the actions in another that wraps below it when the row is narrow. The header lists the accounts the sign-in's app is installed on — a count that opens the list, the summary counting a suspended one and the list flagging it — or says, with the install link, that the app is installed nowhere yet; the create form says the same two steps in the same words.
import type {
  ConnectionTemplateView,
  ConnectionView,
  GitHubAppInstallations,
} from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConnectionHolder } from "../../modules/connections/hooks/use-connection-holders.js";

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
vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: { damConnection: true } }),
}));
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
  fullAccess: true,
};

const NARROW: ConnectionView = {
  ...SIGN_IN,
  id: "conn-narrow",
  name: "github-hello",
  isParent: undefined,
  parentId: SIGN_IN.id,
  githubUserToken: {
    scope: {
      targetId: 1,
      targetLogin: "octocat",
      repositoryIds: [1],
      repositoryNames: ["hello"],
      permissions: { contents: "read", issues: "write" },
    },
  },
};

const TOKEN: ConnectionView = {
  ...SIGN_IN,
  id: "conn-token",
  name: "github-pat",
  templateId: "github-pat",
  authKind: "header",
  isParent: undefined,
};

const TEMPLATE = {
  id: "github",
  name: "GitHub",
  iconSlug: "github",
  authKind: "oauth",
  inputs: [{ name: "appSlug", state: "overridable", presetValue: "acme-dam" }],
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

interface Maintenance {
  onReauthenticate?: () => void;
  onEditScope?: () => void;
}

function render(
  connections: ConnectionView[],
  {
    maintenance = () => ({ onReauthenticate: () => {}, onEditScope: () => {} }),
    holders,
    onNewChild = () => {},
  }: {
    maintenance?: (connection: ConnectionView) => Maintenance;
    holders?: Map<string, ConnectionHolder[]>;
    onNewChild?: (parent: ConnectionView) => void;
  } = {},
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
        ...(holders
          ? { holders }
          : {
              sandbox: {
                grantedIds: new Set<string>(),
                onToggleGrant: () => {},
                onRevoke: () => {},
              },
            }),
        onNew: () => {},
        onDelete: () => {},
        deletingId: null,
        maintenance,
        onNewChild,
      }),
    ),
  );
}

const RENDER_TIMEOUT = { timeout: 30_000 };

describe("a GitHub sign-in's card", RENDER_TIMEOUT, () => {
  // TEST_SCENARIO: the provider's name and New are one line above the cards, not a header inside one card, so each sign-in reads as its own card.
  it("puts the provider and New above separate cards", () => {
    render([SIGN_IN, NARROW, TOKEN]);
    const section = byTestId("catalog-provider-github")!;
    const [header, cards] = section.children;

    expect(header!.textContent).toBe("GitHubNew");
    expect(header!.contains(byTestId("catalog-new-github"))).toBe(true);
    expect(
      [...cards!.children].map((c) => c.getAttribute("data-testid")),
    ).toEqual([
      `connection-parent-${SIGN_IN.id}`,
      `connection-card-${TOKEN.id}`,
    ]);
  });

  // TEST_SCENARIO: the header names the GitHub login and how it was made, never the sign-in's own name or anything about agents, and carries New connection and the sign-in's menu.
  it("titles the card by the login and keeps agents off the header", () => {
    const made: ConnectionView[] = [];
    render([SIGN_IN, NARROW], { onNewChild: (p) => made.push(p) });

    expect(byTestId(`connection-parent-title-${SIGN_IN.id}`)!.textContent).toBe(
      "octocat",
    );
    expect(
      byTestId(`connection-parent-lead-${SIGN_IN.id}`)!.firstElementChild!
        .textContent,
    ).toBe("Signed in with GitHub");
    const header = byTestId(
      `connection-parent-${SIGN_IN.id}`,
    )!.firstElementChild!;
    expect(header.textContent).not.toContain("agent ");
    expect(header.contains(byTestId(`catalog-menu-${SIGN_IN.id}`))).toBe(true);

    act(() => byTestId(`connection-new-child-${SIGN_IN.id}`)!.click());

    expect(made).toEqual([SIGN_IN]);
  });

  // TEST_SCENARIO: a connection made from the sign-in reads by the account and repositories it reaches, with its permission count and its own name below, and no kind badge.
  it("reads a connection by what it reaches", () => {
    render([SIGN_IN, NARROW]);
    const row = byTestId(`catalog-connection-${NARROW.id}`)!;

    expect(byTestId(`catalog-connection-title-${NARROW.id}`)!.textContent).toBe(
      "octocat / hello",
    );
    expect(
      byTestId(`catalog-connection-account-${NARROW.id}`)!.textContent,
    ).toBe("2 permissions · named github-hello");
    expect(row.textContent).not.toContain("GitHub OAuth");
    expect(byTestId(`catalog-add-${NARROW.id}`)!.textContent).toBe(
      "Add to agent",
    );
  });

  // TEST_SCENARIO: a sign-in with no connection yet says in one grey row what to do; New connection on the header is the one button, so the row has none.
  it("says what an empty sign-in needs, with no second button", () => {
    render([SIGN_IN]);
    const empty = byTestId(`connection-parent-empty-${SIGN_IN.id}`)!;

    expect(empty.textContent).toBe(
      "No agent can use this sign-in yet. Make a connection from it and choose what it reaches.",
    );
    expect(empty.querySelector("button")).toBeNull();
    expect(byTestId(`connection-choose-reach-${SIGN_IN.id}`)).toBeNull();
  });

  // TEST_SCENARIO: a token is held by an agent directly, so it is a card of one row and no header, and keeps the row text it had.
  it("shows a token as a card of one row", () => {
    render([SIGN_IN, TOKEN]);
    const card = byTestId(`connection-card-${TOKEN.id}`)!;

    expect(card.children).toHaveLength(1);
    expect(card.querySelector("header")).toBeNull();
    expect(byTestId(`catalog-connection-title-${TOKEN.id}`)!.textContent).toBe(
      "github-pat",
    );
  });

  // TEST_SCENARIO: on the Connections page there is no agent to add to; a row says how many agents use it, with their names on a click, or that none does.
  it("says who uses a connection on the Connections page", () => {
    render([SIGN_IN, NARROW, CHILD], {
      holders: new Map([
        [
          NARROW.id,
          [
            { id: "agent-1", name: "coder" },
            { id: "agent-2", name: "reviewer" },
          ],
        ],
      ]),
    });

    expect(byTestId(`catalog-add-${NARROW.id}`)).toBeNull();
    expect(byTestId(`connection-used-by-${NARROW.id}`)!.textContent).toBe(
      "Used by 2 agents",
    );
    expect(byTestId(`connection-used-by-${CHILD.id}`)!.textContent).toBe(
      "Not used by any agent",
    );

    act(() => byTestId(`connection-used-by-${NARROW.id}`)!.click());

    expect(
      byTestId(`connection-used-by-${NARROW.id}-names`, document)!.textContent,
    ).toBe("coderreviewer");
  });

  // TEST_SCENARIO: an own agent and a shared agent can carry the same name; the list of names shows each agent once, keyed by its id, so React sees no duplicate key.
  it("lists two agents of the same name as two agents", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render([SIGN_IN, NARROW], {
      holders: new Map([
        [
          NARROW.id,
          [
            { id: "agent-1", name: "coder" },
            { id: "agent-2", name: "coder" },
          ],
        ],
      ]),
    });

    act(() => byTestId(`connection-used-by-${NARROW.id}`)!.click());

    const names = byTestId(`connection-used-by-${NARROW.id}-names`, document)!;
    expect(names.querySelectorAll("li")).toHaveLength(2);
    expect(errors.mock.calls.flat().join(" ")).not.toMatch(/same key/);
    errors.mockRestore();
  });
});

describe("a broken GitHub card", RENDER_TIMEOUT, () => {
  // TEST_SCENARIO: an expired sign-in shows Expired and one fix, Sign in again, in place of New connection; its connections are grey, offer no button but their menu, and say they wait for it.
  it("pauses the connections of an expired sign-in", () => {
    let signedIn = 0;
    const expired = { ...SIGN_IN, status: "expired" as const };
    render([expired, NARROW], {
      maintenance: (c) =>
        c.id === SIGN_IN.id ? { onReauthenticate: () => signedIn++ } : {},
    });
    const row = byTestId(`catalog-connection-${NARROW.id}`)!;

    expect(
      byTestId(`connection-parent-status-${SIGN_IN.id}`)!.textContent,
    ).toBe("Expired");
    expect(byTestId(`connection-new-child-${SIGN_IN.id}`)).toBeNull();
    expect(row.getAttribute("data-paused")).toBe("true");
    expect(row.querySelectorAll("button")).toHaveLength(1);
    expect(
      byTestId(`catalog-connection-account-${NARROW.id}`)!.textContent,
    ).toBe(
      "2 permissions · named github-hello · Paused until you sign in again",
    );

    act(() => byTestId(`catalog-fix-${SIGN_IN.id}`)!.click());

    expect(byTestId(`catalog-fix-${SIGN_IN.id}`)!.textContent).toBe(
      "Sign in again",
    );
    expect(signedIn).toBe(1);
  });

  // TEST_SCENARIO: a sign-in not finished has no login yet: its card is a GitHub sign-in, and its fix is Sign in.
  it("titles a sign-in not finished and offers Sign in", () => {
    render([
      { ...SIGN_IN, status: "pending", accountLabel: undefined },
      NARROW,
    ]);

    expect(byTestId(`connection-parent-title-${SIGN_IN.id}`)!.textContent).toBe(
      "GitHub sign-in",
    );
    expect(byTestId(`catalog-fix-${SIGN_IN.id}`)!.textContent).toBe("Sign in");
  });

  // TEST_SCENARIO: a broken sign-in with no connection cannot make one until it is fixed, so its grey row does not tell the user to make one.
  it("does not ask for a connection from a broken empty sign-in", () => {
    render([{ ...SIGN_IN, status: "expired" as const }]);

    expect(byTestId(`connection-parent-empty-${SIGN_IN.id}`)!.textContent).toBe(
      "No agent can use this sign-in yet.",
    );
  });

  // TEST_SCENARIO: a credential that is still active but failed its last check says Check failed, on the card's header and on a connection's row.
  it("says Check failed on a header and on a row", () => {
    const failed = { status: "failed" as const, at: "2026-01-01T00:00:00Z" };
    render([
      { ...SIGN_IN, check: failed },
      { ...NARROW, check: failed },
    ]);

    expect(
      byTestId(`connection-parent-${SIGN_IN.id}`)!
        .querySelector("header")!
        .querySelector(
          `[data-testid="catalog-connection-check-${SIGN_IN.id}"]`,
        )!.textContent,
    ).toBe("Check failed");
    expect(byTestId(`catalog-connection-check-${NARROW.id}`)!.textContent).toBe(
      "Check failed",
    );
  });

  // TEST_SCENARIO: GitHub refused one connection while its sign-in still works: the row says Expired and that GitHub refused it, and its fix is Choose access again, which opens the access dialog.
  it("offers Choose access again on a refused connection", () => {
    let chosen = 0;
    render([SIGN_IN, { ...NARROW, status: "expired" }], {
      maintenance: () => ({
        onReauthenticate: () => {},
        onEditScope: () => chosen++,
      }),
    });

    expect(
      byTestId(`catalog-connection-expired-${NARROW.id}`)!.textContent,
    ).toBe("Expired");
    expect(
      byTestId(`catalog-connection-account-${NARROW.id}`)!.textContent,
    ).toBe("2 permissions · named github-hello · GitHub refused this access");

    act(() => byTestId(`catalog-fix-${NARROW.id}`)!.click());

    expect(byTestId(`catalog-fix-${NARROW.id}`)!.textContent).toBe(
      "Choose access again",
    );
    expect(chosen).toBe(1);
  });
});

describe("a GitHub connection row", RENDER_TIMEOUT, () => {
  // TEST_SCENARIO: a full-access connection shows Full access, In this agent or Add to agent, and Narrow access at once. The badge stays in the name's block and every button in the actions block, which may wrap onto its own line, so the two never share space.
  it("keeps the badges with the name and the buttons in their own block", () => {
    render([SIGN_IN, CHILD]);
    const row = byTestId(`catalog-connection-${CHILD.id}`)!;
    const [line] = row.firstElementChild!.children;
    const [nameBlock, actionsBlock] = line!.children;

    expect(line!.className).toContain("flex-wrap");
    expect(nameBlock!.textContent).toBe(
      "Everything the app can reach, on every accountFull access",
    );
    expect(nameBlock!.querySelector("button")).toBeNull();
    for (const id of [`catalog-narrow-${CHILD.id}`, `catalog-add-${CHILD.id}`])
      expect(actionsBlock!.contains(byTestId(id))).toBe(true);
  });

  // TEST_SCENARIO: Narrow access leaves a narrow row, so the row keeps one control rather than stacking two; the menu's Edit repositories & permissions opens the same dialog there.
  it("leaves Narrow access to the menu on a narrow row", () => {
    let narrowed = 0;
    render([SIGN_IN, CHILD], {
      maintenance: () => ({
        onReauthenticate: () => {},
        onEditScope: () => narrowed++,
      }),
    });

    expect(
      byTestId(`catalog-narrow-${CHILD.id}`)!.className.split(" "),
    ).toContain("@max-md:hidden");

    openMenu(CHILD.id);
    act(() => byTestId(`catalog-edit-scope-${CHILD.id}`, document)!.click());

    expect(narrowed).toBe(1);
  });

  // TEST_SCENARIO: the Full access badge is a warning, not an error, and is said once: the title says what it reaches.
  it("says Full access once, as a warning", () => {
    render([SIGN_IN, CHILD]);
    const row = byTestId(`catalog-connection-${CHILD.id}`)!;

    expect(row.textContent!.match(/Full access/g)).toHaveLength(1);
    expect(byTestId(`connection-full-access-${CHILD.id}`)!.className).toContain(
      "text-warning-fg",
    );
  });

  // TEST_SCENARIO: the ⋮ menu sits in the same place on every row and on the header: last, at the top right.
  it("puts the menu at the top right of every row and of the header", () => {
    render([SIGN_IN, CHILD]);
    const row = byTestId(`catalog-connection-${CHILD.id}`)!;
    const header = byTestId(
      `connection-parent-${SIGN_IN.id}`,
    )!.firstElementChild!;

    expect(row.className).toContain("items-start");
    expect(row.lastElementChild!.firstElementChild).toBe(
      byTestId(`catalog-menu-${CHILD.id}`),
    );
    expect(row.lastElementChild!.className).toContain("h-8");
    expect(header.lastElementChild!.lastElementChild).toBe(
      byTestId(`catalog-menu-${SIGN_IN.id}`),
    );
  });

  // TEST_SCENARIO: the subtitle wraps instead of cutting its sentence, so a narrow row still says what the connection waits for.
  it("wraps the subtitle rather than cutting it", () => {
    render([SIGN_IN, CHILD]);
    const detail = byTestId(`catalog-connection-account-${CHILD.id}`)!;

    expect(detail.className).not.toContain("truncate");
    expect(detail.className).toContain("break-words");
  });
});

describe("where a sign-in's app is installed", RENDER_TIMEOUT, () => {
  // TEST_SCENARIO: the header names the app and how many accounts it is on; a click lists the accounts, with their avatars, under the header line.
  it("counts the accounts and lists them on a click", () => {
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

    expect(byTestId(`github-installations-${SIGN_IN.id}`)!.textContent).toBe(
      "Acme app on 2 accounts · 1 suspended",
    );
    expect(
      byTestId(`github-installations-${SIGN_IN.id}-account-acme`),
    ).toBeNull();

    act(() => byTestId(`github-installations-${SIGN_IN.id}-toggle`)!.click());

    expect(
      byTestId(`github-installations-${SIGN_IN.id}-account-acme`)!.textContent,
    ).toBe("acmeAll repositories");
    expect(
      byTestId(`github-installations-${SIGN_IN.id}-account-acme`)!
        .querySelector("img")!
        .getAttribute("src"),
    ).toBe("https://avatars.githubusercontent.com/u/1?v=4&s=40");
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
    expect(suspended.className).toContain("text-warning-fg");

    fake.installations.data = {
      accounts: [fake.installations.data.accounts[0]!],
    };
    render([SIGN_IN]);

    expect(
      byTestId(`github-installations-${SIGN_IN.id}-toggle`)!.textContent,
    ).toBe("Acme app on 1 account");
    expect(byTestId(`github-installations-${SIGN_IN.id}-suspended`)).toBeNull();
  });

  // TEST_SCENARIO: the link to install on another account is not a second control on the header line; it ends the opened list.
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
    const list = byTestId(
      `connection-parent-lead-${SIGN_IN.id}`,
    )!.querySelector("ul")!;

    expect(list.lastElementChild!.contains(byTestId(install))).toBe(true);
    expect(byTestId(install)!.textContent).toBe("Install on another account");
  });

  // TEST_SCENARIO: a sign-in whose app is on no account yet says so on the header line, with the install link inside the sentence, where the two-step box and a filled Install button used to be.
  it("says that the app is installed nowhere yet", () => {
    render([SIGN_IN, CHILD]);

    expect(byTestId(`github-installations-${SIGN_IN.id}`)!.textContent).toBe(
      "· Acme app on no account yet. Install the app on each account whose repositories agents need.",
    );
    expect(
      byTestId(`github-installations-${SIGN_IN.id}-install`)!.getAttribute(
        "href",
      ),
    ).toBe("https://github.com/apps/acme-dam/installations/new");
    expect(host.textContent).not.toContain("2 steps required");
    expect(host.querySelector(".bg-primary")).toBeNull();
  });

  // TEST_SCENARIO: the create form names the two steps with the same words as the card, not as a box of its own.
  it("words the create form's hint like the card", () => {
    act(() =>
      root.render(createElement(GithubStepsCallout, { templateId: "github" })),
    );

    expect(host.textContent).toBe(
      "Sign in with GitHub, then install the Acme app on each account whose repositories agents need.",
    );
  });

  // TEST_SCENARIO: a list GitHub could not answer says so, and offers Try again first — it reads the list again — with the install link after it, since installing does not fix a failed read.
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
      "· Couldn't check where the app is installed. Try again or install the app",
    );
    expect(
      retry.compareDocumentPosition(
        byTestId(`github-installations-${SIGN_IN.id}-install`)!,
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    act(() => retry.click());

    expect(refetch).toHaveBeenCalledOnce();
  });

  // TEST_SCENARIO: only an active sign-in made through an app the platform knows lists installations; a connection made from it, a sign-in still authorizing, and an installation ask GitHub nothing.
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
