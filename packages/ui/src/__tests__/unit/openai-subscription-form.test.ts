// @vitest-environment happy-dom
// TEST_OVERVIEW: Switching from API-key mode to a subscription submits only the native Connection choice. Viewing a configured subscription never attempts to replace a platform-held credential.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import type { ProviderItem } from "../../modules/providers/components/provider-item.js";

const calls = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("../../modules/connections/api/mutations.js", () => ({
  useCreateConnection: () => ({ isPending: false, mutateAsync: calls.create }),
  useUpdateConnection: () => ({ isPending: false, mutateAsync: calls.update }),
}));
const { ProviderConnectDialog } =
  await import("../../modules/providers/components/provider-connect-dialog.js");
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  vi.clearAllMocks();
});
const mount = (item?: ProviderItem) => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const connected = vi.fn();
  act(() =>
    root!.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ProviderConnectDialog, {
          provider: "openai",
          item,
          onConnected: connected,
          onClose: () => {},
        }),
      ),
    ),
  );
  return connected;
};

// TEST_SCENARIO: A subscription needs no API-key value, and an API-key tab visited first must not leave a validation error that prevents native setup.
it("enables subscription mode through the actual provider form", async () => {
  calls.create.mockResolvedValue({ id: "subscription" });
  const connected = mount();
  expect(document.querySelector('input[type="password"]')).not.toBeNull();
  const tab = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
  ].find((button) => button.textContent === "ChatGPT subscription")!;
  await act(async () => tab.click());
  expect(document.querySelector('input[type="password"]')).toBeNull();
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(calls.create).toHaveBeenCalledWith({
    templateId: "openai-chatgpt",
    name: "ChatGPT subscription",
    authKind: "none",
  });
  expect(calls.update).not.toHaveBeenCalled();
  expect(connected).toHaveBeenCalledWith({ id: "subscription" });
});

// TEST_SCENARIO: The native login lives on the agent. Closing the configured provider's instructions must not invoke the generic key-rotation operation, which accepts no credential for this mode.
it("shows existing subscription instructions without rotating a credential", async () => {
  const connected = mount({
    id: "subscription",
    conn: {
      id: "subscription",
      ownerId: "owner",
      name: "ChatGPT subscription",
      templateId: "openai-chatgpt",
      category: "app",
      status: "active",
      authKind: "none",
      contributions: [],
      hosts: [],
    },
  });
  expect(document.querySelector('[role="tab"]')).toBeNull();
  await act(async () =>
    document
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(calls.create).not.toHaveBeenCalled();
  expect(calls.update).not.toHaveBeenCalled();
  expect(connected).toHaveBeenCalledWith({ id: "subscription" });
});
