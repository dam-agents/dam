import { readFileSync } from "node:fs";

import { PROVIDER_PRESET_TYPES } from "api-server-api";
import { Window } from "happy-dom";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  BobFilledIcon,
  BobIcon,
  CodexIcon,
  OpenAIIcon,
} from "../../components/brand-icons.js";
import { HarnessIcons } from "../../components/harness-icons.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { CardIcon } from "../../modules/providers/components/card-icon.js";
import { ProviderBalance } from "../../modules/providers/components/provider-balance.js";
import { ProviderRow } from "../../modules/providers/components/provider-row.js";

const balance = vi.hoisted(() => ({
  data: { unit: "usd", used: 12, limit: 100, resetsAt: null } as {
    unit: "usd" | "bobcoins";
    used: number;
    limit: number | null;
    resetsAt: string | null;
  },
}));

vi.mock("../../modules/providers/api/queries.js", () => ({
  useProviderBalance: () => ({ data: balance.data, isError: false }),
}));

function renderToStaticMarkup(element: ReactElement) {
  return renderMarkup(createElement(TooltipProvider, null, element));
}

function luminance(rgb: number[]) {
  return [0.2126, 0.7152, 0.0722].reduce((sum, weight, i) => {
    const channel = rgb[i]! / 255;
    return (
      sum +
      weight *
        (channel <= 0.04045
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4)
    );
  }, 0);
}

describe("harness icons on provider and preset cards", () => {
  it("keeps white marks legible on the lighter solid tile palette", () => {
    const css = readFileSync(new URL("../../App.css", import.meta.url), "utf8");
    const colors = [...css.matchAll(/--color-icon-[a-z]+: #([0-9a-f]{6});/g)];
    expect(colors.length).toBeGreaterThan(0);
    for (const [, hex] of colors) {
      const rgb = [0, 2, 4].map((i) =>
        Number.parseInt(hex!.slice(i, i + 2), 16),
      );
      expect(1.05 / (luminance(rgb) + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  // TEST_SCENARIO: a provider's mark keeps its vendor's colour on a white tile in both themes, so each logo colour needs the 3:1 a graphic needs against white.
  it("keeps coloured provider marks legible on their white tile", () => {
    const css = readFileSync(new URL("../../App.css", import.meta.url), "utf8");
    const colors = [...css.matchAll(/--color-logo-[a-z-]+: #([0-9a-f]{6});/g)];
    expect(colors.length).toBeGreaterThan(0);
    for (const [, hex] of colors) {
      const rgb = [0, 2, 4].map((i) =>
        Number.parseInt(hex!.slice(i, i + 2), 16),
      );
      expect(1.05 / (luminance(rgb) + 0.05)).toBeGreaterThanOrEqual(3);
    }
  });

  it("uses monochrome SVGs without tiles for inline harnesses", () => {
    const html = renderToStaticMarkup(
      createElement(HarnessIcons, { size: "sm" }),
    );
    expect(html.match(/<svg /g)).toHaveLength(6);
    expect(html.match(/fill="currentColor"/g)).toHaveLength(6);
    expect(html).not.toMatch(
      /<img|<mask|gradient|bg-|text-white|fill="#|stroke="#/,
    );
  });

  it.each(["sm", "md"] as const)(
    "uses filled Bob for inline icons and preset tiles at %s size",
    (size) => {
      const html = renderToStaticMarkup(
        createElement(HarnessIcons, { harnesses: ["bob"], size }),
      );
      expect(html).toContain(
        renderToStaticMarkup(
          createElement(BobFilledIcon, {
            "aria-hidden": true,
            className: size === "sm" ? "size-full" : "size-5",
          }),
        ),
      );
    },
  );

  it.each(["sm", "md", "lg"] as const)(
    "uses the correct Bob provider variant at %s size",
    (size) => {
      const html = renderToStaticMarkup(
        createElement(CardIcon, { provider: "bob", size }),
      );
      if (size === "sm")
        expect(html).toContain(
          renderToStaticMarkup(
            createElement(BobFilledIcon, { className: "size-full" }),
          ),
        );
      else {
        expect(html).toContain('src="/icons/bob-head.png"');
        expect(html).not.toContain(
          renderToStaticMarkup(createElement(BobIcon)),
        );
      }
    },
  );

  it("uses Codex's own mark, not the OpenAI provider mark", () => {
    const html = renderToStaticMarkup(
      createElement(HarnessIcons, { harnesses: ["codex"], size: "sm" }),
    );
    const props = {
      "aria-hidden": true,
      className: "size-full scale-90",
    } as const;
    expect(html).toContain(
      renderToStaticMarkup(createElement(CodexIcon, props)),
    );
    expect(html).not.toContain(
      renderToStaticMarkup(createElement(OpenAIIcon, props)),
    );
  });

  it("uses white harness marks on solid colored preset tiles", () => {
    const html = renderToStaticMarkup(createElement(HarnessIcons));
    expect(html).toContain("size-5 scale-110");
    expect(html).toContain("size-5 scale-90");
    expect(html.match(/text-white/g)).toHaveLength(6);
    expect(html.match(/bg-icon-[a-z]+/g)).toHaveLength(6);
    expect(html).not.toMatch(/bg-icon-[a-z]+\//);
    expect(html.match(/fill="currentColor"/g)).toHaveLength(6);
  });

  // TEST_SCENARIO: a tile carries the vendor's full-colour mark, in its SVG or image, through a logo colour token or as black on white, while the untiled small size stays a one-colour glyph.
  it.each(PROVIDER_PRESET_TYPES)(
    "uses the vendor's colours only on %s tiles",
    (provider) => {
      for (const size of ["sm", "md", "lg"] as const) {
        const html = renderToStaticMarkup(
          createElement(CardIcon, { provider, size }),
        );
        expect(html).toMatch(
          size !== "sm" && provider === "bob" ? /<img[^>]*alt=""/ : /<svg/,
        );
        expect(html).not.toMatch(/<mask|🚅/);
        if (size === "sm")
          expect(html).not.toMatch(/bg-|text-white|fill="#|gradient/);
        else expect(html).toMatch(/fill="#|-logo-[a-z]+|text-black|<img/);
      }
    },
  );

  it.each([true, false])(
    "reads one line per provider when connected=%s, its state in words",
    (connected) => {
      const html = renderToStaticMarkup(
        createElement(ProviderRow, {
          type: "ibm-litellm",
          connected,
          balance: connected
            ? createElement(ProviderBalance, { connectionId: "proxy" })
            : undefined,
          onOpen() {},
        }),
      );
      if (connected) {
        expect(html).toContain("$12.00 of $100.00 used");
        expect(html).toContain(">Connected<");
      } else {
        expect(html).toContain('aria-label="Connect IBM ETE LiteLLM Proxy"');
        expect(html).toContain(">Not connected<");
      }
      expect(html).not.toContain('role="img"');
    },
  );

  /** TEST_SCENARIO: the row-wide button that opens a provider covers the row; what has a title or an action of its own (the balance, the spend pill and the status with the key check's reason) sits in the raised layer above it, so its title shows and its own action works. */
  it("keeps whatever has a title or an action above the row's button", () => {
    const html = renderToStaticMarkup(
      createElement(ProviderRow, {
        type: "ibm-litellm",
        connected: true,
        keyCheck: {
          result: "unverified",
          detail: "HTTP 503",
          checkedAt: "2026-10-20T09:15:00.000Z",
        },
        balance: createElement(ProviderBalance, { connectionId: "proxy" }),
        spend: createElement("button", { type: "button" }, "$0.00 today"),
        onOpen() {},
      }),
    );
    const doc = new Window().document;
    doc.body.innerHTML = html;
    const raised = (
      el: { closest: (s: string) => unknown } | null | undefined,
    ) => !!el?.closest('[data-layer="raised"]');
    const withText = (selector: string, text: string) =>
      [...doc.querySelectorAll(selector)].find((el) =>
        el.textContent.includes(text),
      );
    expect(raised(doc.querySelector('[title*="HTTP 503"]'))).toBe(true);
    expect(raised(withText("span", "$12.00 of $100.00 used"))).toBe(true);
    expect(raised(withText("button", "$0.00 today"))).toBe(true);
    expect(
      html.match(/<button[^>]*aria-label="Edit [^"]*"[^>]*><\/button>/),
    ).not.toBeNull();
  });

  // TEST_SCENARIO: a row describes its provider in one line from the provider definitions, the own-key and deployment CurveBender alike, and its button points only at elements that exist.
  it.each([
    ["anthropic", undefined, "Claude models straight from the source"],
    ["openai", undefined, "GPT models straight from the source"],
    ["chatgpt", undefined, "Your ChatGPT subscription for Codex"],
    ["bedrock", undefined, "Amazon Web Services inference engine"],
    ["bob", undefined, "IBM Bob&#x27;s backend"],
    [
      "ibm-litellm",
      undefined,
      "IBM Research&#x27;s gateway to external model providers",
    ],
    [
      "curve-bender",
      "curve-bender",
      "IBM&#x27;s internal inference on open-source models",
    ],
    [
      "curve-bender",
      "curve-bender-deployment",
      "IBM&#x27;s internal inference on open-source models",
    ],
  ] as const)("describes %s (%s)", (type, templateId, text) => {
    const html = renderToStaticMarkup(
      createElement(ProviderRow, {
        type,
        ...(templateId && { templateId }),
        connected: false,
        onOpen() {},
      }),
    );
    expect(html).toContain(`>${text}<`);
    const doc = new Window().document;
    doc.body.innerHTML = html;
    for (const ref of doc
      .querySelector("button")!
      .getAttribute("aria-describedby")!
      .split(" "))
      expect(doc.getElementById(ref)).not.toBeNull();
  });

  // TEST_SCENARIO: Bob's balance is a pill like the spend pill, in Bobcoins' short unit and for the month, with no reset date; a used-up budget says so in red.
  it("shows Bob's balance as a monthly pill in Bc", () => {
    const pill = (data: typeof balance.data) => {
      balance.data = data;
      return renderToStaticMarkup(
        createElement(ProviderBalance, { connectionId: "bob" }),
      );
    };
    const bob = { unit: "bobcoins", resetsAt: "2026-12-01T00:00:00Z" } as const;
    const html = pill({ ...bob, used: 0, limit: 100 });
    expect(html).toContain(">0 of 100 Bc this month<");
    expect(html).toContain("rounded-full bg-muted");
    expect(pill({ ...bob, used: 100, limit: 100 })).toMatch(
      /text-danger-fg[^>]*>Budget used up: 100 of 100 Bc this month</,
    );
    balance.data = { unit: "usd", used: 12, limit: 100, resetsAt: null };
  });

  // TEST_SCENARIO: the used-up balance's small red text keeps 4.5:1 on the muted pill in both themes.
  it("keeps the used-up balance legible on its pill", () => {
    const css = readFileSync(new URL("../../App.css", import.meta.url), "utf8");
    const theme = (selector: string, name: string) =>
      css
        .slice(css.indexOf(`${selector} {`))
        .match(new RegExp(`--${name}: #([0-9a-f]{6});`))![1]!;
    const rgb = (hex: string) =>
      [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    for (const selector of [":root", ".dark"]) {
      const [a, b] = [
        luminance(rgb(theme(selector, "c-danger-fg"))),
        luminance(rgb(theme(selector, "muted"))),
      ];
      expect(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
