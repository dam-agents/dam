// @vitest-environment happy-dom
// TEST_OVERVIEW: on an install that offers several GitHub Enterprise hosts, the connect form asks which host to sign in to from a list rather than a free-text field, and sends the host picked. A GitHub Enterprise sign-in can be moved to another offered host from its row; a sign-in whose host is retired reads disconnected and offers the move in place of re-authenticating. Moving it calls the server with the new host and then starts the authorization on that host.
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";

import {
  gheSignInHostChoices,
  hostChoicesOf,
  movesBetweenHosts,
  otherHosts,
} from "../../modules/connections/lib/github-enterprise-hosts.js";

const fake = vi.hoisted(() => ({
  submitted: [] as unknown[],
  moveToHost: vi.fn(),
}));

vi.mock("../../modules/connections/api/queries.js", () => ({
  useAppConnections: () => ({ data: [] }),
}));
vi.mock("../../modules/connections/api/mutations.js", () => ({
  useMoveConnectionToHost: () => ({
    isPending: false,
    error: null,
    mutateAsync: fake.moveToHost,
  }),
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

const SIGN_IN = {
  id: "conn-ghe",
  name: "ghe",
  templateId: "github-enterprise",
  authKind: "oauth",
  isParent: true,
  host: "github.ibm.com",
  status: "disconnected",
} as unknown as ConnectionView;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.submitted = [];
  fake.moveToHost.mockReset();
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

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the hosts a GitHub Enterprise template offers", () => {
  // TEST_SCENARIO: one host is no choice, so the form keeps its free-text field; two or more are offered as a list.
  it("offers a choice only when there are two or more hosts", () => {
    expect(hostChoicesOf(GHE)).toEqual(HOSTS);
    expect(
      hostChoicesOf({ extras: { hostChoices: ["github.ibm.com"] } }),
    ).toEqual([]);
    expect(hostChoicesOf({})).toEqual([]);
    expect(gheSignInHostChoices([GHE])).toEqual(HOSTS);
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
          hostChoices: HOSTS,
          onCreated: () => {},
          onAddedAlone: () => {},
          onCancel: () => {},
        }),
      ),
    );
    const select = byTestId<HTMLSelectElement>("connection-field-host");
    expect(select?.tagName).toBe("SELECT");
    expect([...select!.options].map((o) => o.value)).toEqual(HOSTS);
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

  // TEST_SCENARIO: with the experimental feature off nothing is passed, and the form keeps the free-text host field it always had.
  it("keeps the free-text host field without choices", () => {
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
