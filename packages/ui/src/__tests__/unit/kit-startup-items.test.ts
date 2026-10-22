// TEST_OVERVIEW: a kit's Startup Items are visible before create: the kit modal
// TEST_OVERVIEW: shows each one's command as a shell would read it, and the catalog
// TEST_OVERVIEW: card counts them as login items, so the owner knows what will run.
import type { StarterKitView } from "api-server-api";
import { describe, expect, test } from "vitest";

import { kitBadges } from "../../modules/starter-kits/lib/catalog-cards.js";
import { startupItemCommandLine } from "../../modules/starter-kits/lib/setup.js";

const NO_KIT: Parameters<typeof kitBadges>[0] = {
  schedules: [],
  channels: [],
  connections: [],
  skills: [],
  skillsInKit: [],
  startupItems: [],
};

const item = (name: string): StarterKitView["startupItems"][number] => ({
  name,
  command: "~/bin/sd",
  args: [],
  enabled: true,
});

describe("startupItemCommandLine", () => {
  // TEST_SCENARIO: the modal shows the program and its arguments on one line; an argument with a space or a quote is quoted, so the line reads as the single words the program gets.
  test("quotes only the words a shell would split", () => {
    expect(
      startupItemCommandLine({
        command: "~/bin/sd",
        args: ["control-room", "--port=5555"],
      }),
    ).toBe("~/bin/sd control-room --port=5555");
    expect(
      startupItemCommandLine({ command: "sh", args: ["-c", "it's on"] }),
    ).toBe(`sh -c 'it'\\''s on'`);
  });
});

describe("kitBadges", () => {
  // TEST_SCENARIO: a kit with Startup Items says so on its card, counted, and a kit with none shows no such badge.
  test("counts the kit's login items", () => {
    const badges = (startupItems: StarterKitView["startupItems"]) =>
      kitBadges({ ...NO_KIT, startupItems }, [], new Map()).map((b) => b.label);
    expect(badges([])).toEqual([]);
    expect(badges([item("a")])).toEqual(["1 login item"]);
    expect(badges([item("a"), item("b")])).toEqual(["2 login items"]);
  });
});
