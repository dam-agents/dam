// TEST_OVERVIEW: messenger and GitHub marks draw in currentColor, so they follow the surrounding text colour in both themes; a decorative one stays hidden from assistive technology.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ConnectionIcon } from "../../modules/connections/components/connection-icon.js";

describe("ConnectionIcon", () => {
  it.each(["slack", "telegram", "github"])(
    "draws %s in currentColor",
    (slug) => {
      const html = renderToStaticMarkup(
        createElement(ConnectionIcon, { iconSlug: slug, alt: "Brand" }),
      );
      expect(html).not.toContain("<img");
      expect(html).toContain('fill="currentColor"');
      expect(html).toContain('aria-label="Brand"');
    },
  );

  it("hides a decorative mark", () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionIcon, { iconSlug: "slack", alt: "" }),
    );
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label");
  });
});
