// @vitest-environment happy-dom
// TEST_OVERVIEW: One opener serves every surface that offers the checklist, so the avatar picker and the command palette reach it the same way. It clears a dismissal first, brings the item on screen next — in the navigation drawer on a phone, where that is the only place the item lives — and opens the checklist last, so the popover always has a trigger somebody can see.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  wide: true,
  dismissed: false,
  order: [] as string[],
}));

vi.mock("../../hooks/use-is-desktop.js", () => ({
  useIsDesktop: () => fake.wide,
  useIsWideDesktop: () => fake.wide,
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) =>
    select({
      setChecklistExpanded: () => fake.order.push("open"),
      setMobileNavOpen: () => fake.order.push("drawer"),
    }),
}));
vi.mock("../../modules/getting-started/api/queries.js", () => ({
  useGettingStarted: () => ({ data: { dismissed: fake.dismissed } }),
}));
vi.mock("../../modules/getting-started/api/mutations.js", () => ({
  useSetChecklistDismissed: () => ({
    mutate: () => fake.order.push("undismiss"),
  }),
}));

const { useOpenChecklist } =
  await import("../../modules/getting-started/hooks/use-open-checklist.js");

let root: Root | undefined;

function opener(): () => void {
  let open: (() => void) | undefined;
  const Probe = () => {
    open = useOpenChecklist();
    return null;
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Probe)));
  return open!;
}

beforeEach(() => {
  fake.wide = true;
  fake.dismissed = false;
  fake.order = [];
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
});

// TEST_SCENARIO: on a wide screen the item is in the sidebar, so the opener only has to clear a dismissal and open the checklist.
it("opens the checklist in the sidebar", () => {
  const open = opener();
  act(() => open());
  expect(fake.order).toEqual(["open"]);
});

// TEST_SCENARIO: a dismissed checklist comes back before it opens, so the popover does not mount into a checklist the cache still has hidden.
it("clears the dismissal before opening", () => {
  fake.dismissed = true;
  const open = opener();
  act(() => open());
  expect(fake.order).toEqual(["undismiss", "open"]);
});

// TEST_SCENARIO: on a phone the item exists only in the navigation drawer, so the drawer opens first and the popover has a trigger on screen when it does.
it("opens the navigation drawer on a phone", () => {
  fake.wide = false;
  fake.dismissed = true;
  const open = opener();
  act(() => open());
  expect(fake.order).toEqual(["undismiss", "drawer", "open"]);
});
