// TEST_OVERVIEW: regaining a tab's focus refetches no query that did not ask for it, and a reconnect refetches the ACP Session data no event stream resyncs while it only marks the rest of the cache stale, so neither event fans out into a refetch of everything on screen.
import {
  focusManager,
  type QueryKey,
  QueryObserver,
  type QueryObserverOptions,
} from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

vi.stubGlobal("window", new EventTarget());
vi.stubGlobal("navigator", { onLine: true });
const { queryClient } = await import("../../query-client.js");
const { acpSessionsKeys } = await import("../../modules/sessions/api/keys.js");
const { onFetchError, onFetchSuccess } =
  await import("../../lib/api-health.js");

const unsubscribes: (() => void)[] = [];

afterEach(() => {
  unsubscribes.splice(0).forEach((off) => off());
  queryClient.clear();
  focusManager.setFocused(undefined);
});

function watch(
  queryKey: QueryKey,
  options: Partial<QueryObserverOptions> = {},
) {
  let calls = 0;
  unsubscribes.push(
    new QueryObserver(queryClient, {
      queryKey,
      queryFn: () => Promise.resolve(++calls),
      ...options,
    }).subscribe(() => {}),
  );
  return {
    calls: () => calls,
    loaded: () =>
      vi.waitFor(() =>
        expect(queryClient.getQueryState(queryKey)?.status).toBe("success"),
      ),
  };
}

// TEST_SCENARIO: a tab comes back into view. A stale query on screen must keep the data it has and not fetch again, while a query that asks for a focus refetch still runs one, which proves the focus event reached the observers.
it("refetches nothing on window focus unless the query asks for it", async () => {
  queryClient.mount();
  const quiet = watch(["focus-quiet"], { staleTime: 0 });
  const asked = watch(["focus-asked"], { refetchOnWindowFocus: "always" });
  await quiet.loaded();
  await asked.loaded();

  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await vi.waitFor(() => expect(asked.calls()).toBe(2));

  expect(quiet.calls()).toBe(1);
});

// TEST_SCENARIO: the API connection drops and comes back. The ACP Session data, which no live-event stream resyncs, must refetch at once; an unrelated stale query must keep reading what it has until something asks for it again.
it("refetches the ACP Session data on reconnect and leaves the rest stale", async () => {
  queryClient.mount();
  const sessions = watch(acpSessionsKeys.pagesOf("agent-a", []), {
    staleTime: 0,
  });
  const other = watch(["reconnect-other"], { staleTime: 0 });
  await sessions.loaded();
  await other.loaded();

  onFetchError();
  onFetchError();
  onFetchSuccess();
  await vi.waitFor(() => expect(sessions.calls()).toBe(2));

  expect(other.calls()).toBe(1);
  expect(queryClient.getQueryState(["reconnect-other"])?.isInvalidated).toBe(
    true,
  );
});
