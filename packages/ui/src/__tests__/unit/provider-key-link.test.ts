// TEST_OVERVIEW: every provider form that has a key page shows the same "Get your key" link to it, at the top of the form, when connecting and when replacing a key.
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { AnthropicForm } from "../../modules/providers/components/anthropic/form.js";
import { BedrockForm } from "../../modules/providers/components/bedrock/form.js";
import { BobForm } from "../../modules/providers/components/bob/form.js";
import { LiteLlmProxyForm } from "../../modules/providers/components/litellm-proxy/form.js";
import { OpenAIForm } from "../../modules/providers/components/openai/form.js";

const onSave = async () => {};

const FORMS: [string, (variant: "wizard" | "edit") => ReactElement, string][] =
  [
    [
      "Anthropic API key",
      (variant) =>
        createElement(AnthropicForm, {
          variant,
          initialMode: "api-key",
          onSave,
        }),
      "https://platform.claude.com/settings/keys",
    ],
    [
      "OpenAI",
      (variant) => createElement(OpenAIForm, { variant, onSave }),
      "https://platform.openai.com/api-keys",
    ],
    [
      "Bob Shell",
      (variant) => createElement(BobForm, { variant, onSave }),
      "https://bob.ibm.com/admin/apikeys",
    ],
    [
      "AWS Bedrock",
      (variant) => createElement(BedrockForm, { variant, onSave }),
      "https://console.aws.amazon.com/bedrock/",
    ],
    [
      "IBM ETE LiteLLM Proxy",
      (variant) =>
        createElement(LiteLlmProxyForm, {
          provider: "ibm-litellm",
          variant,
          onSave,
        }),
      "https://pages.github.ibm.com/dam-agents/docs/reference/litellm-key/",
    ],
    [
      "CurveBender",
      (variant) =>
        createElement(LiteLlmProxyForm, {
          provider: "curve-bender",
          variant,
          onSave,
        }),
      "https://litellm.cb.ete.res.ibm.com/ui/",
    ],
  ];

describe("the Get your key link", () => {
  it.each(
    FORMS.flatMap(([name, form, href]) =>
      (["wizard", "edit"] as const).map(
        (variant) => [name, variant, form, href] as const,
      ),
    ),
  )("links the %s key page in the %s dialog", (_name, variant, form, href) => {
    const html = renderToStaticMarkup(form(variant));
    const link = html.match(/<a [^>]*>(?:(?!<\/a>).)*Get your key/s)?.[0];
    expect(link).toContain(`href="${href}"`);
    expect(html.split("Get your key")).toHaveLength(2);
  });

  it("is not shown for an Anthropic subscription token, which has no key page", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(AnthropicForm, {
          variant: "wizard",
          initialMode: "oauth",
          onSave,
        }),
      ),
    );
    expect(html).not.toContain("Get your key");
  });
});
