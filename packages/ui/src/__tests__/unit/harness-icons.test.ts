import { readFileSync } from "node:fs";

import { type HarnessFamily, PROVIDER_PRESET_TYPES } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  BobFilledIcon,
  BobIcon,
  CodexIcon,
  OpenAIIcon,
} from "../../components/brand-icons.js";
import { HarnessIcons } from "../../components/harness-icons.js";
import { CardIcon } from "../../modules/providers/components/card-icon.js";
import { ProviderBalance } from "../../modules/providers/components/provider-balance.js";
import { ProviderRow } from "../../modules/providers/components/provider-row.js";
import { HarnessCard } from "../../modules/sandboxes/components/steps/harness-card.js";

vi.mock("../../modules/providers/api/queries.js", () => ({
  useProviderBalance: () => ({
    data: { unit: "usd", used: 12, limit: 100, resetsAt: null },
    isError: false,
  }),
}));

const ALL: HarnessFamily[] = ["bob", "claude-code", "codex", "pi"];

describe("harness icons on provider and preset cards", () => {
  it("keeps white marks legible on the muted tile palette", () => {
    const css = readFileSync(new URL("../../App.css", import.meta.url), "utf8");
    const colors = [...css.matchAll(/--color-icon-[a-z]+: #([0-9a-f]{6});/g)];
    expect(colors.length).toBeGreaterThan(0);
    for (const [, hex] of colors) {
      const luminance = [0.2126, 0.7152, 0.0722].reduce(
        (sum, weight, index) => {
          const channel =
            Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16) / 255;
          const linear =
            channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          return sum + weight * linear;
        },
        0,
      );
      expect(1.05 / (luminance + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("uses monochrome SVGs without tiles for inline harnesses", () => {
    const html = renderToStaticMarkup(
      createElement(HarnessIcons, { size: "sm" }),
    );
    expect(html.match(/<svg /g)).toHaveLength(4);
    expect(html.match(/fill="currentColor"/g)).toHaveLength(4);
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

  it("uses white harness marks on colored tiles for preset cards", () => {
    const html = renderToStaticMarkup(createElement(HarnessIcons));
    expect(html).toContain("size-5 scale-110");
    expect(html).toContain("size-5 scale-90");
    expect(html.match(/text-white/g)).toHaveLength(4);
    expect(html.match(/bg-/g)).toHaveLength(4);
    expect(html.match(/fill="currentColor"/g)).toHaveLength(4);
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
          onConnect() {},
          onEditKey() {},
          onRemoveKey() {},
        }),
      );
      expect(html).toContain("supports:");
      expect(html).toContain("size-5");
      expect(html).not.toContain("Chat and Responses APIs");
      if (connected) expect(html).toContain("$12.00 of $100.00 used");
      else expect(html).toContain('aria-label="Connect IBM ETE LiteLLM Proxy"');
      for (const name of ["Bob", "Claude", "Codex", "Pi"])
        expect(html).toContain(
          `role="img" aria-label="${name}" title="${name}"`,
        );
    },
  );

  it.each([{ harnesses: undefined }, { harnesses: [] }])(
    "does not invent compatibility when the catalog is missing or empty (%s)",
    ({ harnesses }) => {
      const html = renderToStaticMarkup(
        createElement(ProviderRow, {
          type: "anthropic",
          connected: false,
          harnesses,
          onConnect() {},
          onEditKey() {},
          onRemoveKey() {},
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
        onConnect() {},
        onEditKey() {},
        onRemoveKey() {},
      }),
    );
    expect(html).toContain('aria-label="Claude"');
    for (const name of ["Bob", "Codex", "Pi"])
      expect(html).not.toContain(`aria-label="${name}"`);
  });

  it.each(["default", "custom"])(
    "shows all four harnesses only on the Coding agent preset (%s)",
    (id) => {
      const html = renderToStaticMarkup(
        createElement(HarnessCard, {
          template: {
            id,
            name: "Coding agent",
            category: "harness",
            description: "",
            image: "image",
            size: {},
            providers: [],
            tags: [],
            experimental: false,
          },
          selected: false,
          onSelect() {},
        }),
      );
      for (const name of ["Bob", "Claude", "Codex", "Pi"]) {
        if (id === "default") expect(html).toContain(`aria-label="${name}"`);
        else expect(html).not.toContain(`aria-label="${name}"`);
      }
    },
  );
});
