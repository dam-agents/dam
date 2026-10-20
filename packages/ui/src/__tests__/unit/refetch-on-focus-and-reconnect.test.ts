// TEST_OVERVIEW: regaining a tab's focus refetches no query that did not ask for it, and a reconnect refetches the ACP Session data no event stream resyncs while it only marks the rest of the cache stale, so neither event fans out into a refetch of everything on screen.
import {
  focusManager,
  onlineManager,
  type QueryKey,
  QueryObserver,
} from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";

vi.stubGlobal("window", new EventTarget());
vi.stubGlobal("navigator", { onLine: true });
const { queryClient } = await import("../../query-client.js");
const { acpSessionsKeys } = await import("../../modules/sessions/api/keys.js");
const { onFetchError, onFetchSuccess } =
  await import("../../lib/api-health.js");
const { telegramChatsQueryOptions } =
  await import("../../modules/telegram/api/queries.js");

const unsubscribes: (() => void)[] = [];

afterEach(() => {
  unsubscribes.splice(0).forEach((off) => off());
  queryClient.clear();
  focusManager.setFocused(undefined);
});

function watch<O extends { queryKey: QueryKey }>(options: O) {
  const { queryKey } = options;
  let calls = 0;
  unsubscribes.push(
    new QueryObserver(queryClient, {
      ...options,
      queryFn: () => Promise.resolve(++calls),
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
  const quiet = watch({ queryKey: ["focus-quiet"], staleTime: 0 });
  const asked = watch({
    queryKey: ["focus-asked"],
    refetchOnWindowFocus: "always",
  });
  await quiet.loaded();
  await asked.loaded();

  focusManager.setFocused(false);
  focusManager.setFocused(true);
  await vi.waitFor(() => expect(asked.calls()).toBe(2));

  expect(quiet.calls()).toBe(1);
});

// TEST_SCENARIO: the API connection drops and comes back a moment later, while the ACP Session data is still fresh by its 5 s staleTime. That data must refetch anyway, because no live-event stream resyncs it and the session watch replays nothing; an unrelated stale query must keep reading what it has until something asks for it again.
it("refetches the ACP Session data on reconnect even while it is fresh, and leaves the rest stale", async () => {
  queryClient.mount();
  const sessions = watch({
    queryKey: acpSessionsKeys.pagesOf("agent-a", []),
    staleTime: 5_000,
  });
  const other = watch({ queryKey: ["reconnect-other"], staleTime: 0 });
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

// TEST_SCENARIO: the connection goes down and comes straight back, with no stale marking in between. A fresh ACP Session query must still refetch, so the heal cannot rest on the order of the stale marking and the online transition in the same listener.
it("refetches a fresh ACP Session query on an online transition", async () => {
  queryClient.mount();
  const sessions = watch({
    queryKey: acpSessionsKeys.pagesOf("agent-a", []),
    staleTime: 5_000,
  });
  await sessions.loaded();

  onlineManager.setOnline(false);
  onlineManager.setOnline(true);

  await vi.waitFor(() => expect(sessions.calls()).toBe(2));
});

// TEST_SCENARIO: a family whose data changes outside this screen, and which carries no stream and no poll, must re-read itself on a reconnect. Telegram chats keep their own refetch-on-reconnect option, because the reconnected stream carries no topic for them.
it("refetches a family with no stream on reconnect", async () => {
  queryClient.mount();
  const chats = watch(telegramChatsQueryOptions("agent-a"));
  await chats.loaded();

  onlineManager.setOnline(false);
  onlineManager.setOnline(true);

  await vi.waitFor(() => expect(chats.calls()).toBe(2));
});
