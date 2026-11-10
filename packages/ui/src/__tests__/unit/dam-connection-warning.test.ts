// @vitest-environment happy-dom
// TEST_OVERVIEW: the warning an Agent's owner reads when the people who drive it
// TEST_OVERVIEW: would act as them, through the Connection that drives this
// TEST_OVERVIEW: install. The bind flow says it while the Agent's library has not
// TEST_OVERVIEW: arrived or its read failed, because a warning that is wrong costs
// TEST_OVERVIEW: a sentence and one that is missing costs an account; it says
// TEST_OVERVIEW: nothing once the library is there and the Agent holds no such
// TEST_OVERVIEW: Connection.
import type { AgentConnections, ConnectionView } from "api-server-api";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentView } from "../../types.js";

const library: { data: ConnectionView[] | undefined } = { data: undefined };
const held: { data: AgentConnections | undefined } = { data: undefined };

vi.mock("../../modules/connections/api/queries.js", () => ({
  useAppConnections: () => ({ data: library.data }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentConnections: () => ({ data: held.data }),
}));

vi.mock("../../modules/satellites/api/queries.js", () => ({
  useSatellites: () => ({ data: [] }),
}));

const { useHoldsDamConnection } =
  await import("../../modules/agents/hooks/use-holds-dam-connection.js");
const { useBindSharingConfirm } =
  await import("../../modules/agents/hooks/use-bind-sharing-confirm.js");
const { useConfirmSharedConnection } =
  await import("../../modules/connections/hooks/use-confirm-shared-connection.js");
const { useStore } = await import("../../store.js");
const { useDismissibleConfirm } =
  await import("../../modules/connections/hooks/use-dismissible-confirm.js");
const { getBrand } = await import("../../brand.js");

const DAM: ConnectionView = {
  id: "conn-dam",
  templateId: "dam",
  name: getBrand().name,
} as unknown as ConnectionView;
const GITHUB: ConnectionView = {
  id: "conn-github",
  templateId: "github",
  name: "GitHub",
} as unknown as ConnectionView;

const agentHolding = (granted: readonly string[]): AgentView =>
  ({
    id: "agent-1",
    name: "Dambledore",
    grantedConnectionIds: granted,
  }) as unknown as AgentView;

/* UNIT_BOUNDARY_DESCRIPTION: the Agent's own grants as the page reads them: the Connections it holds, and a missing one where its detail has not arrived. */
const grants = (
  ...connections: (ConnectionView | undefined)[]
): AgentConnections =>
  ({
    agentId: "agent-1",
    connections: connections.map((connection, index) => ({
      connectionId: connection?.id ?? `conn-unknown-${String(index)}`,
      grantedAt: "2026-01-01",
      preferred: false,
      ...(connection ? { connection } : {}),
    })),
  }) as unknown as AgentConnections;

const CHAT = { kind: "slack-channel" as const, name: "#team-x" };

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;

function render(node: ReturnType<typeof createElement>) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(node));
}

function HoldProbe({ agent }: { agent: AgentView }) {
  return createElement(
    "span",
    { "data-testid": "hold" },
    useHoldsDamConnection(agent),
  );
}

function BindProbe({ agent }: { agent: AgentView }) {
  const { body } = useBindSharingConfirm(agent);
  return createElement("div", null, body(CHAT));
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  library.data = undefined;
  held.data = undefined;
  useStore.setState({ dialog: null });
});

function GrantProbe({ connection }: { connection: ConnectionView }) {
  const { confirm } = useConfirmSharedConnection({
    editors: [],
    channels: [],
  });
  useEffect(() => {
    void confirm({ name: connection.name, templateId: connection.templateId });
  }, [confirm, connection]);
  return null;
}

function DismissibleProbe() {
  const { confirm } = useDismissibleConfirm("dam-warning-test-key");
  useEffect(() => {
    void confirm({
      title: "Forget it?",
      body: "This one can be dismissed.",
      confirmLabel: "Forget",
    });
  }, [confirm]);
  return null;
}

const dialogText = () => {
  const dialog = useStore.getState().dialog;
  if (dialog === null) return null;
  return {
    title: dialog.title,
    body: renderToStaticMarkup(createElement("div", null, dialog.message)),
  };
};

describe("the warning in the channel-bind flow", () => {
  // TEST_SCENARIO: the Agent's library has not arrived yet, so the page cannot say whether it holds the Connection — the warning shows all the same.
  it("warns while the library is still loading", () => {
    held.data = undefined;
    render(createElement(HoldProbe, { agent: agentHolding(["conn-dam"]) }));
    expect(host.textContent).toBe("unknown");

    render(createElement(BindProbe, { agent: agentHolding(["conn-dam"]) }));
    expect(host.textContent).toContain(
      `This agent holds the ${getBrand().name} connection`,
    );
  });

  // TEST_SCENARIO: the Agent holds it and its library is there, so the flow names exactly what the chat gains: everyone in it can act as the owner.
  it("warns when the Agent holds it", () => {
    held.data = grants(DAM, GITHUB);
    render(createElement(HoldProbe, { agent: agentHolding(["conn-dam"]) }));
    expect(host.textContent).toBe("held");

    render(createElement(BindProbe, { agent: agentHolding(["conn-dam"]) }));
    expect(host.textContent).toContain(
      `so anyone in this chat can act as you on ${getBrand().name}`,
    );
  });

  // TEST_SCENARIO: the library is there and the Agent holds something else, so the flow leaves the Connection out of what it says.
  it("says nothing when the Agent holds no such Connection", () => {
    held.data = grants(GITHUB);
    render(createElement(HoldProbe, { agent: agentHolding(["conn-github"]) }));
    expect(host.textContent).toBe("not-held");

    render(createElement(BindProbe, { agent: agentHolding(["conn-github"]) }));
    expect(host.textContent).not.toContain(`${getBrand().name} connection`);
  });

  // TEST_SCENARIO: the viewer's own library says nothing about the Agent an editor is looking at, so the hold is read from the Agent's grants: the same Agent reads the same both ways, and a grant whose detail has not arrived is not called safe.
  it("reads the Agent's own grants, not the viewer's library", () => {
    library.data = [];
    held.data = grants(DAM);
    render(createElement(HoldProbe, { agent: agentHolding(["conn-dam"]) }));
    expect(host.textContent).toBe("held");

    library.data = [DAM];
    held.data = grants(GITHUB);
    render(createElement(HoldProbe, { agent: agentHolding(["conn-github"]) }));
    expect(host.textContent).toBe("not-held");

    held.data = grants(undefined);
    render(createElement(HoldProbe, { agent: agentHolding(["conn-dam"]) }));
    expect(host.textContent).toBe("unknown");
  });
});

describe("the confirmation before the grant", () => {
  // TEST_SCENARIO: the warning carries no "don't show this again", because nothing would record that choice and the box would promise what the dialog cannot do. A question a storage key does guard keeps the box.
  it("offers no dismiss box, and a dismissible question still does", () => {
    render(createElement(GrantProbe, { connection: DAM }));
    const undismissable = dialogText();
    expect(undismissable).not.toBeNull();
    expect(undismissable!.body).not.toContain(
      "dismissible-confirm-dont-show-again",
    );
    act(() => useStore.getState().closeDialog(false));

    render(createElement(DismissibleProbe));
    const dismissible = dialogText();
    expect(dismissible).not.toBeNull();
    expect(dismissible!.body).toContain("dismissible-confirm-dont-show-again");
    act(() => useStore.getState().closeDialog(false));
  });

  // TEST_SCENARIO: the Agent has no editors and no shared chat, so there is no audience to warn about — and the grant still asks, because the Connection itself is the thing being given away: the agent it is granted to acts as its owner.
  it("asks before granting the Connection to an agent with no audience", () => {
    render(createElement(GrantProbe, { connection: DAM }));
    const dialog = dialogText();
    expect(dialog).not.toBeNull();
    expect(dialog!.title).toBe("Let this agent act as you?");
    expect(dialog!.body).toContain(getBrand().name);
    expect(dialog!.body).toContain("act as you");
    act(() => useStore.getState().closeDialog(false));
  });

  // TEST_SCENARIO: a Connection that is not the install's own asks nothing of its own when there is no audience to warn, as before.
  it("asks nothing for another Connection with no audience", () => {
    render(createElement(GrantProbe, { connection: GITHUB }));
    expect(dialogText()).toBeNull();
  });
});
