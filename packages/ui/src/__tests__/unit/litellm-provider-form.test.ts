import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { LiteLlmProxyForm } from "../../modules/providers/components/litellm-proxy/form.js";

vi.mock(
  "../../modules/links/api/queries.js",
  () => import("./support/fake-links.js"),
);

describe("LiteLLM provider labels and documentation", () => {
  it.each(["wizard", "edit"] as const)(
    "links CurveBender documentation in the %s dialog",
    (variant) => {
      const html = renderToStaticMarkup(
        createElement(LiteLlmProxyForm, {
          provider: "curve-bender",
          variant,
          onSave: async () => {},
        }),
      );
      expect(html).toContain("CurveBender (own key)");
      expect(html).toContain('href="https://ibm.biz/cb-docs"');
      expect(html).toContain("CurveBender documentation");
      expect(html).toContain('href="https://litellm.cb.ete.res.ibm.com/ui/"');
    },
  );

  it("names the ETE proxy without offering CurveBender documentation", () => {
    const html = renderToStaticMarkup(
      createElement(LiteLlmProxyForm, {
        provider: "ibm-litellm",
        variant: "wizard",
        onSave: async () => {},
      }),
    );
    expect(html).toContain("IBM ETE LiteLLM Proxy");
    expect(html).not.toContain("https://ibm.biz/cb-docs");
  });
});
