// @vitest-environment happy-dom
// TEST_OVERVIEW: whether the chat's Show changes button exists. It shows only once the change set list has answered that the agent has a repository, never while the answer is pending; a later pending answer for the same agent keeps the last settled one, so a switch of session does not make it blink, and another agent's answer never carries over.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const answer: {
  data: { changeSets: unknown[] } | undefined;
  isPlaceholderData: boolean;
} = { data: undefined, isPlaceholderData: false };

vi.mock("../../modules/changes/api/queries.js", () => ({
  useChangeSets: () => answer,
}));
vi.mock("../../modules/changes/hooks/use-changes-watch.js", () => ({
  useChangesWatch: () => {},
}));

const { useChangesAvailable } =
  await import("../../modules/changes/hooks/use-changes-available.js");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let shown: boolean | null = null;

function Probe({ agentId }: { agentId: string }) {
  shown = useChangesAvailable(agentId, null);
  return null;
}
const render = (agentId: string) =>
  act(() => root.render(createElement(Probe, { agentId })));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  answer.data = undefined;
  answer.isPlaceholderData = false;
  host = document.createElement("div");
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

describe("the Show changes button", () => {
  // TEST_SCENARIO: the list has not answered yet, so the button is not drawn; once it answers with a repository, it is.
  it("waits for the answer before it shows", () => {
    render("agent-a");
    expect(shown).toBe(false);
    answer.data = { changeSets: [{}] };
    render("agent-a");
    expect(shown).toBe(true);
  });

  // TEST_SCENARIO: the list answers that the agent has no repository, so the button never shows.
  it("stays away for an agent with no repository", () => {
    answer.data = { changeSets: [] };
    render("agent-a");
    expect(shown).toBe(false);
  });

  // TEST_SCENARIO: the same agent's next answer is pending, as after a switch of session, so the last settled one stands and the button does not blink.
  it("keeps the last answer for the same agent while the next loads", () => {
    answer.data = { changeSets: [{}] };
    render("agent-a");
    answer.isPlaceholderData = true;
    render("agent-a");
    expect(shown).toBe(true);
  });

  // TEST_SCENARIO: another agent's list stands in while the new agent's loads, so the first agent's answer is not carried over.
  it("does not carry an answer over to another agent", () => {
    answer.data = { changeSets: [{}] };
    render("agent-a");
    answer.isPlaceholderData = true;
    render("agent-b");
    expect(shown).toBe(false);
  });
});
