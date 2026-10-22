// TEST_OVERVIEW: The Files panel lists the agent's home directory only while it is expanded, so a collapsed panel costs the agent no listing.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const queries = vi.hoisted(
  () => [] as { queryKey: unknown[]; enabled: boolean }[],
);
vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: undefined,
  useQuery: (options: { queryKey: unknown[]; enabled: boolean }) => {
    queries.push(options);
    return { data: undefined, isPending: true };
  },
  useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useQueryClient: () => ({}),
}));
vi.mock("../../query-client.js", () => ({ queryClient: {} }));
vi.mock("../../api.js", () => ({ api: {} }));
vi.mock("../../trpc.js", () => ({ trpc: {} }));
vi.mock("../../modules/agents/agent-trpc.js", () => ({
  agentTrpc: vi.fn(),
  agentTrpcHttp: vi.fn(),
}));
vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => false,
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  agentLacksLiveUpdates: () => false,
  useAgentLacksLiveUpdates: () => false,
  useIsAgentOperable: () => true,
}));
vi.mock("../../store.js", () => {
  const state: Record<string, unknown> = {
    selectedAgent: "agent-a",
    expandedDirs: {},
    showHiddenFiles: false,
    openFilePath: null,
  };
  const store = new Proxy(state, {
    get: (target, key: string) => (key in target ? target[key] : vi.fn()),
  });
  return { useStore: (select: (s: typeof store) => unknown) => select(store) };
});

const { FilesPanel } =
  await import("../../modules/files/components/files-panel.js");

function listingEnabled(open: boolean) {
  queries.length = 0;
  renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(FilesPanel, {
        open,
        onToggle: () => {},
        onOpenFile: () => {},
      }),
    ),
  );
  return queries
    .filter((q) => q.queryKey.includes("tree"))
    .some((q) => q.enabled);
}

it("does not list files while the panel is collapsed", () => {
  expect(listingEnabled(false)).toBe(false);
});

it("lists files once the panel is expanded", () => {
  expect(listingEnabled(true)).toBe(true);
});
