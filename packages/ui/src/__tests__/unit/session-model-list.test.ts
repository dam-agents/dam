// @vitest-environment happy-dom
// TEST_OVERVIEW: The family menu shows one entry per size on its newest version, More expands the older versions, and picking an entry hands the runtime the same provider-qualified model name it handed before the menu was grouped.
import type { CatalogModelView } from "agent-runtime-api";
import { createElement, Fragment, type PropsWithChildren } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("../../modules/agents/hooks/use-operable-state.js", () => ({
  useOperableState: () => ({ operable: true, comingUp: false }),
}));

vi.mock("@/components/ui/popover", () => {
  const passthrough = ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children);
  return { PopoverClose: passthrough };
});

import { SessionModelList } from "../../modules/sessions/components/session-model-list.js";
import type { ModelGroup } from "../../modules/sessions/lib/catalog-groups.js";

const model = (
  name: string,
  contextWindow: number | null,
): CatalogModelView => ({
  name,
  upstreamId: name.slice(name.indexOf("/") + 1),
  contextWindow,
  maxOutputTokens: null,
  reasoning: null,
  vision: null,
  prices: null,
  source: { limits: "none", prices: "none" },
});

const ibm: ModelGroup = {
  connectionId: "ibm",
  alias: "ibm",
  displayName: "IBM",
  status: "listed",
  listedAt: null,
  native: false,
  models: [
    model("ibm/aws/claude-opus-5-5", 200_000),
    model("ibm/aws/claude-opus-5-1", 200_000),
    model("ibm/azure/gpt-5.5", 1_100_000),
    model("ibm/rits/zai-org/glm-5-3", 128_000),
  ],
};
const anthropic: ModelGroup = {
  connectionId: "anthropic",
  alias: "anthropic",
  displayName: "Anthropic",
  status: "listed",
  listedAt: null,
  native: false,
  models: [model("anthropic/claude-opus-5-5", 1_000_000)],
};

let cleanup: (() => void) | undefined;
afterEach(() => {
  act(() => cleanup?.());
  cleanup = undefined;
});

function render(
  onChoose: (model: string, group: ModelGroup) => void,
  current: string | null = null,
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      createElement(SessionModelList, {
        groups: [ibm, anthropic],
        current,
        loading: false,
        failed: false,
        operable: true,
        onRetry: () => {},
        onChoose,
      }),
    ),
  );
  cleanup = () => {
    root.unmount();
    container.remove();
  };
  const buttons = () =>
    [...container.querySelectorAll("button")] as HTMLButtonElement[];
  return { container, buttons };
}

const click = (button: HTMLButtonElement) =>
  act(() => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));

// TEST_SCENARIO: The newest Opus is shown alone with a provider choice; More reveals the older Opus, and picking the entry passes the chosen provider's model name and group unchanged.
it("shows the newest size, expands the older versions and picks its model", () => {
  const onChoose = vi.fn();
  const { container, buttons } = render(onChoose);

  expect(container.textContent).not.toContain("Opus 5.1");
  expect(
    container.querySelector('[aria-label="Provider for Opus 5.5: IBM"]'),
  ).not.toBeNull();

  const newest = buttons().find((b) => b.textContent?.startsWith("Opus 5.5"));
  expect(newest).toBeDefined();
  click(newest!);
  expect(onChoose).toHaveBeenCalledWith("ibm/aws/claude-opus-5-5", ibm);

  const more = buttons().find((b) => b.textContent?.trim() === "More");
  expect(more).toBeDefined();
  click(more!);
  const older = buttons().find((b) => b.textContent?.startsWith("Opus 5.1"));
  expect(older).toBeDefined();
  click(older!);
  expect(onChoose).toHaveBeenCalledWith("ibm/aws/claude-opus-5-1", ibm);
});

// TEST_SCENARIO: A model of no known family is an entry under Other, and the menu no longer offers a provider disconnect.
it("puts an unknown family under Other and offers no disconnect", () => {
  const { container } = render(() => {});
  const sections = [...container.querySelectorAll("section")].map((s) =>
    s.getAttribute("aria-label"),
  );
  expect(sections).toEqual(["Claude", "GPT", "Other"]);
  expect(container.textContent).toContain("rits/zai-org/glm-5-3");
  expect(container.textContent).not.toContain("Disconnect");
});

// TEST_SCENARIO: A model of a known family with no recognised size stays behind that family's More.
it("keeps a known family's unrecognised model behind More", () => {
  const { container } = render(() => {});
  const gpt = container.querySelector('section[aria-label="GPT"]')!;
  expect(gpt.textContent).not.toContain("azure/gpt-5.5");
  const more = [...gpt.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === "More",
  );
  click(more!);
  expect(gpt.textContent).toContain("azure/gpt-5.5");
});

// TEST_SCENARIO: A session on an older version opens that family expanded, so the current model is visible without opening More first.
it("opens the family of the current older model", () => {
  const { container } = render(() => {}, "ibm/aws/claude-opus-5-1");
  expect(container.textContent).toContain("Opus 5.1");
  expect(container.textContent).toContain("Less");
});
