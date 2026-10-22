// TEST_OVERVIEW: The row above JanUI's tree is one row like Home and Settings: the chevron that collapses the pane is its icon, the brand is its label, and the whole row is the one target rather than a separate brand button beside the chevron.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

vi.mock("../../brand.js", () => ({
  getBrand: () => ({ name: "DAM" }),
}));

const { SidebarHeader } =
  await import("../../modules/platform/components/sidebar-v2/sidebar-header.js");

const render = () =>
  renderToStaticMarkup(
    createElement(SidebarHeader, { expanded: true, onCollapse: () => {} }),
  );

// TEST_SCENARIO: the user looks at the top of the tree: one row holds the chevron and the brand name, and clicking anywhere on it collapses the pane.
it("draws the chevron and the brand as one row", () => {
  const html = render();
  expect(html).toContain('aria-label="Collapse navigation"');
  expect(html).toContain('aria-expanded="true"');
  expect(html).toContain(">DAM<");
});

// TEST_SCENARIO: the brand is the row's label, not a link of its own, so the header offers one target and no other.
it("offers one target, and no brand of its own", () => {
  const html = render();
  expect(html.match(/<button/g)).toHaveLength(1);
  expect(html).not.toContain("<a ");
});
