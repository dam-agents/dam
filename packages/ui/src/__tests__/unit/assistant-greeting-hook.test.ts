// @vitest-environment happy-dom
// TEST_OVERVIEW: the greeting hook decides on the Agent's kind before it asks
// TEST_OVERVIEW: anything about the assistant: an Agent that is not an assistant
// TEST_OVERVIEW: answers "none" at once, even while the assistant's own record is
// TEST_OVERVIEW: still on its way, so no ordinary chat ever waits on the
// TEST_OVERVIEW: assistant or blanks; the assistant's own chat answers "loading"
// TEST_OVERVIEW: meanwhile, and "none" once a loaded record names no assistant.
import { QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  kind: "assistant" as "assistant" | "knowledge-base" | null,
  pending: true,
  row: true,
}));

vi.mock("../../modules/agents/api/queries.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAgent: (agentId: string | null) =>
    fakes.kind === null ? null : { id: agentId, kind: fakes.kind },
}));
vi.mock(
  "../../modules/assistants/api/assistant-state.js",
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useAssistantOn: () => true,
    useAssistantState: () => ({
      isPending: fakes.pending,
      data: fakes.pending
        ? undefined
        : fakes.row
          ? { agentId: "a-1", used: false, notice: null }
          : null,
    }),
  }),
);

const { useAssistantGreeting } =
  await import("../../modules/assistants/hooks/use-assistant-greeting.js");
const { queryClient } = await import("../../query-client.js");

const seen: { kind: string }[] = [];

function Probe() {
  seen.push(useAssistantGreeting("a-1"));
  return null;
}

let host: HTMLDivElement;
let root: Root;

function render(): { kind: string } {
  seen.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(Probe),
      ),
    ),
  );
  return seen[seen.length - 1]!;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fakes.kind = "assistant";
  fakes.pending = true;
  fakes.row = true;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("the greeting hook's first question", () => {
  // TEST_SCENARIO: a person's ordinary agent opens while the assistant's record is still loading; it is not an assistant, so nothing about the assistant holds its chat back and the ordinary empty page shows.
  it("answers none for another kind of agent while the assistant's record loads", () => {
    fakes.kind = "knowledge-base";
    expect(render()).toEqual({ kind: "none" });
  });

  // TEST_SCENARIO: the same while the agent list has not named the agent yet: an unknown kind is no assistant, so that chat is not held back either.
  it("answers none while the agent's own kind is unknown", () => {
    fakes.kind = null;
    expect(render()).toEqual({ kind: "none" });
  });

  // TEST_SCENARIO: the assistant's own chat waits for its record rather than showing a page it would take back a moment later.
  it("answers loading for the assistant while its record is in flight", () => {
    expect(render()).toEqual({ kind: "loading" });
  });

  // TEST_SCENARIO: a loaded record that names no assistant is final: the assistant-looking chat shows its ordinary empty page.
  it("answers none when the loaded record names no assistant", () => {
    fakes.pending = false;
    fakes.row = false;
    expect(render()).toEqual({ kind: "none" });
  });
});
