// @vitest-environment happy-dom
// TEST_OVERVIEW: Settings provider deletion uses the Connection impact warning; an agent disconnect only revokes its grant.
import { act, createElement, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  confirm: vi.fn(async (..._args: unknown[]) => true),
  del: vi.fn(),
  revoke: vi.fn(),
  agents: vi.fn(async () => [{ id: "a1", name: "Agent One" }]),
  deleting: false,
}));
vi.mock("../../api.js", () => ({
  api: {
    agents: { list: { query: state.agents } },
    connections: {
      getAgentConnections: {
        query: async () => ({ connections: [{ connectionId: "c1" }] }),
      },
    },
  },
}));
vi.mock("../../query-client.js", () => ({
  queryClient: { getQueryData: () => [] },
}));
vi.mock("../../trpc.js", () => ({
  trpc: { connections: { list: { queryKey: () => [] } } },
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({ showConfirm: state.confirm }),
}));
vi.mock("../../modules/connections/api/mutations.js", () => ({
  useDeleteConnection: () => ({
    mutate: state.del,
    isPending: state.deleting,
    variables: { id: "c1" },
  }),
}));
vi.mock("../../modules/connections/api/queries.js", () => ({
  useConnectionTemplates: () => ({ data: [] }),
}));
vi.mock("../../modules/providers/hooks/use-provider-items.js", () => ({
  useProviderItems: () => ({
    itemByType: new Map([
      [
        "openai",
        {
          id: "c1",
          conn: { id: "c1", name: "My OpenAI", templateId: "openai" },
        },
      ],
    ]),
    itemByTemplateId: new Map(),
    isPending: false,
  }),
}));
vi.mock("../../modules/providers/hooks/use-recheck-on-open.js", () => ({
  useRecheckOnOpen: () => {},
}));
vi.mock("../../modules/providers/api/mutations.js", () => ({
  useRecheckProviderKeys: () => ({ isPending: false }),
}));
vi.mock("../../modules/provider-status/api/queries.js", () => ({
  useProviderStatus: () => ({}),
}));
vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useHarnessCatalog: () => ({ data: { harnesses: [] } }),
  useProviderConnections: () => ({
    owned: [{ id: "c1", name: "My OpenAI", templateId: "openai" }],
    granted: [{ id: "c1" }],
    loaded: true,
  }),
  useGrantProvider: () => ({ revoke: state.revoke, pending: false }),
}));
vi.mock("../../modules/providers/components/provider-row.js", () => ({
  ProviderRow: ({ type, onOpen }: { type: string; onOpen: () => void }) =>
    createElement("button", { onClick: onOpen }, type),
}));
vi.mock(
  "../../modules/providers/components/provider-connect-dialog.js",
  () => ({
    ProviderConnectDialog: ({
      onDisconnect,
      disconnectPending,
    }: {
      onDisconnect: () => void;
      disconnectPending: boolean;
    }) =>
      createElement(
        "button",
        { onClick: onDisconnect, disabled: disconnectPending },
        "Delete",
      ),
  }),
);
vi.mock("../../modules/providers/components/provider-balance.js", () => ({
  ProviderBalance: () => null,
}));
vi.mock("../../modules/spend/components/all-agents-provider-limit.js", () => ({
  AllAgentsSpendBadge: () => null,
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: () => null,
}));
vi.mock("../../modules/agents/hooks/use-root-driver.js", () => ({
  useRootDriver: () => null,
}));
vi.mock("../../modules/sessions/hooks/use-provider-usage.js", () => ({
  useProviderUsage: () => () => ({ defaults: [], profiles: [], schedules: [] }),
}));
vi.mock("../../modules/sessions/components/detach-provider-message.js", () => ({
  DetachProviderMessage: () => "Revoke this agent's grant",
}));
vi.mock("../../modules/providers/components/provider-spend-row.js", () => ({
  ProviderSpendRow: ({
    onCheckedChange,
  }: {
    onCheckedChange: (on: boolean) => void;
  }) =>
    createElement(
      "button",
      { onClick: () => onCheckedChange(false) },
      "Revoke",
    ),
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

const { ProviderSection } =
  await import("../../modules/providers/components/provider-section.js");
const { SandboxProvidersSection } =
  await import("../../modules/sandboxes/components/sandbox-providers-section.js");
const { useDisconnectConnection } =
  await import("../../modules/connections/hooks/use-disconnect-connection.js");
let root: Root;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
  state.deleting = false;
});

it.each([false, true])(
  "uses the same impact warning as Connections (unknown: %s)",
  async (unknown) => {
    if (unknown) state.agents.mockRejectedValueOnce(new Error("unavailable"));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(createElement(ProviderSection)));
    act(() =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "openai")!
        .click(),
    );
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Delete")!
        .click(),
    );
    const providerWarning = state.confirm.mock.calls[0]!;
    const html = renderToStaticMarkup(providerWarning[0] as ReactElement);
    expect(html).toContain(unknown ? "delete-agents-unknown" : "Agent One");
    expect(state.del).toHaveBeenCalledWith({ id: "c1" });
    let disconnect: ReturnType<typeof useDisconnectConnection>;
    function Probe() {
      disconnect = useDisconnectConnection();
      return null;
    }
    act(() => root.render(createElement(Probe)));
    if (unknown) state.agents.mockRejectedValueOnce(new Error("unavailable"));
    await disconnect!.confirmAndDelete("c1", "My OpenAI");
    const connectionWarning = state.confirm.mock.calls[1]!;
    expect(renderToStaticMarkup(connectionWarning[0] as ReactElement)).toBe(
      html,
    );
    expect(connectionWarning.slice(1)).toEqual(providerWarning.slice(1));
    state.del.mockClear();
    act(() =>
      root.render(
        createElement(SandboxProvidersSection, {
          agentId: "a1",
          header: () => null,
        }),
      ),
    );
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((b) => b.textContent === "Revoke")!
        .click(),
    );
    expect(state.revoke).toHaveBeenCalledWith("c1");
    expect(state.del).not.toHaveBeenCalled();
  },
);
