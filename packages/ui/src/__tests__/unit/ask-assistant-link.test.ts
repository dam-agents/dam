// @vitest-environment happy-dom
// TEST_OVERVIEW: The link that asks the assistant about a failure. It is a button inside other clickable surfaces, such as a schedule card in the Agent settings modal, so its click must not reach the surface around it: the link opens the assistant's chat itself, and the modal or row must not navigate first.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ ask: vi.fn(), outer: vi.fn() }));

vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: () => ({ id: "agent-1", name: "Scout" }),
}));
vi.mock("../../modules/assistants/hooks/use-ask-assistant.js", () => ({
  useAskAssistant: () => ({
    offered: () => true,
    label: "Ask Dammy",
    ask: fake.ask,
  }),
}));

const { AskAssistantLink } =
  await import("../../modules/assistants/components/ask-assistant-link.js");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

it("asks without letting the click reach the surface around it", () => {
  act(() =>
    root.render(
      createElement(
        "div",
        { onClick: fake.outer },
        createElement(AskAssistantLink, {
          agentId: "agent-1",
          prefill: "why did it fail?",
        }),
      ),
    ),
  );

  const button = container.querySelector("button");
  expect(button?.textContent).toBe("Ask Dammy");
  act(() => button?.click());

  expect(fake.ask).toHaveBeenCalledWith("why did it fail?");
  expect(fake.outer).not.toHaveBeenCalled();
});
