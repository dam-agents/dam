// TEST_OVERVIEW: Each avatar is built once per agent name as an SVG string and cached, so a long chat or agent list renders a single cached image per name instead of rebuilding the figure. The markup must be well formed and deterministic.
import { avatarDataUri, avatarSvg } from "api-server-api/avatar/svg";
import { AVATAR_SCLERA, avatarTraits } from "api-server-api/avatar/traits";
import { describe, expect, it } from "vitest";

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

describe("sleeping avatar", () => {
  // TEST_SCENARIO: A hibernating agent keeps its own figure with its eyes closed. Open sclera eyes never show, and the sleeping markup is as well formed as the awake one.
  it("closes the eyes of a hibernating agent", () => {
    for (const name of NAMES) {
      const awake = avatarSvg(name);
      const asleep = avatarSvg(name, true);
      expect(asleep, name).not.toMatch(/NaN|undefined|Infinity/);
      expect(asleep, name).not.toContain(AVATAR_SCLERA);
      const t = avatarTraits(name);
      if (t.face !== "blank" || t.top === "bug-eyes")
        expect(asleep, name).not.toBe(awake);
    }
  });

  // TEST_SCENARIO: The awake and sleeping images of one name are cached apart, so waking an agent swaps its image back.
  it("caches the sleeping image apart from the awake one", () => {
    const awake = avatarDataUri("velvet-comet");
    const asleep = avatarDataUri("velvet-comet", true);
    expect(asleep).not.toBe(awake);
    expect(avatarDataUri("velvet-comet", true)).toBe(asleep);
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
