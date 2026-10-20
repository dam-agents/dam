import type * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  createElement,
  Fragment,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ActivityFilterMenu } from "../../modules/home/components/activity-filter-menu.js";
import {
  type ActivityFilters,
  CHANNEL_TYPES,
  defaultActivityFilters,
  isFiltered,
  onlyChannelType,
  showAllChannelTypes,
  toggleChannelType,
} from "../../modules/home/lib/activity-filter.js";

// TEST_OVERVIEW: the session filter's Type section can narrow to one type in one click ("Only") and widen back to every type ("Show all"). The rules are pure helpers in activity-filter.ts, and the menu renders both actions as menu items with accessible names, so arrow keys reach them like every other row.

vi.mock("@radix-ui/react-dropdown-menu", async (importOriginal) => {
  const actual = await importOriginal<typeof DropdownMenuPrimitive>();
  return {
    ...actual,
    Root: (props: PropsWithChildren) =>
      createElement(actual.Root, { ...props, defaultOpen: true }),
    Portal: ({ children }: PropsWithChildren) =>
      createElement(Fragment, null, children),
  };
});

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactElement }) => children,
}));

const render = (filters: ActivityFilters) =>
  renderToStaticMarkup(
    createElement(ActivityFilterMenu, { filters, onChange: () => {} }),
  );

describe("session filter types", () => {
  // TEST_SCENARIO: "Only" on a type keeps that type alone and leaves the state filter as it was.
  it("narrows to one type", () => {
    const filters = { ...defaultActivityFilters(), state: "unread" as const };
    const only = onlyChannelType(filters, "slack");
    expect([...only.channelTypes]).toEqual(["slack"]);
    expect(only.state).toBe("unread");
    expect(isFiltered(only)).toBe(true);
  });

  // TEST_SCENARIO: "Show all" turns every type back on, and with state "All" nothing counts as filtered.
  it("shows every type again", () => {
    const only = onlyChannelType(defaultActivityFilters(), "telegram");
    const all = showAllChannelTypes(only);
    expect([...all.channelTypes].sort()).toEqual([...CHANNEL_TYPES].sort());
    expect(isFiltered(all)).toBe(false);
  });

  // TEST_SCENARIO: a checkbox still toggles its type alone; unchecking the last type leaves an empty set, which shows nothing rather than everything.
  it("toggles one type, down to none", () => {
    const only = onlyChannelType(defaultActivityFilters(), "chat");
    const withSlack = toggleChannelType(only, "slack");
    expect([...withSlack.channelTypes].sort()).toEqual(["chat", "slack"]);

    const none = toggleChannelType(only, "chat");
    expect(none.channelTypes.size).toBe(0);
    expect(isFiltered(none)).toBe(true);
  });
});

describe("ActivityFilterMenu", () => {
  // TEST_SCENARIO: every type row carries an "Only" menu item named for its type, so keyboard and screen reader users reach it.
  it("names an Only action on every type", () => {
    const html = render(defaultActivityFilters());
    for (const label of ["Chat", "Slack", "Telegram", "Schedule", "Terminal"])
      expect(html).toMatch(
        new RegExp(`role="menuitem"[^>]*aria-label="Show only ${label}"`),
      );
  });

  // TEST_SCENARIO: "Show all" is offered only when some type is off, so the default menu does not show it.
  it("offers Show all only when some type is off", () => {
    expect(render(defaultActivityFilters())).not.toContain("Show all types");
    expect(render(onlyChannelType(defaultActivityFilters(), "slack"))).toMatch(
      /role="menuitem"[^>]*aria-label="Show all types"/,
    );
  });
});
