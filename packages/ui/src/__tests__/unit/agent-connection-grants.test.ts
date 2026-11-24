// @vitest-environment happy-dom
// TEST_OVERVIEW: The Agent's Connection grants, shared by its Connections section and the chat's + menu, send only the change on every grant or revoke, and the server applies it to the grants it holds. Two quick switches both land, one at a time, and when the first write fails the second carries none of its change, and the shown list takes back only the failed change. While the Agent's access has not loaded the hook offers no change at all, and the + menu draws no switch until the grants have loaded, since a switch drawn before would show off and its click would drop what the Agent holds.
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const server = vi.hoisted(() => ({
  granted: [] as string[],
  writes: [] as { grant: string[]; revoke: string[] }[],
  release: [] as ((ok?: boolean) => void)[],
  readGate: null as Promise<void> | null,
  access: undefined as
    | undefined
    | { role: "owner"; editors: string[] }
    | { role: "viewer"; permissions: string[] },
}));

vi.mock("../../api.js", () => ({
  api: {
    connections: {
      updateAgentConnections: {
        mutate: (change: { grant: string[]; revoke: string[] }) => {
          server.writes.push({ grant: change.grant, revoke: change.revoke });
          return new Promise<void>((resolve, reject) => {
            server.release.push((ok = true) => {
              if (!ok) {
                reject(new Error("refused"));
                return;
              }
              const revoked = new Set(change.revoke);
              server.granted = [
                ...new Set([
                  ...server.granted.filter((id) => !revoked.has(id)),
                  ...change.grant,
                ]),
              ];
              resolve();
            });
          });
        },
      },
    },
  },
  wsClient: {},
}));
vi.mock("../../modules/processes/lib/ask-restart-after-save.js", () => ({
  askToRestartAfterSave: () => {},
}));
vi.mock("../../modules/agents/lib/agent-permissions.js", () => ({
  holds: (access: { role: string }, _p: string) => access.role === "owner",
}));
vi.mock("../../modules/connections/api/queries.js", () => ({
  useAgentPageConnections: () => ({
    data: [{ id: "c-gh" }, { id: "c-lin" }, { id: "c-slack" }],
    isPending: false,
    isError: false,
  }),
}));
vi.mock("../../modules/sandboxes/hooks/use-shared-channels.js", () => ({
  useSharedChannels: () => [],
}));
vi.mock(
  "../../modules/connections/hooks/use-confirm-shared-connection.js",
  () => ({
    useConfirmSharedConnection: () => ({
      notice: null,
      confirm: async () => true,
    }),
  }),
);
vi.mock("../../modules/agents/api/queries.js", async (importOriginal) => {
  const { trpc } = await import("../../trpc.js");
  return {
    ...(await importOriginal<object>()),
    useAgent: () => (server.access ? { access: server.access } : undefined),
    useAgentConnections: (agentId: string) =>
      useQuery({
        queryKey: trpc.connections.getAgentConnections.queryKey({ agentId }),
        queryFn: async () => {
          if (server.readGate) await server.readGate;
          return {
            connections: server.granted.map((connectionId) => ({
              connectionId,
              grantedAt: "2026-11-11T00:00:00Z",
              preferred: false,
            })),
          };
        },
        retry: false,
      }),
  };
});

const { queryClient } = await import("../../query-client.js");
const { useAgentConnectionGrants } =
  await import("../../modules/sandboxes/hooks/use-agent-connection-grants.js");

let host: HTMLDivElement;
let root: Root;
let grants: ReturnType<typeof useAgentConnectionGrants>;

function Probe() {
  grants = useAgentConnectionGrants("agent-a");
  return null;
}

async function render(node: ReactNode = createElement(Probe)) {
  await act(async () =>
    root.render(
      createElement(QueryClientProvider, { client: queryClient }, node),
    ),
  );
}

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function releaseNext(ok = true) {
  await act(async () => {
    server.release.shift()!(ok);
    await new Promise((r) => setTimeout(r, 0));
  });
  await settle();
}

beforeEach(() => {
  queryClient.clear();
  server.granted = ["c-gh"];
  server.readGate = null;
  server.writes = [];
  server.release = [];
  server.access = { role: "owner", editors: [] };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a grant or a revoke", () => {
  // TEST_SCENARIO: two switches flipped before the first write returns; each write sends only its own change, the second waits for the first, and the Agent ends with both.
  it("keeps the first of two quick changes", async () => {
    await render();
    await settle();
    expect([...grants.grantedIds]).toEqual(["c-gh"]);

    await act(async () => grants.toggleGrant("c-lin", true));
    await settle();
    await act(async () => grants.toggleGrant("c-slack", true));
    await settle();
    expect(server.writes).toEqual([{ grant: ["c-lin"], revoke: [] }]);
    expect([...grants.grantedIds].sort()).toEqual(["c-gh", "c-lin", "c-slack"]);

    await releaseNext();
    expect(server.writes).toEqual([
      { grant: ["c-lin"], revoke: [] },
      { grant: ["c-slack"], revoke: [] },
    ]);
    await releaseNext();
    expect(server.granted).toEqual(["c-gh", "c-lin", "c-slack"]);
    expect([...grants.grantedIds].sort()).toEqual(["c-gh", "c-lin", "c-slack"]);
  });

  // TEST_SCENARIO: a revoke right after a grant still on its way removes only the revoked Connection and keeps the new grant.
  it("revokes without dropping a pending grant", async () => {
    await render();
    await settle();
    await act(async () => grants.toggleGrant("c-lin", true));
    await settle();
    await act(async () => grants.toggleGrant("c-gh", false));
    await releaseNext();
    await releaseNext();
    expect(server.writes[server.writes.length - 1]).toEqual({
      grant: [],
      revoke: ["c-gh"],
    });
    expect(server.granted).toEqual(["c-lin"]);
  });

  // TEST_SCENARIO: the first of two chained grants fails; the second write carries only its own Connection, so the server never holds the failed one, and the shown list takes back the failed grant alone and keeps the second.
  it("drops only the failed change when the first write fails", async () => {
    await render();
    await settle();
    await act(async () => grants.toggleGrant("c-lin", true));
    await settle();
    await act(async () => grants.toggleGrant("c-slack", true));
    await settle();

    await releaseNext(false);
    expect(server.writes[1]).toEqual({ grant: ["c-slack"], revoke: [] });
    expect([...grants.grantedIds].sort()).toEqual(["c-gh", "c-slack"]);
    await releaseNext();
    expect(server.granted).toEqual(["c-gh", "c-slack"]);
    expect([...grants.grantedIds].sort()).toEqual(["c-gh", "c-slack"]);
  });

  // TEST_SCENARIO: a failed revoke puts the Connection back in the shown list, and the server still holds it.
  it("shows a Connection again when its revoke fails", async () => {
    await render();
    await settle();
    await act(async () => grants.toggleGrant("c-gh", false));
    await settle();
    expect(grants.grantedIds.has("c-gh")).toBe(false);
    await releaseNext(false);
    expect(server.granted).toEqual(["c-gh"]);
    expect([...grants.grantedIds]).toEqual(["c-gh"]);
  });
});

describe("who may change the grants", () => {
  // TEST_SCENARIO: the Agent's access has not loaded yet, so the hook offers no change; once it loads as the owner's it does.
  it("offers no change before the Agent's access loads", async () => {
    server.access = undefined;
    await render();
    await settle();
    expect(grants.managesConnections).toBe(false);
    server.access = { role: "owner", editors: [] };
    await render();
    expect(grants.managesConnections).toBe(true);
  });
});

describe("the grant read", () => {
  // TEST_SCENARIO: the Agent's grants are still loading, so the hook says it has not loaded and holds no grant yet; once they arrive it holds the Agent's grants.
  it("reports loading until the grants arrive", async () => {
    let open = () => {};
    server.readGate = new Promise<void>((r) => (open = r));
    await render();
    expect(grants.loaded).toBe(false);
    expect(grants.grantedIds.size).toBe(0);
    open();
    server.readGate = null;
    await act(async () => {
      await vi.waitFor(() => expect(grants.loaded).toBe(true));
    });
    expect([...grants.grantedIds]).toEqual(["c-gh"]);
  });
});
