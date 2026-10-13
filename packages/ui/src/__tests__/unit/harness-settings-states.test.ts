import type { HarnessConfigCurrent } from "agent-runtime-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

import { HarnessSettingsSections } from "../../modules/sandboxes/components/harness-settings-sections.js";

const state = vi.hoisted(() => ({
  values: undefined as HarnessConfigCurrent | undefined,
  loading: false,
  error: false,
}));
vi.mock("@tanstack/react-query", () => ({
  skipToken: Symbol(),
  useQuery: (options: { queryKey: string[] }) =>
    options.queryKey[0] === "harness-config-current"
      ? {
          data: state.values,
          isLoading: state.loading,
          isError: state.error,
          refetch: vi.fn(),
        }
      : { data: { snapshot: null }, isLoading: false, refetch: vi.fn() },
}));
vi.mock("../../trpc.js", () => ({
  trpc: {
    harnessConfig: {
      snapshot: { queryOptions: () => ({ queryKey: ["snapshot"] }) },
    },
  },
}));
vi.mock("../../query-client.js", () => ({
  queryClient: { invalidateQueries: vi.fn() },
}));
vi.mock("../../modules/agents/agent-trpc.js", () => ({
  agentTrpc: vi.fn(),
  agentTrpcHttp: vi.fn(),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useIsAgentOperable: () => true,
  useAgentLacksLiveUpdates: () => true,
}));
vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useApplyHarnessConfig: () => ({ mutate: vi.fn() }),
}));
vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useHarnessCatalog: () => ({
    data: { harnesses: [{ name: "claude-code", displayName: "Claude" }] },
  }),
}));

function render() {
  return renderToStaticMarkup(
    createElement(HarnessSettingsSections, {
      agentId: "agent",
      harnesses: [
        {
          name: "claude-code",
          harnessConfig: true,
          sessionModel: true,
          harnessConfigCatalog: {
            options: [
              {
                id: "effort",
                name: "Effort",
                category: "config",
                default: "medium",
                choices: [
                  { value: "medium", name: "Medium" },
                  { value: "high", name: "High" },
                ],
              },
            ],
          },
        },
      ],
    }),
  );
}

beforeEach(() => {
  state.values = undefined;
  state.loading = false;
  state.error = false;
});

it("does not show unset defaults while settings are loading or unavailable", () => {
  state.loading = true;
  expect(render()).toContain("Loading settings…");
  expect(render()).not.toContain('aria-label="Claude Effort"');
  state.loading = false;
  state.error = true;
  expect(render()).toContain("Settings unavailable.");
  expect(render()).toContain("Retry");
  expect(render()).not.toContain("Harness default");
});

it("shows the catalog default for an unset value, and an unlisted saved value verbatim", () => {
  state.values = { model: null, mode: null, configOptions: {} };
  expect(render()).not.toContain("Harness default");
  expect(render()).toContain(">Medium<");
  state.values.configOptions.effort = "custom-effort";
  expect(render()).toContain("custom-effort");
});
