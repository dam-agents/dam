// @vitest-environment happy-dom
// TEST_OVERVIEW: the connection catalog's GitHub section reads at a glance. A provider card lists its connections as flat rows, a sign-in followed by the connections made from it, with no card nested in a card. In each row the name and its badges sit in one block and the actions in another that wraps below it when the row is narrow, so a button never covers a badge or the name. Under a GitHub sign-in the row lists the organizations its app is installed on — avatars and a count that opens the list, each with its status — or says in one line that the app is installed nowhere yet, in place of the old two-step box.
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
          grantedIds: new Set(),
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
    const [line] = row.children;
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

    expect(line.textContent).toContain("Installed on 2 organizations");
    expect(line.querySelector("img")!.getAttribute("src")).toBe(
      "https://avatars.githubusercontent.com/u/1?v=4&s=32",
    );
    expect(
      byTestId(`github-installations-${SIGN_IN.id}-account-acme`),
    ).toBeNull();

    act(() => byTestId(`github-installations-${SIGN_IN.id}-toggle`)!.click());

    expect(
      byTestId(`github-installations-${SIGN_IN.id}-account-acme`)!.textContent,
    ).toBe("acmeAll repositoriesInstalled");
    expect(
      byTestId(`github-installations-${SIGN_IN.id}-account-beta`)!.textContent,
    ).toBe("betaSelected repositoriesSuspended");
  });

  // TEST_SCENARIO: a sign-in whose app is on no organization yet says so in one line under its row, beside the Install button, where the two-step box used to take a block of its own.
  it("says in one line that the app is installed nowhere yet", () => {
    render([SIGN_IN, CHILD]);

    expect(byTestId(`github-installations-${SIGN_IN.id}`)!.textContent).toBe(
      "Not installed on any organization yet. Install the app to reach its repositories.",
    );
    expect(host.textContent).not.toContain("2 steps required");
    expect(host.textContent).toContain("Install Acme app");
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
      "Couldn't check where the app is installed.",
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
