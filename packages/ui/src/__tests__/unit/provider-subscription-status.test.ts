// TEST_OVERVIEW: Enabling a subscription records the provider choice without verifying any agent's login; API provider status keeps its existing meaning.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ProviderRow } from "../../modules/providers/components/provider-row.js";

describe("subscription provider status", () => {
  it("distinguishes enabled configuration from an authenticated agent", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ProviderRow, { type: "chatgpt", connected: true }),
      ),
    );
    expect(html).toContain("Enabled");
    expect(html).toContain("Sign in separately on each agent");
    expect(html).not.toContain("Connected");
  });
  it("keeps API provider connection status", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(ProviderRow, { type: "openai", connected: true }),
      ),
    );
    expect(html).toContain("Connected");
  });
});
