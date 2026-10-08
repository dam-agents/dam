// TEST_OVERVIEW: Every agent gets one of a fixed set of characters, picked from a hash of its owner and name, so nothing is stored and the same agent looks the same everywhere. One SVG string serves the UI and the Slack PNG, so the mood must already be right without page CSS: a working character shows open eyes, an idle one closed eyes in colour, and an asleep one closed eyes in grey.
import {
  ASLEEP_FILL,
  AVATAR_CHARACTERS,
  avatarCharacter,
  avatarSvg,
} from "api-server-api/avatar/svg";
import { describe, expect, it } from "vitest";

const NAMES = Array.from({ length: 500 }, (_, i) => `agent-${i}`);

function hidden(svg: string, group: string): boolean {
  return new RegExp(`class="${group}" display="none"`).test(svg);
}

describe("avatarCharacter", () => {
  // TEST_SCENARIO: The same name must draw the same character everywhere it appears, and a few hundred names must reach every character, so no character is dead weight.
  it("is deterministic and reaches every character", () => {
    expect(avatarCharacter("velvet-comet")).toBe(
      avatarCharacter("velvet-comet"),
    );
    expect(new Set(NAMES.map(avatarCharacter))).toEqual(
      new Set(AVATAR_CHARACTERS),
    );
  });
});

describe("avatarSvg", () => {
  // TEST_SCENARIO: Each character is well formed in every mood, so the browser and the Slack renderer parse the whole figure.
  it("emits well-formed markup for every character and mood", () => {
    const seeds = AVATAR_CHARACTERS.map((c) =>
      NAMES.find((n) => avatarCharacter(n) === c)!,
    );
    for (const seed of seeds)
      for (const mood of ["working", "idle", "asleep"] as const) {
        const svg = avatarSvg(seed, mood);
        expect(svg, seed).not.toMatch(/NaN|undefined|Infinity/);
        const opened = svg.match(/<[a-z][^>]*[^/]>/g)?.length ?? 0;
        const closed = svg.match(/<\/[a-z]+>/g)?.length ?? 0;
        expect(opened, seed).toBe(closed);
      }
  });

  // TEST_SCENARIO: The mood alone decides which eyes a static render shows, and only an asleep character turns grey.
  it("shows the eyes and colour of the mood", () => {
    const working = avatarSvg("velvet-comet", "working");
    const idle = avatarSvg("velvet-comet", "idle");
    const asleep = avatarSvg("velvet-comet", "asleep");
    expect(hidden(working, "avatar-eyes-closed")).toBe(true);
    expect(hidden(working, "avatar-eyes-open")).toBe(false);
    expect(hidden(idle, "avatar-eyes-open")).toBe(true);
    expect(idle).not.toContain(ASLEEP_FILL);
    expect(hidden(asleep, "avatar-eyes-open")).toBe(true);
    expect(asleep).toContain(ASLEEP_FILL);
    expect(asleep).not.toMatch(/#(?!a2a9b0)[0-9a-fA-F]{6}/);
  });
});
