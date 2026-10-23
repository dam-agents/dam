import { useEffect, useState } from "react";

export const MOBILE_BREAKPOINT = 768;

export const isMobile = () => window.innerWidth < MOBILE_BREAKPOINT;

/**
 * UNIT_BOUNDARY_DESCRIPTION: the least room the page beside the navigation is drawn well in: the agent config page keeps two columns, the chat keeps its conversation beside its panel and Home keeps its cards from stacking, all at about this width. Below it the navigation steps aside into its rail rather than squeezing the page.
 */
export const MIN_CONTENT_WIDTH = 720;

// UNIT_BOUNDARY_DESCRIPTION: the room the page needs to take the navigation back, above the minimum, so a drag that lands on the threshold does not flap between the two.
const HYSTERESIS = 40;

/**
 * UNIT_BOUNDARY_DESCRIPTION: whether JanUI's navigation takes room beside the page or stands aside as its rail: a viewport narrower than a phone's worth of layout, or a page left under MIN_CONTENT_WIDTH once the navigation and the right rail are counted, keeps the rail — and a rail already up stays up until the page is HYSTERESIS wider, so the choice does not flicker while a window is dragged across the threshold.
 */
export function navigationMode({
  viewport,
  sidebarWidth,
  rightRailWidth,
  railed,
}: {
  viewport: number;
  sidebarWidth: number;
  rightRailWidth: number;
  railed: boolean;
}): "layout" | "rail" {
  if (viewport < MOBILE_BREAKPOINT) return "rail";
  const room = viewport - sidebarWidth - rightRailWidth;
  return room < MIN_CONTENT_WIDTH + (railed ? HYSTERESIS : 0)
    ? "rail"
    : "layout";
}

export function useNarrowShell() {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return { narrow: width < MOBILE_BREAKPOINT, viewport: width };
}
