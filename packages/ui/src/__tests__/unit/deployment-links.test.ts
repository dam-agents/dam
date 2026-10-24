// TEST_OVERVIEW: The links to the documentation and to where people ask for help are the install's own, served by the api-server over links.all from the chart's links values. The documentation pages the UI links, the CLI reference, the MCP section and the LiteLLM key guide, are built under the one documentation root, so changing it moves them all. A link the install sets empty is not shown, rather than shown pointing nowhere.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { RevealToken } from "../../modules/api-keys/components/create-api-key-dialog/reveal-token.js";
import { RequestMoreLink } from "../../modules/budgets/components/request-more-link.js";
import { docsPageUrl } from "../../modules/links/lib/docs-pages.js";
import { LiteLlmProxyForm } from "../../modules/providers/components/litellm-proxy/form.js";
import { CHART_DEFAULT_LINKS, fakeLinks } from "./support/fake-links.js";

vi.mock(
  "../../modules/links/api/queries.js",
  () => import("./support/fake-links.js"),
);

afterEach(() => {
  fakeLinks.current = { ...CHART_DEFAULT_LINKS };
});

const render = (element: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(TooltipProvider, null, element));

const revealToken = () =>
  render(createElement(RevealToken, { plaintext: "tok", onClose: () => {} }));

const liteLlmForm = () =>
  render(
    createElement(LiteLlmProxyForm, {
      provider: "ibm-litellm",
      variant: "wizard",
      onSave: async () => {},
    }),
  );

describe("documentation pages", () => {
  // TEST_SCENARIO: with the chart's default root, every page keeps the address it had before the links became configurable.
  it("keep their current addresses under the default root", () => {
    const root = CHART_DEFAULT_LINKS.docs!;
    expect(docsPageUrl(root, "home")).toBe(
      "https://pages.github.ibm.com/dam-agents/docs/",
    );
    expect(docsPageUrl(root, "cliReference")).toBe(
      "https://pages.github.ibm.com/dam-agents/docs/reference/cli/",
    );
    expect(docsPageUrl(root, "liteLlmKey")).toBe(
      "https://pages.github.ibm.com/dam-agents/docs/reference/litellm-key/",
    );
    expect(docsPageUrl(root, "mcpServers")).toBe(
      "https://pages.github.ibm.com/dam-agents/docs/core-concepts/connections/#mcp-servers",
    );
  });

  // TEST_SCENARIO: an operator may write the root with or without its trailing slash; the pages land under the root's own path either way, not beside it.
  it("land under a root given without its trailing slash", () => {
    expect(
      docsPageUrl("https://docs.example.com/platform", "cliReference"),
    ).toBe("https://docs.example.com/platform/reference/cli/");
  });

  // TEST_SCENARIO: an install with its own documentation site sends people to its CLI reference and LiteLLM key guide.
  it("follow the install's documentation root", () => {
    fakeLinks.current = {
      ...CHART_DEFAULT_LINKS,
      docs: "https://docs.example.com/",
    };
    expect(revealToken()).toContain(
      'href="https://docs.example.com/reference/cli/"',
    );
    expect(liteLlmForm()).toContain(
      'href="https://docs.example.com/reference/litellm-key/"',
    );
  });

  // TEST_SCENARIO: an install that sets no documentation site shows no documentation link; the text around it still reads as a sentence.
  it("are not linked when the install sets no documentation root", () => {
    fakeLinks.current = { ...CHART_DEFAULT_LINKS, docs: null };
    const token = revealToken();
    expect(token).not.toContain("CLI reference");
    expect(token).toContain(
      "Scripts can also send it as a bearer token to the API.",
    );
    expect(liteLlmForm()).not.toContain("Get your key");
  });
});

describe("the Request more link", () => {
  // TEST_SCENARIO: the compute meter's Request more link points where the install says people ask for more.
  it("points at the install's request page", () => {
    fakeLinks.current = {
      ...CHART_DEFAULT_LINKS,
      computeRequest: "https://help.example.com/compute",
    };
    expect(renderToStaticMarkup(createElement(RequestMoreLink))).toContain(
      'href="https://help.example.com/compute"',
    );
  });

  // TEST_SCENARIO: an install that names no request page shows no Request more link at all, rather than one into another install's chat.
  it("is not shown when the install names no request page", () => {
    fakeLinks.current = { ...CHART_DEFAULT_LINKS, computeRequest: null };
    expect(renderToStaticMarkup(createElement(RequestMoreLink))).toBe("");
  });
});
