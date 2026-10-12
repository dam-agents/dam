// TEST_OVERVIEW: a mutation with meta.invalidates stays pending until the invalidated queries have refetched, so a view that shows the pending value never falls back to the stale cache in between.
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
