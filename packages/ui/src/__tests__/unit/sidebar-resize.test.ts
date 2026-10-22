// TEST_OVERVIEW: The navigation's edge is dragged, resized from the keyboard and clamped, so the page beside it keeps the width it needs and a drag can put the navigation away and bring it back.
import { expect, it } from "vitest";

import { MIN_CONTENT_WIDTH } from "../../lib/breakpoints.js";
import {
  SIDEBAR_COLLAPSED_W,
  SIDEBAR_MIN_W,
  sidebarMaxWidth,
  snapSidebarWidth,
} from "../../modules/platform/lib/sidebar-layout.js";

const max = (viewport: number) =>
  sidebarMaxWidth({
    viewport,
    rightRailWidth: 60,
    contentMinWidth: MIN_CONTENT_WIDTH,
  });

it("stops the drag at the width the page can spare", () => {
  expect(max(1200)).toBe(1200 - 60 - MIN_CONTENT_WIDTH);
  expect(max(1280)).toBe(500);
  expect(max(700)).toBe(SIDEBAR_MIN_W);
});

it("keeps the navigation when the drag stays above the snap", () => {
  expect(snapSidebarWidth(SIDEBAR_MIN_W)).toBe(SIDEBAR_MIN_W);
  expect(snapSidebarWidth(210)).toBe(SIDEBAR_MIN_W);
  expect(snapSidebarWidth(300)).toBe(300);
});

it("gives up the navigation when the drag goes most of the way to the rail", () => {
  expect(snapSidebarWidth(SIDEBAR_COLLAPSED_W + 10)).toBe("rail");
  expect(snapSidebarWidth(120)).toBe("rail");
});

it("brings the navigation back at its narrowest coming out of the rail", () => {
  expect(snapSidebarWidth(140)).toBe(SIDEBAR_MIN_W);
  expect(snapSidebarWidth(SIDEBAR_MIN_W - 40)).toBe(SIDEBAR_MIN_W);
});

it("holds the navigation's own range", () => {
  expect(snapSidebarWidth(520)).toBe(520);
  expect(snapSidebarWidth(600)).toBe(520);
});
