// @vitest-environment happy-dom
// TEST_OVERVIEW: a GitHub App installation or a GitHub sign-in can be added with no connection under it. The add form offers "Don't make a connection yet" beside the narrowed and full-access choices; picked, it sends the installation with no scope and no full access, and the caller hears that the installation was added alone. The step after a sign-in offers the same choice, and puts the connection off without creating one; a New connection on a parent that already exists does not offer it.
import type { ConnectionTemplateView, ConnectionView } from "api-server-api";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCreatePayload,
  type CreateFormValues,
} from "../../modules/connections/lib/build-create-payload.js";

const fake = vi.hoisted(() => ({
  submitted: [] as unknown[],
  createFromParent: vi.fn(),
}));

vi.mock("../../modules/connections/api/queries.js", () => ({
  useAppConnections: () => ({ data: [] }),
}));
vi.mock("../../modules/connections/api/mutations.js", () => {
  const idle = { isPending: false, isError: false, error: null };
  return {
    useProbeGitHubAppInstallation: () => ({
      ...idle,
      data: undefined,
      mutate: () => {},
      reset: () => {},
    }),
    useProbeGitHubAppInstallationForConnection: () => ({
      ...idle,
      data: undefined,
      mutate: () => {},
    }),
    useProbeGitHubUserToken: () => ({
      ...idle,
      data: { installations: [] },
      mutate: () => {},
    }),
    useCreateConnectionFromParent: () => ({
      ...idle,
      mutateAsync: fake.createFromParent,
    }),
  };
});
vi.mock(
  "../../modules/connections/hooks/use-template-create-submit.js",
  () => ({
    useTemplateCreateSubmit: ({
      onCreated,
    }: {
      onCreated: (id: string) => void;
    }) => ({
      submit: async (payload: unknown) => {
        fake.submitted.push(payload);
        onCreated("conn-new");
      },
      pending: false,
      authorizing: false,
      verifying: false,
      needsOAuth: false,
      awaitingPopup: false,
      refocusPopup: () => {},
    }),
  }),
);

const { TemplateCreateFormBody } =
  await import("../../modules/connections/forms/template-create-form-body.js");
const { ConnectionCreateChildForm } =
  await import("../../modules/connections/components/connection-create-child-form.js");

const GITHUB_APP: ConnectionTemplateView = {
  id: "github-app",
  name: "GitHub App (installation)",
  category: "app",
  isCustom: false,
  authKind: "github-app",
  inputs: [
    { name: "appId", state: "required" },
    { name: "installationId", state: "required" },
    { name: "privateKey", state: "required", secret: true },
    { name: "repositories", state: "optional" },
    { name: "repositoryIds", state: "optional" },
    { name: "permissions", state: "optional" },
  ],
};

const SIGN_IN = {
  id: "conn-sign-in",
  name: "octo",
  authKind: "oauth",
  templateId: "github",
  isParent: true,
} as unknown as ConnectionView;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.submitted = [];
  fake.createFromParent.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

const byTestId = <T extends HTMLElement = HTMLElement>(id: string) =>
  host.querySelector<T>(`[data-testid="${id}"]`);

function click(el: HTMLElement | null) {
  if (!el) throw new Error("nothing to click");
  act(() => {
    el.click();
  });
}

function type(testId: string, text: string) {
  const el = byTestId<HTMLInputElement | HTMLTextAreaElement>(testId);
  if (!el) throw new Error(`no ${testId}`);
  const proto = Object.getPrototypeOf(el) as object;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("buildCreatePayload (github-app, no connection yet)", () => {
  // TEST_SCENARIO: AC-4 — an installation added with no connection sends neither full access nor a scope, even when the narrowed choice left repositories and permissions in the form, so the server makes the installation alone and nothing reaches everything.
  it("sends the installation with no scope and no full access", () => {
    const values: CreateFormValues = {
      name: "my-app",
      overrideDefaults: false,
      access: "later",
      fields: {
        appId: "1",
        installationId: "2",
        privateKey: "pem",
        repositories: "docs",
        permissions: "contents:read",
      },
    };
    expect(buildCreatePayload(GITHUB_APP, values)).toEqual({
      templateId: "github-app",
      name: "my-app",
      authKind: "github-app",
      appId: "1",
      installationId: "2",
      privateKey: "pem",
    });
  });
});

const RENDER_TIMEOUT = { timeout: 30_000 };

describe("adding a GitHub App installation", RENDER_TIMEOUT, () => {
  function renderForm() {
    const onCreated = vi.fn<(id: string) => void>();
    const onAddedAlone = vi.fn<(id: string) => void>();
    act(() =>
      root.render(
        createElement(TemplateCreateFormBody, {
          template: GITHUB_APP,
          onCreated,
          onAddedAlone,
          onCancel: () => {},
        }),
      ),
    );
    type("connection-field-appId", "1");
    type("connection-field-installationId", "2");
    type("connection-field-privateKey", "pem");
    return { onCreated, onAddedAlone };
  }

  // TEST_SCENARIO: AC-1 — with nothing narrowed the form will not submit, but picking "Don't make a connection yet" lets it, sends no reach, and tells the caller the installation was added alone rather than that a connection was made.
  it("adds the installation alone when the connection is put off", async () => {
    const { onCreated, onAddedAlone } = renderForm();
    const submit = byTestId<HTMLButtonElement>("connection-create-submit")!;
    expect(submit.disabled).toBe(true);

    click(byTestId("github-app-later"));
    await settle();
    expect(submit.disabled).toBe(false);
    click(submit);
    await settle();

    expect(fake.submitted).toHaveLength(1);
    expect(fake.submitted[0]).not.toHaveProperty("fullAccess");
    expect(fake.submitted[0]).not.toHaveProperty("repositories");
    expect(fake.submitted[0]).not.toHaveProperty("permissions");
    expect(onAddedAlone).toHaveBeenCalledWith("conn-new");
    expect(onCreated).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: AC-3 — full access in the same form still makes the first connection, and the caller hears of that connection as before.
  it("still makes the first connection with full access", async () => {
    const { onCreated, onAddedAlone } = renderForm();
    click(byTestId("github-app-full-access"));
    await settle();
    click(byTestId("connection-create-submit"));
    await settle();

    expect(fake.submitted[0]).toMatchObject({ fullAccess: true });
    expect(onCreated).toHaveBeenCalledWith("conn-new");
    expect(onAddedAlone).not.toHaveBeenCalled();
  });
});

describe("the first connection after a GitHub sign-in", RENDER_TIMEOUT, () => {
  // TEST_SCENARIO: after a sign-in, "Don't make a connection yet" hides the name, turns the button into Done, and closes the step without creating a connection.
  it("puts the connection off without creating one", () => {
    const onLater = vi.fn<() => void>();
    act(() =>
      root.render(
        createElement(ConnectionCreateChildForm, {
          parent: SIGN_IN,
          onCreated: () => {},
          onCancel: () => {},
          onLater,
          layout: (fields, footer) => [fields, footer],
        }),
      ),
    );
    const submit = byTestId<HTMLButtonElement>("create-child-submit")!;
    expect(submit.disabled).toBe(true);

    click(byTestId("create-child-later"));
    expect(byTestId("create-child-name")).toBeNull();
    expect(submit.disabled).toBe(false);
    expect(submit.textContent).toBe("Done");
    click(submit);

    expect(onLater).toHaveBeenCalledOnce();
    expect(fake.createFromParent).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: New connection on an existing sign-in or installation is there to make one, so it offers no way to put it off.
  it("offers no later choice when a connection is asked for", () => {
    act(() =>
      root.render(
        createElement(ConnectionCreateChildForm, {
          parent: SIGN_IN,
          onCreated: () => {},
          onCancel: () => {},
          layout: (fields, footer) => [fields, footer],
        }),
      ),
    );
    expect(byTestId("create-child-later")).toBeNull();
    expect(byTestId("create-child-narrowed")).not.toBeNull();
  });
});
