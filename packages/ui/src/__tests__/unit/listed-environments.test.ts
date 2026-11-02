// @vitest-environment happy-dom
// TEST_OVERVIEW: The Artifacts list and page read the owner's Environments through one hook, which says whether they are still loading, failed with nothing to show, or settled. So the list never shows "No artifacts yet." or the page's introduction while the Environments are still on their way, and a failed load is offered a retry instead of an empty list.
import {
  QueryClient,
  QueryClientProvider,
  skipToken,
} from "@tanstack/react-query";
import { act, createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  features: { environments: true } as { environments: boolean } | undefined,
  listAll: (() => new Promise(() => {})) as () => Promise<unknown>,
}));

vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({
    data: state.features,
    isPending: state.features === undefined,
  }),
}));
vi.mock("../../trpc.js", () => ({
  trpc: {
    environments: {
      listAll: {
        queryOptions: (input: unknown) => ({
          queryKey: ["environments", "listAll"],
          queryFn: input === skipToken ? skipToken : () => state.listAll(),
        }),
      },
    },
  },
}));

const { useListedEnvironments } =
  await import("../../modules/environments/api/queries.js");

type Listed = ReturnType<typeof useListedEnvironments>;

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

// UNIT_BOUNDARY_DESCRIPTION: the hook's latest answer, read by a component mounted with a client that never retries, so a failure settles at once.
async function listed(): Promise<() => Listed> {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let last: Listed | undefined;
  function Probe() {
    const value = useListedEnvironments(true);
    useEffect(() => {
      last = value;
    });
    return null;
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  root = createRoot(document.body.appendChild(document.createElement("div")));
  await act(async () =>
    root!.render(
      createElement(QueryClientProvider, { client }, createElement(Probe)),
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return () => last!;
}

describe("the owner's Environments as a list reads them", () => {
  // TEST_SCENARIO: while the Environments are on their way the list reads as loading, never as empty.
  it("reads as loading while the query is pending", async () => {
    state.features = { environments: true };
    state.listAll = () => new Promise(() => {});
    const read = await listed();

    expect(read()).toMatchObject({ loading: true, failed: false, data: [] });
  });

  // TEST_SCENARIO: while the feature flags themselves load, the list does not yet know whether there are Environments, so it reads as loading.
  it("reads as loading while the features load", async () => {
    state.features = undefined;
    const read = await listed();

    expect(read().loading).toBe(true);
  });

  // TEST_SCENARIO: a failed load with nothing to show reads as failed, so the list offers a retry instead of saying there is nothing.
  it("reads as failed when the query failed with no data", async () => {
    state.features = { environments: true };
    state.listAll = () => Promise.reject(new Error("down"));
    const read = await listed();

    expect(read()).toMatchObject({ loading: false, failed: true });
  });

  // TEST_SCENARIO: with the feature off there are no Environments to wait for: the list is settled and empty.
  it("is settled and empty with the feature off", async () => {
    state.features = { environments: false };
    const read = await listed();

    expect(read()).toMatchObject({ loading: false, failed: false, data: [] });
  });

  // TEST_SCENARIO: a settled load gives the Environments, neither loading nor failed.
  it("gives the Environments once loaded", async () => {
    state.features = { environments: true };
    state.listAll = () => Promise.resolve([{ id: "agent-demo" }]);
    const read = await listed();

    expect(read()).toMatchObject({
      loading: false,
      failed: false,
      data: [{ id: "agent-demo" }],
    });
  });
});
