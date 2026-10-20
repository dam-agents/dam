import type * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type { TabState } from "agent-runtime-api";
import {
  createElement,
  Fragment,
  type PropsWithChildren,
  type ReactElement,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { BrowserTabBar } from "../../modules/browser/components/browser-tab-bar.js";
import { OptionPicker } from "../../modules/sessions/components/model-settings-panel.js";

// TEST_OVERVIEW: a picker where the user picks exactly one value tells assistive technology so: every option is a radio item of its menu, and the selected one is checked. The shared option picker (model, harness, sandbox provider and schedule settings) and the browser's "All tabs" switcher both use the radio item the sidebar's Show filter uses, and "All tabs" also marks the open tab as the current one.

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

vi.mock("../../modules/agents/api/harness-config.js", () => ({
  useHarnessConfigStatus: vi.fn(),
  useResolvedHarnessConfig: vi.fn(),
}));

vi.mock("../../modules/sessions/components/model-settings-snapshot.js", () => ({
  SnapshotNote: () => null,
  StaleModelCallout: () => null,
  unavailableModel: () => null,
}));

const radios = (html: string) =>
  [...html.matchAll(/<div[^>]*role="menuitemradio"[^>]*>/g)].map((m) => m[0]);

const checked = (tag: string) => tag.includes('aria-checked="true"');

const choices = [
  { id: "opus", name: "Opus" },
  { id: "sonnet", name: "Sonnet" },
];

const picker = (value: string | null, clearable = false) =>
  renderToStaticMarkup(
    createElement(OptionPicker, {
      title: "Model",
      choices,
      value,
      clearable,
      onSelect: () => {},
    }),
  );

describe("OptionPicker", () => {
  // TEST_SCENARIO: every choice is a radio item, and only the selected one is checked.
  it("offers its choices as a choice of one", () => {
    const items = radios(picker("sonnet"));
    expect(items).toHaveLength(2);
    expect(items.map(checked)).toEqual([false, true]);
    expect(picker("sonnet")).not.toContain('role="menuitem"');
  });

  // TEST_SCENARIO: with no value, a clearable picker checks its "Agent default" option, a radio item like the others.
  it("checks the default option when nothing is chosen", () => {
    const items = radios(picker(null, true));
    expect(items).toHaveLength(3);
    expect(items.map(checked)).toEqual([true, false, false]);
  });

  // TEST_SCENARIO: the selected option shows the round indicator of the Show filter, not a checkmark.
  it("shows a round indicator on the selected option", () => {
    const menu = picker("opus").split('role="menu"')[1];
    expect(menu).toContain("rounded-full bg-primary");
    expect(menu).not.toContain("<svg");
  });
});

const tab = (id: string, title: string): TabState =>
  ({ id, title, url: `https://${id}.example` }) as TabState;

const tabBar = (activeTab: string) =>
  renderToStaticMarkup(
    createElement(BrowserTabBar, {
      tabs: [tab("a", "Alpha"), tab("b", "Beta"), tab("c", "Gamma")],
      activeTab,
      onSelect: () => {},
      onClose: () => {},
    }),
  );

describe("All tabs", () => {
  // TEST_SCENARIO: the open tab is the checked radio item of the menu, and the current one.
  it("marks the open tab as checked and current", () => {
    const items = radios(tabBar("b"));
    expect(items).toHaveLength(3);
    expect(items.map(checked)).toEqual([false, true, false]);
    expect(items.map((t) => t.includes('aria-current="true"'))).toEqual([
      false,
      true,
      false,
    ]);
  });
});
