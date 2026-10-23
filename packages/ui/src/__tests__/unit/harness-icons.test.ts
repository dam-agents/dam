import { readFileSync } from "node:fs";

import { type HarnessFamily, PROVIDER_PRESET_TYPES } from "api-server-api";
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

vi.mock("../../modules/providers/api/queries.js", () => ({
  useProviderBalance: () => ({
    data: { unit: "usd", used: 12, limit: 100, resetsAt: null },
    isError: false,
  }),
}));

const ALL: HarnessFamily[] = ["bob", "claude-code", "codex", "copilot", "pi"];

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

  it("uses monochrome SVGs without tiles for inline harnesses", () => {
    const html = renderToStaticMarkup(
      createElement(HarnessIcons, { size: "sm" }),
    );
    expect(html.match(/<svg /g)).toHaveLength(5);
    expect(html.match(/fill="currentColor"/g)).toHaveLength(5);
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
      const Icon = size === "sm" ? BobFilledIcon : BobIcon;
      expect(html).toContain(
        renderToStaticMarkup(
          createElement(Icon, {
            className: size === "sm" ? "size-full" : "size-3/5",
          }),
        ),
      );
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
    expect(html.match(/text-white/g)).toHaveLength(5);
    expect(html.match(/bg-icon-[a-z]+/g)).toHaveLength(5);
    expect(html).not.toMatch(/bg-icon-[a-z]+\//);
    expect(html.match(/fill="currentColor"/g)).toHaveLength(5);
  });

  it.each(PROVIDER_PRESET_TYPES)(
    "uses colored tiles only for large %s icons",
    (provider) => {
      for (const size of ["sm", "md", "lg"] as const) {
        const html = renderToStaticMarkup(
          createElement(CardIcon, { provider, size }),
        );
        expect(html).toContain("<svg");
        expect(html).not.toMatch(/<img|<mask|gradient|🚅|fill="#|stroke="#/);
        if (size === "sm") expect(html).not.toMatch(/bg-|text-white/);
        else {
          expect(html).toContain("bg-");
          expect(html).toContain("text-white");
          expect(html).toMatch(/bg-icon-[a-z]+/);
          expect(html).not.toMatch(/bg-icon-[a-z]+\//);
        }
      }
    },
  );

  it.each([true, false])(
    "labels each compatible harness when connected=%s",
    (connected) => {
      const html = renderToStaticMarkup(
        createElement(ProviderRow, {
          type: "ibm-litellm",
          connected,
          harnesses: ALL,
          balance: connected
            ? createElement(ProviderBalance, { connectionId: "proxy" })
            : undefined,
          onOpen() {},
        }),
      );
      expect(html).toContain("Supports:");
      expect(html).toContain("size-5");
      expect(html).not.toContain("Chat and Responses APIs");
      if (connected) {
        expect(html).toContain("$12.00 of $100.00 used");
        expect(html).toContain(">Configured · Connected<");
      } else {
        expect(html).toContain('aria-label="Connect IBM ETE LiteLLM Proxy"');
        expect(html).toContain(">Not configured<");
      }
      for (const name of ["Bob", "Claude", "Codex", "Pi"])
        expect(html).toContain(`role="img" aria-label="${name}"`);
      expect(html).not.toContain("tabindex");
    },
  );

  it("keeps the harness icons focusable on a row that is not a button", () => {
    const html = renderToStaticMarkup(
      createElement(ProviderRow, {
        type: "anthropic",
        connected: true,
        harnesses: ["claude-code"],
      }),
    );
    expect(html).toContain('role="img" aria-label="Claude" tabindex="0"');
  });

  it.each([{ harnesses: undefined }, { harnesses: [] }])(
    "does not invent compatibility when the catalog is missing or empty (%s)",
    ({ harnesses }) => {
      const html = renderToStaticMarkup(
        createElement(ProviderRow, {
          type: "anthropic",
          connected: false,
          harnesses,
          onOpen() {},
        }),
      );
      expect(html).toContain(harnesses ? "None" : "Compatibility unavailable");
      expect(html).not.toContain('aria-label="Claude"');
      expect(html).not.toContain('aria-label="Pi"');
    },
  );

  it("does not advertise unsupported harnesses", () => {
    const html = renderToStaticMarkup(
      createElement(ProviderRow, {
        type: "anthropic",
        connected: true,
        harnesses: ["claude-code"],
        onOpen() {},
      }),
    );
    expect(html).toContain('aria-label="Claude"');
    for (const name of ["Bob", "Codex", "Pi"])
      expect(html).not.toContain(`aria-label="${name}"`);
  });
});
