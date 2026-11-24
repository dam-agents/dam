// TEST_OVERVIEW: a mutation with meta.invalidates stays pending until the invalidated queries have refetched, so a view that shows the pending value never falls back to the stale cache in between. A mutation with an onSuccess of its own still refetches them.
import { MutationObserver, QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";

// TEST_SCENARIO: the refetch is held open; the mutation must not settle before it resolves, and the cache must already hold the new value when it does.
it("settles a mutation only after its invalidated queries refetch", async () => {
  vi.stubGlobal("window", new EventTarget());
  const { queryClient } = await import("../../query-client.js");
  const key = ["mutation-invalidation-test"];
  let server = "old";
  let releaseRefetch = () => {};
  const unsubscribe = new QueryObserver(queryClient, {
    queryKey: key,
    queryFn: () =>
      server === "old"
        ? server
        : new Promise<string>((resolve) => {
            releaseRefetch = () => resolve(server);
          }),
  }).subscribe(() => {});
  await queryClient.refetchQueries({ queryKey: key });

  const mutation = new MutationObserver(queryClient, {
    mutationFn: async () => {
      server = "new";
    },
    meta: { invalidates: [key] },
  });
  let settled = false;
  const done = mutation.mutate().then(() => {
    settled = true;
  });
  await new Promise((r) => setTimeout(r, 20));
  expect(settled).toBe(false);
  expect(mutation.getCurrentResult().isPending).toBe(true);

  releaseRefetch();
  await done;
  expect(queryClient.getQueryData(key)).toBe("new");
  unsubscribe();
});

// TEST_SCENARIO: the feature switch has its own onSuccess. Its flags query must still refetch after the save, or the switch keeps showing the old value.
it("refetches the invalidated queries of a mutation with its own onSuccess", async () => {
  vi.stubGlobal("window", new EventTarget());
  const { queryClient } = await import("../../query-client.js");
  const key = ["mutation-invalidation-own-on-success-test"];
  let server = "old";
  const unsubscribe = new QueryObserver(queryClient, {
    queryKey: key,
    queryFn: () => server,
    staleTime: Infinity,
  }).subscribe(() => {});
  await queryClient.refetchQueries({ queryKey: key });

  const ownOnSuccess = vi.fn();
  const mutation = new MutationObserver<void, Error, void>(queryClient, {
    mutationFn: async () => {
      server = "new";
    },
    onSuccess: ownOnSuccess,
    meta: { invalidates: [key] },
  });
  await mutation.mutate();

  expect(ownOnSuccess).toHaveBeenCalledOnce();
  expect(queryClient.getQueryData(key)).toBe("new");
  unsubscribe();
});
