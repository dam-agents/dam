// @vitest-environment happy-dom
// TEST_OVERVIEW: chat forms are on for every user: an agent's form in a reply renders as a form, with no feature to turn on first and no feature settings read.
import { A2UI_BASIC_CATALOG_ID } from "api-server-api/chat-forms";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";

vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => {
    throw new Error("a chat form must not read the user's feature settings");
  },
  useInstallCapabilities: () => {
    throw new Error("a chat form must not read the install's feature modes");
  },
}));

const { A2uiBlock } =
  await import("../../modules/a2ui/components/a2ui-block.js");

const FORM = JSON.stringify([
  {
    version: "1.0",
    createSurface: {
      surfaceId: "pick",
      catalogId: A2UI_BASIC_CATALOG_ID,
      components: [
        { id: "root", component: "Column", children: ["title"] },
        { id: "title", component: "Text", text: "Pick a region" },
      ],
    },
  },
]);

// TEST_SCENARIO: a new user, who never stored a feature choice, opens a reply carrying a form: the form's own text shows, not a notice to turn chat forms on.
test("renders an agent's form for a user with no feature settings", () => {
  const html = renderToStaticMarkup(
    createElement(A2uiBlock, {
      blockKey: "reply:0:0",
      source: FORM,
      closed: true,
      interactive: true,
    }),
  );

  expect(html).toContain("Pick a region");
  expect(html).not.toContain("Experimental features");
});
