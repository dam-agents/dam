// @vitest-environment happy-dom
// TEST_OVERVIEW: Renaming a profile in Settings opens a dialog prefilled with its name; Save waits for a changed name, Enter saves, Escape cancels, and the server's refusal stays in the dialog.
import type { ProfileWithUsage } from "api-server-api";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  error: null as { message: string } | null,
  mutate: vi.fn(),
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/components/ui/row-actions-menu", () => ({
  RowActionsMenu: ({
    children,
    contentProps,
  }: {
    children: ReactNode;
    contentProps: { onCloseAutoFocus: (e: Event) => void };
  }) =>
    createElement(
      "div",
      {
        onClick: () =>
          contentProps.onCloseAutoFocus(
            new Event("focusout", { cancelable: true }),
          ),
      },
      children,
    ),
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: ReactNode;
    onSelect?: () => void;
  }) => createElement("button", { onClick: onSelect }, children),
}));
vi.mock("@tanstack/react-query", () => ({ useQuery: () => ({}) }));
vi.mock("../../query-client.js", () => ({ queryClient: {} }));
vi.mock("../../trpc.js", () => ({
  trpc: { connections: { catalog: { queryOptions: () => ({}) } } },
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) => select({}),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgents: () => ({}),
  findAgent: () => null,
}));
vi.mock("../../modules/profiles/api/queries.js", () => ({
  useProfiles: () => ({
    data: [
      {
        id: "p1",
        name: "Fast review",
        newAgentDefault: false,
        harness: "claude-code",
        providerTemplate: "anthropic",
        model: "claude-opus-5-5",
        settings: {},
        usage: { agents: 0, channels: 0, schedules: 0 },
      } as unknown as ProfileWithUsage,
    ],
  }),
}));
vi.mock("../../modules/profiles/api/mutations.js", () => ({
  useCreateProfile: () => ({}),
  useUpdateProfile: () => ({
    isPending: false,
    isError: state.error !== null,
    error: state.error,
    mutate: state.mutate,
    reset: () => (state.error = null),
  }),
  useDeleteProfile: () => ({}),
  useSetDefaultProfile: () => ({}),
}));
vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useProviderConnections: () => ({ owned: [] }),
}));
vi.mock("../../modules/sessions/components/session-pair-trigger.js", () => ({
  SessionPairTrigger: () => null,
}));

const { ProfileSection } =
  await import("../../modules/profiles/components/profile-section.js");
let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root.render(createElement(ProfileSection)));
  act(() => button("Rename").click());
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  state.error = null;
  vi.clearAllMocks();
});

const button = (text: string) =>
  [...document.querySelectorAll("button")].find((b) => b.textContent === text)!;
const input = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="Profile name"]')!;
const type = (value: string) =>
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input(), value);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });

// TEST_SCENARIO: the dialog starts from the current name, focused, and a name that is empty or the same as before cannot be saved.
it("opens prefilled and keeps Save disabled until the name changes", () => {
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
    "Rename profile",
  );
  expect(input().value).toBe("Fast review");
  expect(document.activeElement).toBe(input());
  expect([input().selectionStart, input().selectionEnd]).toEqual([0, 11]);
  expect(button("Save").disabled).toBe(true);
  type("   ");
  expect(button("Save").disabled).toBe(true);
  type(" Deep review ");
  expect(button("Save").disabled).toBe(false);
});

// TEST_SCENARIO: Enter saves the trimmed name with the profile update mutation, and a success closes the dialog.
it("saves on Enter and closes on success", () => {
  type(" Deep review ");
  act(() =>
    input().dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    ),
  );
  expect(state.mutate).toHaveBeenCalledWith(
    { id: "p1", name: "Deep review" },
    expect.anything(),
  );
  const { onSuccess } = state.mutate.mock.calls[0]![1] as {
    onSuccess: () => void;
  };
  act(() => onSuccess());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

// TEST_SCENARIO: Escape closes the dialog without saving.
it("cancels on Escape", () => {
  type("Deep review");
  act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(state.mutate).not.toHaveBeenCalled();
});

// TEST_SCENARIO: a name the server refuses leaves the dialog open with the server's message, and editing the name clears it.
it("shows the server's error in the dialog until the name is edited", () => {
  type("Deep review");
  act(() => button("Save").click());
  state.error = { message: "A profile named Deep review already exists." };
  act(() => root.render(createElement(ProfileSection)));
  const dialog = () => document.querySelector('[role="dialog"]')?.textContent;
  expect(dialog()).toContain("A profile named Deep review already exists.");
  type("Deeper review");
  act(() => root.render(createElement(ProfileSection)));
  expect(dialog()).not.toContain("already exists");
});
