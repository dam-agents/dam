// TEST_OVERVIEW: A page header draws the pictogram a page hands it only in the JanUI shell: the current layout's page headers keep their title, description and actions, so the pictograms of Settings, the Agent's configuration and the other pages stay out of the UI a user without the experiment sees.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ janui: false }));

vi.mock("../../modules/features/hooks/use-new-layout.js", () => ({
  useNewLayout: () => fake.janui,
}));

const { PageHeader } = await import("../../components/ui/page-header.js");

function header(): string {
  return renderToStaticMarkup(
    createElement(PageHeader, {
      title: "Appearance",
      description: "Choose how the interface looks.",
      pictogram: createElement("svg", { "data-testid": "pictogram" }),
    }),
  );
}

beforeEach(() => {
  fake.janui = false;
});

// TEST_SCENARIO: with the JanUI experiment off, a page that passes a pictogram still gets a header without one.
it("leaves the pictogram out of the current layout", () => {
  expect(header()).not.toContain('data-testid="pictogram"');
});

// TEST_SCENARIO: with JanUI on, the same page's header draws the pictogram it passes.
it("draws the pictogram in JanUI", () => {
  fake.janui = true;
  expect(header()).toContain('data-testid="pictogram"');
});
