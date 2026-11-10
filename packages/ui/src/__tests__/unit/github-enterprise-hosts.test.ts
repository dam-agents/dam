// @vitest-environment happy-dom
// TEST_OVERVIEW: with the github-enterprise-hosts feature on, the GitHub Enterprise connect form asks which host to sign in to from the offered hosts, even when the install offers only one, or "Another host…" with the user's own app, and sends the host picked; with the feature off it keeps the form it always had. A GitHub Enterprise sign-in can be moved to another offered host from its row; a sign-in whose host is retired reads disconnected and offers the move in place of re-authenticating. Moving it calls the server with the new host and then starts the authorization on that host.
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  gheSignInOfferedHosts,
  movesBetweenHosts,
  otherHosts,
  retiredHostNote,
} from "../../modules/connections/lib/github-enterprise-hosts.js";

const fake = vi.hoisted(() => ({
  submitted: [] as unknown[],
  moveToHost: vi.fn(),
  hostsFeature: false,
  templates: [] as unknown[],
}));

vi.mock("../../modules/connections/api/queries.js", () => ({
  useAppConnections: () => ({ data: [] }),
  useConnectionTemplates: () => ({ data: fake.templates }),
}));
vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({
    data: { "github-enterprise-hosts": fake.hostsFeature },
  }),
}));
vi.mock(
  "../../modules/connections/hooks/use-reauthenticate-connection.js",
  () => ({
    useReauthenticateConnection: () => ({
      reauthenticate: async () => {},
      busyId: null,
    }),
  }),
);
vi.mock("../../modules/connections/api/mutations.js", () => ({
  useMoveConnectionToHost: () => ({
    isPending: false,
    error: null,
    mutateAsync: fake.moveToHost,
  }),
  useRotateDamConnection: () => ({ isPending: false, mutate: () => {} }),
}));
vi.mock(
  "../../modules/connections/hooks/use-template-create-submit.js",
  () => ({
    useTemplateCreateSubmit: () => ({
      submit: async (payload: unknown) => void fake.submitted.push(payload),
      pending: false,
      authorizing: false,
      verifying: false,
      needsOAuth: true,
      awaitingPopup: false,
      refocusPopup: () => {},
      cancelAuthorization: () => {},
      popupDeadlineAt: null,
    }),
  }),
);

const { TemplateCreateFormBody } =
  await import("../../modules/connections/forms/template-create-form-body.js");
const { ConnectionMoveHostDialog } =
  await import("../../modules/connections/components/connection-move-host-dialog.js");
const { ConnectionRowActions } =
  await import("../../modules/connections/components/connection-row-actions.js");
const { useConnectionMaintenance } =
  await import("../../modules/connections/hooks/use-connection-maintenance.js");

const HOSTS = ["research.github.ibm.com", "consulting.github.ibm.com"];

const GHE: ConnectionTemplateView = {
  id: "github-enterprise",
  name: "GitHub Enterprise",
  category: "app",
  isCustom: false,
  authKind: "oauth",
  inputs: [
    { name: "host", state: "required", presetValue: HOSTS[0] },
    { name: "clientId", state: "overridable" },
    { name: "clientSecret", state: "overridable", secret: true },
    { name: "appSlug", state: "overridable" },
  ],
  extras: { hostChoices: HOSTS },
};

const ONE_HOST = "ghe.example.com";

const SINGLE: ConnectionTemplateView = {
  ...GHE,
  inputs: [
    { name: "host", state: "overridable", presetValue: ONE_HOST },
    { name: "clientId", state: "overridable", presetValue: "Iv1.single" },
    { name: "clientSecret", state: "overridable", secret: true },
    { name: "appSlug", state: "overridable", presetValue: "dam-single" },
  ],
  extras: { hostChoices: [ONE_HOST], appSlug: "dam-single" },
};

const SIGN_IN = {
  id: "conn-ghe",
  name: "ghe",
  templateId: "github-enterprise",
  authKind: "oauth",
  isParent: true,
  host: "github.ibm.com",
  status: "disconnected",
  retiredHost: "github.ibm.com",
} as unknown as ConnectionView;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.submitted = [];
  fake.moveToHost.mockReset();
  fake.hostsFeature = false;
  fake.templates = [GHE];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

const byTestId = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.body.querySelector<T>(`[data-testid="${id}"]`);

function click(el: HTMLElement | null) {
  if (!el) throw new Error("nothing to click");
  act(() => {
    el.click();
  });
}

function choose(testId: string, value: string) {
  const el = byTestId<HTMLSelectElement>(testId);
  if (!el) throw new Error(`no ${testId}`);
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function type(testId: string, value: string) {
  const el = byTestId<HTMLInputElement>(testId);
  if (!el) throw new Error(`no ${testId}`);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the hosts a GitHub Enterprise template offers", () => {
  // TEST_SCENARIO: the hosts a sign-in may use or move to are every offered host, even the only one.
  it("reads every offered host, even the only one", () => {
    expect(gheSignInOfferedHosts([GHE])).toEqual(HOSTS);
    expect(
      gheSignInOfferedHosts([
        { ...GHE, extras: { hostChoices: ["research.github.ibm.com"] } },
      ]),
    ).toEqual(["research.github.ibm.com"]);
  });

  // TEST_SCENARIO: only a GitHub Enterprise sign-in moves between hosts; a connection made from it follows the sign-in, and a token or app installation is not moved.
  it("moves a sign-in only, to a host it is not on", () => {
    expect(movesBetweenHosts(SIGN_IN)).toBe(true);
    expect(
      movesBetweenHosts({ ...SIGN_IN, parentId: "conn-x" } as ConnectionView),
    ).toBe(false);
    expect(
      movesBetweenHosts({
        ...SIGN_IN,
        templateId: "github-enterprise-pat",
        authKind: "header",
      } as ConnectionView),
    ).toBe(false);
    expect(
      otherHosts(HOSTS, { host: "research.github.ibm.com" } as ConnectionView),
    ).toEqual(["consulting.github.ibm.com"]);
    expect(
      otherHosts(HOSTS, { host: "Research.GitHub.ibm.com" } as ConnectionView),
    ).toEqual(["consulting.github.ibm.com"]);
  });
});

const RENDER_TIMEOUT = { timeout: 30_000 };

describe("connecting to a GitHub Enterprise host", RENDER_TIMEOUT, () => {
  // TEST_SCENARIO: the user picks the host of their Business Unit from the list, and the sign-in is created on that host.
  it("asks which host from a list and sends the one picked", async () => {
    act(() =>
      root.render(
        createElement(TemplateCreateFormBody, {
          template: GHE,
          pickHost: true,
          onCreated: () => {},
          onAddedAlone: () => {},
          onCancel: () => {},
        }),
      ),
    );
    const select = byTestId<HTMLSelectElement>("connection-field-host");
    expect(select?.tagName).toBe("SELECT");
    expect([...select!.options].map((o) => o.value)).toEqual([
      ...HOSTS,
      "another",
    ]);
    expect(select!.value).toBe(HOSTS[0]);

    choose("connection-field-host", HOSTS[1]!);
    click(byTestId("connection-create-submit"));
    await settle();
    expect(fake.submitted).toEqual([
      expect.objectContaining({
        templateId: "github-enterprise",
        authKind: "oauth",
        host: HOSTS[1],
      }),
    ]);
  });

  // TEST_SCENARIO: an install with one GitHub Enterprise host and the feature on still shows the host as its own field, a picker of that host and "Another host…", not a preset hidden under Customize defaults.
  it("shows the host picker for a single offered host", async () => {
    act(() =>
      root.render(
        createElement(TemplateCreateFormBody, {
          template: SINGLE,
          pickHost: true,
          onCreated: () => {},
          onAddedAlone: () => {},
          onCancel: () => {},
        }),
      ),
    );
    const select = byTestId<HTMLSelectElement>("connection-field-host");
    expect(select?.tagName).toBe("SELECT");
    expect([...select!.options].map((o) => o.value)).toEqual([
      ONE_HOST,
      "another",
    ]);
    expect(select!.value).toBe(ONE_HOST);
    expect(byTestId("customize-defaults")?.contains(select!) ?? false).toBe(
      false,
    );

    click(byTestId("connection-create-submit"));
    await settle();
    expect(fake.submitted).toEqual([
      expect.objectContaining({ host: ONE_HOST }),
    ]);
    expect(fake.submitted[0]).not.toHaveProperty("clientId");
  });

  // TEST_SCENARIO: a host the install has no app on needs the user's own app, so picking "Another host…" asks for the host, a client ID and a client secret, refuses to submit without them, and sends them with the host typed.
  it("asks for your own app on another host", async () => {
    act(() =>
      root.render(
        createElement(TemplateCreateFormBody, {
          template: SINGLE,
          pickHost: true,
          onCreated: () => {},
          onAddedAlone: () => {},
          onCancel: () => {},
        }),
      ),
    );
    choose("connection-field-host", "another");
    const other = byTestId<HTMLInputElement>("connection-field-host-other");
    expect(other?.value).toBe("");
    expect(byTestId("connection-field-clientId")).not.toBeNull();
    expect(byTestId("connection-field-clientSecret")).not.toBeNull();

    click(byTestId("connection-create-submit"));
    await settle();
    expect(fake.submitted).toEqual([]);

    type("connection-field-host-other", "ghe.own.example.com");
    type("connection-field-clientId", "Iv1.mine");
    type("connection-field-clientSecret", "mine-secret");
    click(byTestId("connection-create-submit"));
    await settle();
    expect(fake.submitted).toEqual([
      expect.objectContaining({
        host: "ghe.own.example.com",
        clientId: "Iv1.mine",
        clientSecret: "mine-secret",
      }),
    ]);
  });

  // TEST_SCENARIO: with the experimental feature off the form keeps the free-text host field it always had.
  it("keeps the free-text host field with the feature off", () => {
    act(() =>
      root.render(
        createElement(TemplateCreateFormBody, {
          template: GHE,
          onCreated: () => {},
          onAddedAlone: () => {},
          onCancel: () => {},
        }),
      ),
    );
    expect(byTestId("connection-field-host")?.tagName).toBe("INPUT");
  });
});

describe("a sign-in on a retired host", RENDER_TIMEOUT, () => {
  // TEST_SCENARIO: re-authenticating on a host that is gone cannot work, so a disconnected sign-in offers the move as its fix, in the row and in its menu.
  it("offers the move as its fix", () => {
    const onMoveHost = vi.fn();
    act(() =>
      root.render(
        createElement(ConnectionRowActions, {
          connection: SIGN_IN,
          maintenance: { onMoveHost },
        }),
      ),
    );
    const fix = byTestId("catalog-fix-conn-ghe");
    expect(fix?.textContent).toBe("Move to another host");
    click(fix);
    expect(onMoveHost).toHaveBeenCalledOnce();
  });

  // TEST_SCENARIO: retiring a host is the operator's act, not a feature a user opted into; with the experimental feature off a sign-in on a retired host must still offer the move, while a working sign-in only offers it with the feature on.
  it("offers the move on a retired host with the feature off", () => {
    let actions: ReturnType<
      ReturnType<typeof useConnectionMaintenance>["rowActions"]
    >[] = [];
    function Probe() {
      const { rowActions } = useConnectionMaintenance();
      actions = [
        rowActions(SIGN_IN),
        rowActions({
          ...SIGN_IN,
          host: HOSTS[0],
          status: "active",
          retiredHost: undefined,
        } as ConnectionView),
      ];
      return null;
    }
    act(() => root.render(createElement(Probe)));
    expect(actions[0]?.onMoveHost).toBeTypeOf("function");
    expect(actions[1]?.onMoveHost).toBeUndefined();

    fake.hostsFeature = true;
    act(() => root.render(createElement(Probe)));
    expect(actions[1]?.onMoveHost).toBeTypeOf("function");
  });

  // TEST_SCENARIO: "Disconnected" alone reads like a network fault; the row says the host is retired and what fixes it, for the sign-in, a connection made from it, and a token or installation (or one made from an installation) that cannot move.
  it("says the host is retired and what to do", () => {
    expect(retiredHostNote(SIGN_IN)).toBe(
      "github.ibm.com is retired. Move this sign-in to another host.",
    );
    expect(
      retiredHostNote({
        ...SIGN_IN,
        templateId: "github-enterprise-app",
        authKind: "github-app",
        parentId: "conn-install",
      } as ConnectionView),
    ).toBe(
      "github.ibm.com is retired. Make a new one on another host, then remove this one.",
    );
    expect(
      retiredHostNote({ ...SIGN_IN, parentId: "conn-ghe" } as ConnectionView),
    ).toBe(
      "github.ibm.com is retired. Move the sign-in this connection was made from.",
    );
    expect(
      retiredHostNote({
        ...SIGN_IN,
        templateId: "github-enterprise-pat",
        authKind: "header",
      } as ConnectionView),
    ).toBe(
      "github.ibm.com is retired. Make a new one on another host, then remove this one.",
    );
    expect(
      retiredHostNote({ ...SIGN_IN, retiredHost: undefined } as ConnectionView),
    ).toBeUndefined();
  });

  // TEST_SCENARIO: a sign-in moved but never authorized reads expired on its new host and must still offer the authorization from its row, so an abandoned consent is not a dead end.
  it("offers the authorization again after a move left unauthorized", () => {
    const onReauthenticate = vi.fn();
    act(() =>
      root.render(
        createElement(ConnectionRowActions, {
          connection: {
            ...SIGN_IN,
            host: HOSTS[0],
            status: "expired",
            retiredHost: undefined,
          } as ConnectionView,
          maintenance: { onReauthenticate },
        }),
      ),
    );
    const fix = byTestId("catalog-fix-conn-ghe");
    expect(fix?.textContent).toBe("Re-authenticate");
    click(fix);
    expect(onReauthenticate).toHaveBeenCalledOnce();
  });

  // TEST_SCENARIO: the move sends the host picked, and only once the server has moved the sign-in does the caller start the authorization on the new host.
  it("moves to the picked host, then hands over for authorization", async () => {
    fake.moveToHost.mockResolvedValue(undefined);
    const onMoved = vi.fn();
    act(() =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(ConnectionMoveHostDialog, {
            connection: SIGN_IN,
            hosts: HOSTS,
            onMoved,
            onClose: () => {},
          }),
        ),
      ),
    );
    choose("move-host-select", HOSTS[1]!);
    click(byTestId("move-host-submit"));
    await settle();
    expect(fake.moveToHost).toHaveBeenCalledWith({
      id: "conn-ghe",
      host: HOSTS[1],
    });
    expect(onMoved).toHaveBeenCalledWith(SIGN_IN);
  });
});
