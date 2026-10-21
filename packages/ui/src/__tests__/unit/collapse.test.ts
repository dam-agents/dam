// TEST_OVERVIEW: Collapse slides its content open and closed, and the slide is off under reduced motion. Content that is already open when it first renders, such as the Agent open in the sidebar tree on a page load, shows at once instead of sliding in; content that mounts closed slides when it opens.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { Collapse } from "../../components/ui/collapse.js";

const render = (open: boolean) =>
  renderToStaticMarkup(createElement(Collapse, { open, children: "list" }));

// TEST_SCENARIO: a first render that is open carries no starting style, so nothing slides; a first render that is closed renders nothing.
it("does not slide content that is open on its first render", () => {
  const html = render(true);
  expect(html).toContain("grid-rows-[1fr]");
  expect(html).not.toContain("starting:");
  expect(html).toContain("motion-reduce:transition-none");
  expect(render(false)).toBe("");
});
