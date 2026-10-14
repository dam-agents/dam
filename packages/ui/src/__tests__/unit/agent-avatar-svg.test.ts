// TEST_OVERVIEW: Every agent shows one of a fixed set of characters: the one its owner chose, or else one picked from a hash of its owner and name, so the same agent looks the same everywhere. A new agent is offered the character its owner uses least. One SVG string serves the UI and the Slack PNG, so the mood must already be right without page CSS: an awake character shows open eyes and an asleep one closed eyes, both in the character's own colours.
import { avatarSchema } from "api-server-api";
import {
  AVATAR_CHARACTERS,
  avatarCharacter,
  avatarSvg,
  emojiSvg,
  leastUsedCharacter,
  parseAvatar,
} from "api-server-api/avatar/svg";
import { describe, expect, it } from "vitest";

const NAMES = Array.from({ length: 500 }, (_, i) => `agent-${i}`);
const picked = (name: string) => avatarCharacter(undefined, "owner-1", name);

function hidden(svg: string, group: string): boolean {
  return new RegExp(`class="${group}" display="none"`).test(svg);
}

describe("avatarCharacter", () => {
  // TEST_SCENARIO: The same name must draw the same character everywhere it appears, and a few hundred names must reach every character, so no character is dead weight.
  it("is deterministic and reaches every character", () => {
    expect(picked("velvet-comet")).toBe(picked("velvet-comet"));
    expect(new Set(NAMES.map(picked))).toEqual(new Set(AVATAR_CHARACTERS));
  });
});

describe("parseAvatar", () => {
  // TEST_SCENARIO: an emoji or uploaded image stored on the spec is shown as itself; anything else, including markup posing as an emoji, falls back to a character, so only one RGI emoji ever reaches the SVG text.
  it("reads emoji and image avatars and falls back to a character", () => {
    const id = "f".repeat(64);
    expect(parseAvatar("emoji:👩‍💻", "o", "n")).toEqual({
      kind: "emoji",
      emoji: "👩‍💻",
    });
    expect(parseAvatar(`image:${id}`, "o", "n")).toEqual({ kind: "image", id });
    for (const bad of ["emoji:<script>", "emoji:🦊🦊", "image:xyz", undefined])
      expect(parseAvatar(bad, "o", "n").kind).toBe("character");
    for (const bad of ["emoji:<b>", "image:../x", "robot"])
      expect(avatarSchema.safeParse(bad).success).toBe(false);
    expect(emojiSvg("🦊")).toContain(">🦊</text>");
  });
});

describe("avatarSvg", () => {
  // TEST_SCENARIO: Each character is well formed in every mood, so the browser and the Slack renderer parse the whole figure.
  it("emits well-formed markup for every character and mood", () => {
    for (const character of AVATAR_CHARACTERS)
      for (const mood of ["awake", "asleep"] as const) {
        const svg = avatarSvg(character, mood);
        expect(svg, character).not.toMatch(/NaN|undefined|Infinity/);
        const opened = svg.match(/<[a-z][^>]*[^/]>/g)?.length ?? 0;
        const closed = svg.match(/<\/[a-z]+>/g)?.length ?? 0;
        expect(opened, character).toBe(closed);
      }
  });

  // TEST_SCENARIO: The mood alone decides which eyes a static render shows, and an asleep character keeps its colours.
  it("shows the eyes of the mood in the character's colours", () => {
    const awake = avatarSvg("spark", "awake");
    const asleep = avatarSvg("spark", "asleep");
    expect(hidden(awake, "avatar-eyes-closed")).toBe(true);
    expect(hidden(awake, "avatar-eyes-open")).toBe(false);
    expect(hidden(asleep, "avatar-eyes-open")).toBe(true);
    expect(hidden(asleep, "avatar-eyes-closed")).toBe(false);
    const colours = (svg: string) => new Set(svg.match(/#[0-9a-fA-F]{6}/g));
    expect(colours(asleep)).toEqual(colours(awake));
  });
});

describe("leastUsedCharacter", () => {
  // TEST_SCENARIO: An owner with no agents gets the first character, and each next agent gets one the owner does not use yet, so eight agents get eight different characters before any repeats.
  it("offers the character the owner uses least", () => {
    const used: (typeof AVATAR_CHARACTERS)[number][] = [];
    for (let i = 0; i < AVATAR_CHARACTERS.length; i++)
      used.push(leastUsedCharacter(used));
    expect(new Set(used)).toEqual(new Set(AVATAR_CHARACTERS));
    expect(leastUsedCharacter([...used, "stack"])).toBe("shield");
  });
});
