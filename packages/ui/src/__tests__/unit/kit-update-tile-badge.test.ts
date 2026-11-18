// @vitest-environment happy-dom
// TEST_OVERVIEW: an agent's tile on Home shows its Kit Update. An offered update reads "Kit update", as before; once the owner started it, the same badge turns into a spinner with "Kit updating", a button named "Kit updating to <version>" whose panel, as the approved design draws it, reads "Kit update in progress" with the versions it moves between and the clock time it started, and offers "Continue update" into the update's chat and "See what changed". The offer wins when a status carries both, and an agent with no update shows no badge.
import type { KitUpdateStatus } from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { clockLabel } from "../../lib/format-time.js";
import { KitUpdateTag } from "../../modules/starter-kits/components/kit-update-tag.js";
import { kitUpdateBadge } from "../../modules/starter-kits/lib/kit-update-badge.js";

const TARGET = "a".repeat(40);
const CURRENT = "b".repeat(40);
const COMPARE = "https://github.com/acme/kit/compare/b...a";
const PENDING = {
  targetCommit: TARGET,
  startedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
};

const openAgentSession = vi.fn();
const kit = vi.hoisted(() => ({
  update: undefined as KitUpdateStatus | undefined,
  versionTo: null as string | null,
  versionFrom: null as string | null,
  sessionId: null as string | null,
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ openAgentSession }),
}));
vi.mock("../../modules/starter-kits/api/queries.js", () => ({
  useKitUpdate: () => kit.update,
  useKitUpdateChanges: () => ({
    data: kit.versionTo
      ? {
          versionTo: kit.versionTo,
          versionFrom: kit.versionFrom,
          from: CURRENT,
          compareUrl: COMPARE,
        }
      : undefined,
  }),
}));
vi.mock("../../modules/starter-kits/hooks/use-kit-update-session.js", () => ({
  useKitUpdateSessionId: () => kit.sessionId,
}));

const status = (
  state: KitUpdateStatus["state"],
  pending: KitUpdateStatus["pending"] = null,
): KitUpdateStatus => ({
  agentId: "agent-1",
  state,
  current: CURRENT,
  latest: TARGET,
  pending,
});

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let onOpenAgent: ReturnType<typeof vi.fn<() => void>>;
let onTileClick: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  openAgentSession.mockReset();
  onOpenAgent = vi.fn<() => void>();
  onTileClick = vi.fn<() => void>();
  kit.update = undefined;
  kit.versionTo = null;
  kit.versionFrom = null;
  kit.sessionId = null;
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(
        "div",
        { onClick: onTileClick },
        createElement(KitUpdateTag, { agentId: "agent-1", onOpenAgent }),
      ),
    ),
  );
}

const offer = () =>
  container.querySelector('[data-testid="agent-kit-update-badge"]');
const running = () =>
  container.querySelector<HTMLButtonElement>(
    '[data-testid="agent-kit-updating-badge"]',
  );
const panel = () =>
  document.querySelector<HTMLElement>('[data-testid="kit-updating"]');
const panelButton = () => panel()?.querySelector("button");
const panelLink = () => panel()?.querySelector("a");

async function openPanel() {
  await act(async () => running()?.click());
}

// TEST_SCENARIO: an agent with only an offer shows "Kit update" as before, and no "Kit updating".
it("shows the offer as today", () => {
  kit.update = status("available");
  mount();
  expect(offer()?.textContent).toBe("Kit update");
  expect(running()).toBeNull();
});

// TEST_SCENARIO: an agent with an update pending shows a spinner and "Kit updating" in the badge's place; the spinner is hidden from a screen reader, which hears "Kit updating to <version>".
it("turns into a spinner with Kit updating while the update runs", () => {
  kit.update = status("pending", PENDING);
  kit.versionTo = "6.17.0";
  mount();
  expect(offer()).toBeNull();
  expect(running()?.textContent).toBe("Kit updating");
  expect(running()?.getAttribute("aria-label")).toBe("Kit updating to 6.17.0");
  expect(
    running()?.querySelector(".animate-spin")?.getAttribute("aria-hidden"),
  ).toBe("true");
});

// TEST_SCENARIO: a kit without a VERSION file names both ends by their short commits, in the badge and in the panel; with the changes not loaded there is no compare page to link.
it("names the commits when the kit has no version", async () => {
  kit.update = status("pending", PENDING);
  mount();
  expect(running()?.getAttribute("aria-label")).toBe(
    `Kit updating to ${TARGET.slice(0, 9)}`,
  );
  await openPanel();
  expect(panel()?.textContent).toContain(
    `From ${CURRENT.slice(0, 9)} to ${TARGET.slice(0, 9)}, in its chat`,
  );
  expect(panelLink()).toBeNull();
});

// TEST_SCENARIO: the person opens the badge; the panel has the design's title and text, the clock time the update started beside a clock icon, and a link to the same compare page as the update bar's card.
it("opens the panel the design draws", async () => {
  kit.update = status("pending", PENDING);
  kit.versionFrom = "6.16.2";
  kit.versionTo = "6.17.0";
  mount();
  await openPanel();
  const text = panel()?.textContent ?? "";
  expect(text).toContain("Kit update in progress");
  expect(text).toContain(
    "From 6.16.2 to 6.17.0, in its chat — it can wait while it asks you something.",
  );
  expect(text).toContain(`Started at ${clockLabel(PENDING.startedAt)}`);
  expect(
    panel()?.querySelector("time")?.previousElementSibling?.tagName,
  ).toMatch(/^svg$/i);
  expect(panelLink()?.textContent).toBe("See what changed ");
  expect(panelLink()?.getAttribute("href")).toBe(COMPARE);
  expect(panelLink()?.getAttribute("target")).toBe("_blank");
});

// TEST_SCENARIO: Continue update opens the update's chat and closes the panel; neither the badge's click nor the panel's opens the agent through the tile behind it.
it("continues the update in its chat", async () => {
  kit.update = status("pending", PENDING);
  kit.versionTo = "6.17.0";
  kit.sessionId = "session-9";
  mount();
  await openPanel();
  expect(panelButton()?.textContent).toBe("Continue update");
  await act(async () => panelButton()?.click());
  expect(openAgentSession).toHaveBeenCalledWith("agent-1", "session-9");
  expect(onOpenAgent).not.toHaveBeenCalled();
  expect(onTileClick).not.toHaveBeenCalled();
  expect(panel()).toBeNull();
});

// TEST_SCENARIO: the update's chat is not among the agent's recent chats; Continue update opens the agent instead, whose bar continues the update.
it("continues through the agent when the update's chat is not found", async () => {
  kit.update = status("pending", PENDING);
  mount();
  await openPanel();
  expect(panelButton()?.textContent).toBe("Continue update");
  await act(async () => panelButton()?.click());
  expect(onOpenAgent).toHaveBeenCalledOnce();
  expect(openAgentSession).not.toHaveBeenCalled();
});

// TEST_SCENARIO: an agent with no update to offer and none started shows no badge at all.
it.each(["up-to-date", "skipped", "onboarding", "unreachable"] as const)(
  "shows nothing for %s",
  (state) => {
    kit.update = status(state);
    mount();
    expect(container.textContent).toBe("");
  },
);

// TEST_SCENARIO: decided at hand-off — a status with both an offer and a pending mark shows the offer until the update has started; a started update the kit cannot be reached for still shows as running.
it("lets the offer win over a pending mark", () => {
  expect(kitUpdateBadge(status("available", PENDING))).toEqual({
    kind: "offer",
  });
  expect(kitUpdateBadge(status("unreachable", PENDING))).toEqual({
    kind: "running",
    pending: PENDING,
  });
  expect(kitUpdateBadge(undefined)).toBeNull();
});
