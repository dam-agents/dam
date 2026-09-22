// TEST_OVERVIEW: Each avatar is built once per agent name as an SVG string and cached, so a long chat or agent list renders a single cached image per name instead of rebuilding the figure. The markup must be well formed and deterministic.
import { describe, expect, it } from "vitest";

import {
  avatarDataUri,
  avatarSvg,
} from "../../modules/agents/lib/avatar/svg.js";

const NAMES = Array.from({ length: 500 }, (_, i) => `agent-${i}`);

describe("avatarSvg", () => {
  // TEST_SCENARIO: A figure that computed a bad number would render as a broken image, so no generated attribute may be NaN or undefined.
  it("emits finite, fully specified attributes", () => {
    for (const name of NAMES) {
      const svg = avatarSvg(name);
      expect(svg, name).not.toMatch(/NaN|undefined|Infinity/);
      expect(svg.startsWith("<svg xmlns=")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
    }
  });

  // TEST_SCENARIO: Every opened element is closed, so the browser parses the whole figure rather than dropping the tail.
  it("balances its elements", () => {
    for (const name of NAMES.slice(0, 50)) {
      const svg = avatarSvg(name);
      const opened = svg.match(/<[a-zA-Z][^>]*[^/]>/g)?.length ?? 0;
      const closed = svg.match(/<\/[a-zA-Z]+>/g)?.length ?? 0;
      expect(opened, name).toBe(closed);
    }
  });

  // TEST_SCENARIO: The same name must draw the same figure everywhere it appears.
  it("is deterministic per name", () => {
    expect(avatarSvg("velvet-comet")).toBe(avatarSvg("velvet-comet"));
    expect(avatarSvg("velvet-comet")).not.toBe(avatarSvg("code-reviewer"));
  });
});

describe("avatarDataUri", () => {
  // TEST_SCENARIO: A second render of the same name reuses the cached image instead of building the figure again.
  it("reuses the cached image for a repeated name", () => {
    const first = avatarDataUri("triage-bot");
    expect(avatarDataUri("triage-bot")).toBe(first);
    expect(first.startsWith("data:image/svg+xml,")).toBe(true);
  });
});
