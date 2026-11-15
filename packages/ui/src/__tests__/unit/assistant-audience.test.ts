// @vitest-environment happy-dom
// TEST_OVERVIEW: the CurveBender notice's audience is an answer that can be stale:
// TEST_OVERVIEW: a person who has just turned the assistant on still has this tab
// TEST_OVERVIEW: holding "no assistant", and a background refetch keeps that answer
// TEST_OVERVIEW: until the new one lands. So an absent record counts only when
// TEST_OVERVIEW: nothing is in flight for it, and switching the assistant on drops
// TEST_OVERVIEW: what the tab was told. The probe below holds a mounted query on the
// TEST_OVERVIEW: very key the app reads, with a function the test controls, so the
// TEST_OVERVIEW: pending, delayed and settled answers are the real ones a tab sees.
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  assistantAudienceKnown,
  forgetAssistantState,
} from "../../modules/assistants/api/assistant-state.js";
import { curveBenderNotice } from "../../modules/sessions/lib/curve-bender.js";
import { queryClient } from "../../query-client.js";
import { trpc } from "../../trpc.js";

const STATE_KEY = () => trpc.assistants.state.queryKey();
const legacyRecord = {
  agentId: "agent-dammy",
  legacy: true,
  used: false,
  resetAt: null,
};

let answer: () => Promise<unknown>;
const seen: ReturnType<typeof assistantAudienceKnown>[] = [];
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function Probe() {
  const query = useQuery({
    queryKey: STATE_KEY(),
    queryFn: () => answer(),
    select: (state) => state as typeof legacyRecord | null,
  });
  seen.push(assistantAudienceKnown(query));
  return null;
}

function paint() {
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe),
      ),
    ),
  );
}

const audience = () => seen[seen.length - 1];

function deferred() {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  queryClient.clear();
  seen.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  answer = async () => null;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  queryClient.clear();
  vi.unstubAllGlobals();
});

describe("whether the notice's audience is settled", () => {
  // TEST_SCENARIO: while the record is still being read, nothing is decided — the notice waits rather than showing and vanishing.
  it("knows nothing while the first read is out", () => {
    answer = () => deferred().promise;
    paint();
    expect(audience()).toBe(false);
  });

  // TEST_SCENARIO: a read that answered "no assistant" is believed, and the notice keeps the audience it always had.
  it("believes an absent record once it is settled", async () => {
    paint();
    await vi.waitFor(() => expect(audience()).toBe(true));
  });

  // TEST_SCENARIO: the person turns the assistant on, so the tab drops the "no assistant" it held and reads the record being written; the notice stays away for that whole read and is decided by what it finds.
  it("drops the answer when the assistant is switched on", async () => {
    paint();
    await vi.waitFor(() => expect(audience()).toBe(true));

    const next = deferred();
    answer = () => next.promise;
    act(() => forgetAssistantState());
    expect(queryClient.getQueryData(STATE_KEY())).toBeUndefined();
    await vi.waitFor(() =>
      expect(queryClient.isFetching({ queryKey: STATE_KEY() })).toBe(1),
    );
    await vi.waitFor(() => expect(audience()).toBe(false));

    act(() => next.resolve({ ...legacyRecord, legacy: false }));
    await vi.waitFor(() => expect(audience()).toBe(true));
  });

  // TEST_SCENARIO: a background refetch holds the old answer until the new one lands — the case a switched-on assistant leaves behind — so the notice stays away during the gap and is decided by the record afterwards.
  it("withholds an absent record while a refresh is in flight", async () => {
    paint();
    await vi.waitFor(() => expect(audience()).toBe(true));

    const next = deferred();
    answer = () => next.promise;
    act(() => {
      void queryClient.invalidateQueries({ queryKey: STATE_KEY() });
    });
    await vi.waitFor(() =>
      expect(queryClient.isFetching({ queryKey: STATE_KEY() })).toBe(1),
    );
    await vi.waitFor(() => expect(audience()).toBe(false));

    act(() => next.resolve(legacyRecord));
    await vi.waitFor(() => expect(audience()).toBe(true));
  });

  // TEST_SCENARIO: a record that is there is no longer enough either: another tab deleted the assistant and had it made again, so the id this tab holds is the old Agent's, and the notice would show in the new one's chat. The record is withheld from until the read lands, then believed again.
  it("withholds a record that is there while it refreshes", async () => {
    answer = async () => legacyRecord;
    paint();
    await vi.waitFor(() => expect(audience()).toBe(true));

    const next = deferred();
    answer = () => next.promise;
    act(() => {
      void queryClient.invalidateQueries({ queryKey: STATE_KEY() });
    });
    await vi.waitFor(() =>
      expect(queryClient.isFetching({ queryKey: STATE_KEY() })).toBe(1),
    );
    await vi.waitFor(() => expect(audience()).toBe(false));

    act(() => next.resolve({ ...legacyRecord, agentId: "agent-dammy-2" }));
    await vi.waitFor(() => expect(audience()).toBe(true));
    expect(
      queryClient.getQueryData<typeof legacyRecord>(STATE_KEY())?.agentId,
    ).toBe("agent-dammy-2");
  });
});

describe("the notice with that audience", () => {
  const shared = {
    id: "cb",
    name: "CurveBender",
    type: "curve-bender",
  } as never;
  const chat = {
    sessionId: null,
    pairSettled: true,
    agentId: "agent-mine",
    pair: null,
  };

  // TEST_SCENARIO: an audience that is not settled shows nothing at all, whether the tab last held a record, none, or nothing.
  it("shows nothing while the audience is unread", () => {
    for (const assistant of [legacyRecord, null])
      expect(
        curveBenderNotice({
          ...chat,
          shared,
          assistant,
          assistantKnown: false,
        }),
      ).toBeNull();
  });

  // TEST_SCENARIO: once settled, the record decides: an account here before the assistant is told, one onboarded with it is not.
  it("decides by the settled record", () => {
    expect(
      curveBenderNotice({
        ...chat,
        shared,
        assistant: legacyRecord,
        assistantKnown: true,
      }),
    ).toBe("offer");
    expect(
      curveBenderNotice({
        ...chat,
        shared,
        assistant: { ...legacyRecord, legacy: false },
        assistantKnown: true,
      }),
    ).toBeNull();
  });
});
