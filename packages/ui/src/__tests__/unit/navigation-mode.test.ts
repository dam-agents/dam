// TEST_OVERVIEW: JanUI keeps its own navigation at every width; only the room left for the page decides whether the navigation takes that room or stands aside as its rail, and a rail already up waits for a little more room before it takes the room back.
import { expect, it } from "vitest";

import {
  MIN_CONTENT_WIDTH,
  MOBILE_BREAKPOINT,
  navigationMode,
} from "../../lib/breakpoints.js";

const at = (viewport: number, railed = false, sidebarWidth = 325) =>
  navigationMode({ viewport, sidebarWidth, rightRailWidth: 60, railed });

it("keeps the navigation beside the page on a wide viewport", () => {
  expect(at(1280)).toBe("layout");
});

it("stands the navigation aside on a phone", () => {
  expect(at(390)).toBe("rail");
  expect(at(MOBILE_BREAKPOINT - 1)).toBe("rail");
});

it("stands aside as soon as the page is left too little room", () => {
  expect(at(MIN_CONTENT_WIDTH + 325 + 60 - 1)).toBe("rail");
  expect(at(MIN_CONTENT_WIDTH + 325 + 60)).toBe("layout");
});

it("waits for a little more room before it takes the page's room back", () => {
  const threshold = MIN_CONTENT_WIDTH + 325 + 60;
  expect(at(threshold + 20, true)).toBe("rail");
  expect(at(threshold + 40, true)).toBe("layout");
});

it("counts the width the user resized the navigation to", () => {
  expect(at(1100, false, 400)).toBe("rail");
  expect(at(1100, false, 250)).toBe("layout");
});
