// @vitest-environment happy-dom
// TEST_OVERVIEW: Settings › Experimental features offers "Reset user onboarding"
// TEST_OVERVIEW: wherever the person has the assistant — including an install that
// TEST_OVERVIEW: pins the feature on, where the tab hides the switch — and nowhere
// TEST_OVERVIEW: else. The mode decides the feature, never the visibility of its row.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  assistantOn: true,
  features: { dambledore: "experimental" as "on" | "off" | "experimental" },
}));

vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: {} }),
  useInstallCapabilities: () => ({ data: { features: fakes.features } }),
  useSetFeature: () => ({ mutate: () => {} }),
}));
vi.mock("../../modules/assistants/api/assistant-state.js", () => ({
  useAssistantOn: () => fakes.assistantOn,
}));
vi.mock(
  "../../modules/assistants/components/assistant-onboarding-reset.js",
  () => ({
    AssistantOnboardingReset: () =>
      createElement("div", { "data-testid": "assistant-reset" }),
  }),
);
vi.mock(
  "../../modules/getting-started/components/reset-onboarding-card.js",
  () => ({
    ResetOnboardingCard: () => null,
  }),
);

const { FeaturesTab } =
  await import("../../modules/features/components/features-tab.js");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  fakes.assistantOn = true;
  fakes.features = { dambledore: "experimental" };
});

function render(): { assistantRow: boolean; reset: boolean } {
  act(() => root.render(createElement(FeaturesTab)));
  return {
    assistantRow:
      host.textContent?.includes("Smart assistant that can control") ?? false,
    reset: host.querySelector('[data-testid="assistant-reset"]') !== null,
  };
}

describe("the assistant's reset under its row", () => {
  // TEST_SCENARIO: an install that pins the feature on hides the switch but keeps the reset, since the person has the assistant whether or not they could switch it.
  it("is offered on an install that pins the feature on", () => {
    fakes.features = { dambledore: "on" };
    fakes.assistantOn = true;
    expect(render()).toEqual({ assistantRow: false, reset: true });
  });

  // TEST_SCENARIO: an install in `experimental` where the person switched the assistant on offers the row and the reset together.
  it("is offered under the row in experimental", () => {
    expect(render()).toEqual({ assistantRow: true, reset: true });
  });

  // TEST_SCENARIO: a person the assistant is off for — never opted in under `experimental`, or an install that pins it off — is offered neither the reset nor a switch that would do anything.
  it("is offered to nobody the assistant is off for", () => {
    fakes.assistantOn = false;
    expect(render()).toEqual({ assistantRow: true, reset: false });
    fakes.features = { dambledore: "off" };
    expect(render()).toEqual({ assistantRow: false, reset: false });
  });
});
