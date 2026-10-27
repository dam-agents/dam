// @vitest-environment happy-dom
// TEST_OVERVIEW: Profile and provider saves block all dismissal paths while pending, recover after failure and close after success.
import type { SessionPair } from "api-server-api";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { ProviderItem } from "../../modules/providers/components/provider-item.js";

const state = vi.hoisted(() => ({
  pending: false,
  mutate: vi.fn(),
  persist: vi.fn<() => Promise<{ id: string }>>(),
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { harnesses: [{ name: "claude-code" }] } }),
}));
vi.mock("../../query-client.js", () => ({ queryClient: {} }));
vi.mock("../../trpc.js", () => ({
  trpc: { connections: { catalog: { queryOptions: () => ({}) } } },
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: unknown) => unknown) => select({}),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgent: () => null,
  useAgents: () => ({}),
  findAgent: () => null,
}));
vi.mock("../../modules/profiles/api/queries.js", () => ({
  useProfiles: () => ({ data: [] }),
}));
vi.mock("../../modules/profiles/api/mutations.js", () => ({
  useCreateProfile: () => ({ isPending: state.pending, mutate: state.mutate }),
  useUpdateProfile: () => ({ isPending: state.pending, mutate: state.mutate }),
  useDeleteProfile: () => ({}),
  useSetDefaultProfile: () => ({}),
}));
vi.mock("../../modules/connections/api/mutations.js", () => ({
  useCreateConnection: () => ({
    isPending: state.pending,
    mutateAsync: state.persist,
  }),
  useUpdateConnection: () => ({
    isPending: state.pending,
    mutateAsync: state.persist,
  }),
}));
vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useProviderConnections: () => ({
    owned: [{ id: "c1", templateId: "anthropic" }],
  }),
}));
vi.mock("../../modules/sessions/components/custom-pair-screen.js", () => ({
  CustomPairScreen: ({ onChoose }: { onChoose: (pair: SessionPair) => void }) =>
    createElement(
      "button",
      {
        onClick: () =>
          onChoose({
            harness: "claude-code",
            provider: "c1",
            model: "claude-opus-5-5",
            settings: {},
          }),
      },
      "Choose model",
    ),
}));
vi.mock("../../modules/sessions/components/session-pair-picker.js", () => ({
  SessionPairPicker: () => null,
}));
vi.mock("../../modules/sessions/components/session-pair-trigger.js", () => ({
  SessionPairTrigger: () => null,
}));

const { ProfileSection } =
  await import("../../modules/profiles/components/profile-section.js");
const { useSaveAsProfile } =
  await import("../../modules/profiles/components/save-as-profile.js");
const { ProviderConnectDialog } =
  await import("../../modules/providers/components/provider-connect-dialog.js");
let root: Root;
let container: HTMLDivElement;
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  state.pending = false;
  vi.clearAllMocks();
});

function dismissAll() {
  const dialog = document.querySelector('[role="dialog"]')!;
  const close = dialog.querySelector<HTMLButtonElement>(
    'button[aria-label="Close"]',
  )!;
  expect(close.disabled).toBe(true);
  act(() => close.click());
  const cancel = [...dialog.querySelectorAll("button")].find(
    (b) => b.textContent === "Cancel",
  );
  if (cancel) {
    expect(cancel.disabled).toBe(true);
    act(() => cancel.click());
  }
  act(() =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  const backdrop = dialog.parentElement!;
  act(() => {
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    backdrop.click();
  });
  expect(document.querySelector('[role="dialog"]')).toBe(dialog);
}

it.each(["new", "create", "update"])(
  "blocks pending %s profile dismissal and recovers after failure",
  (mode) => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const saved = vi.fn();
    function Probe() {
      const { row, dialog } = useSaveAsProfile({
        agentId: "a1",
        pair: {
          harness: "claude-code",
          provider: "c1",
          model: "claude-opus-5-5",
          settings: {},
        },
        providerTemplate: "anthropic",
        from: mode === "update" ? { id: "p1", name: "Existing" } : null,
        capability: undefined,
        onSaved: saved,
      });
      return createElement("div", null, row, dialog);
    }
    const component = mode === "new" ? ProfileSection : Probe;
    act(() => root.render(createElement(component)));
    act(() => container.querySelector<HTMLButtonElement>("button")!.click());
    state.pending = true;
    act(() => root.render(createElement(component)));
    dismissAll();
    state.pending = false;
    act(() => root.render(createElement(component)));
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
        .disabled,
    ).toBe(false);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    if (mode === "new")
      act(() =>
        [...document.querySelectorAll("button")]
          .find((b) => b.textContent === "Choose model")!
          .click(),
      );
    {
      const input = document.querySelector<HTMLInputElement>(
        'input[aria-label="Profile name"]',
      )!;
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, "Saved");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      act(() =>
        [...document.querySelectorAll("button")]
          .find(
            (b) =>
              b.textContent ===
              (mode === "update" ? "Update profile" : "Save profile"),
          )!
          .click(),
      );
      const options = state.mutate.mock.calls[0]![1] as {
        onError: (error: { message: string }) => void;
        onSuccess: (profile: { id: string; name: string }) => void;
      };
      act(() => options.onError({ message: "Save failed" }));
      expect(document.body.textContent).toContain("Save failed");
      act(() => options.onSuccess({ id: "p1", name: "Saved" }));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      if (mode !== "new") expect(saved).toHaveBeenCalled();
    }
  },
);

it.each(["create", "update"])(
  "blocks provider %s dismissal and disconnect, recovers on failure and closes on success",
  async (mode) => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const close = vi.fn();
    const connected = vi.fn(() => root.render(null));
    const disconnect = vi.fn();
    let rejectSave: (error: Error) => void;
    state.persist.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectSave = reject;
      }),
    );
    const props = {
      provider: "openai" as const,
      onClose: close,
      onConnected: connected,
      onDisconnect: disconnect,
      item:
        mode === "update"
          ? ({
              id: "c1",
              conn: {
                id: "c1",
                ownerId: "owner",
                templateId: "openai",
                name: "OpenAI",
                category: "app",
                status: "active",
                authKind: "header",
                contributions: [],
                hosts: [],
              },
            } satisfies ProviderItem)
          : undefined,
    };
    act(() => root.render(createElement(ProviderConnectDialog, props)));
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="OpenAI API key"]',
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "sk-test");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(state.persist).toHaveBeenCalledOnce();
    state.pending = true;
    act(() => root.render(createElement(ProviderConnectDialog, props)));
    dismissAll();
    const disconnectButton = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Disconnect this provider",
    )!;
    expect(disconnectButton.disabled).toBe(true);
    act(() => disconnectButton.click());
    expect(disconnect).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    await act(async () => rejectSave(new Error("Save failed")));
    state.pending = false;
    act(() => root.render(createElement(ProviderConnectDialog, props)));
    expect(
      document.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!
        .disabled,
    ).toBe(false);
    expect(connected).not.toHaveBeenCalled();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    state.persist.mockResolvedValue({ id: "c1" });
    await act(async () =>
      document
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(connected).toHaveBeenCalledWith({ id: "c1" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  },
);
