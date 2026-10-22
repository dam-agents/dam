// @vitest-environment happy-dom
// TEST_OVERVIEW: The avatar picker opens on hover and closes once the pointer leaves it; an image upload started from it holds it open while the file dialog is up and the upload runs, so the chosen file reaches POST /api/avatars and becomes the agent's avatar (#5722).
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const env = vi.hoisted(() => ({
  authFetch: vi.fn(),
  onChange: vi.fn(),
}));

vi.mock("../../auth.js", () => ({ authFetch: env.authFetch }));
vi.mock("../../lib/toast.js", () => ({ emitToast: vi.fn() }));
vi.mock("../../modules/features/api/queries.js", () => ({
  useFeatures: () => ({ data: { "custom-avatars": true } }),
}));
vi.mock("../../modules/getting-started/api/mutations.js", () => ({
  useMarkAvatarPicked: () => ({ mutate: () => {} }),
}));
vi.mock("../../modules/getting-started/hooks/use-open-checklist.js", () => ({
  useOpenChecklist: () => () => {},
}));
vi.mock("../../modules/getting-started/hooks/use-unlocked-avatars.js", () => ({
  useUnlockedAvatars: () => null,
  useFreshAvatars: () => [],
}));
vi.mock("../../modules/agents/components/avatar/agent-avatar.js", () => ({
  AgentAvatar: () => null,
}));

const { AvatarPicker } =
  await import("../../modules/agents/components/avatar/avatar-picker.js");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(AvatarPicker, {
        value: "karel",
        onChange: env.onChange,
        children: "avatar",
      }),
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const trigger = () =>
  container.querySelector<HTMLElement>('[data-testid="avatar-picker"]')!;
const content = () =>
  document.body.querySelector<HTMLElement>(
    "[data-radix-popper-content-wrapper] > *",
  );
const fileInput = () =>
  document.body.querySelector<HTMLInputElement>('input[type="file"]');

function pointer(
  target: Element,
  type: "pointerover" | "pointerout",
  related: Element,
) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        pointerType: "mouse",
        relatedTarget: related,
      }),
    );
  });
}

function hoverOpen() {
  pointer(trigger(), "pointerover", document.body);
  act(() => void vi.advanceTimersByTime(200));
  expect(content()).not.toBeNull();
}

// UNIT_BOUNDARY_DESCRIPTION: the pointer leaves the popover for the native file dialog, which the page sees as the pointer leaving for the body.
function leave() {
  pointer(content()!, "pointerout", document.body);
  act(() => void vi.advanceTimersByTime(400));
}

// TEST_SCENARIO: without an upload, the pointer leaving the hover-opened picker closes it after its grace.
it("closes the hover-opened picker once the pointer leaves", () => {
  hoverOpen();
  leave();
  expect(content()).toBeNull();
});

// TEST_SCENARIO: the user clicks Upload image and the pointer leaves for the file dialog; the picker stays, so the picked file reaches POST /api/avatars and its answer becomes the agent's avatar.
it("uploads the chosen file after the pointer left for the file dialog", async () => {
  env.authFetch.mockResolvedValue(
    new Response(JSON.stringify({ avatar: "image:abc" }), { status: 200 }),
  );
  hoverOpen();
  act(() => fileInput()!.click());
  leave();
  const input = fileInput();
  expect(input).not.toBeNull();
  const file = new File(["png"], "me.png", { type: "image/png" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input!.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.runAllTimersAsync();
  });
  expect(env.authFetch).toHaveBeenCalledWith(
    "/api/avatars",
    expect.objectContaining({ method: "POST", body: file }),
  );
  expect(env.onChange).toHaveBeenCalledWith("image:abc");
});

// TEST_SCENARIO: a cancelled file dialog releases the hold, so the picker the pointer already left closes after its grace.
it("closes once the file dialog is cancelled with the pointer gone", () => {
  hoverOpen();
  act(() => fileInput()!.click());
  leave();
  expect(content()).not.toBeNull();
  act(() => void fileInput()!.dispatchEvent(new Event("cancel")));
  act(() => void vi.advanceTimersByTime(400));
  expect(content()).toBeNull();
});
