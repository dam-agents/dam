// @vitest-environment happy-dom
// TEST_OVERVIEW: Separate API and subscription forms keep their credential paths distinct. Subscription setup submits only the native Connection choice, and viewing it never replaces a platform-held credential.
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
const mount = (
  item?: ProviderItem,
  provider: "openai" | "chatgpt" = item?.conn.templateId === "openai-chatgpt"
    ? "chatgpt"
    : "openai",
) => {
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
          provider,
          item,
          onConnected: connected,
          onClose: () => {},
        }),
      ),
    ),
  );
  return connected;
};

// TEST_SCENARIO: Subscription setup has its own provider entry and needs no API-key value or authentication-mode switch.
it("enables subscription mode through the actual provider form", async () => {
  calls.create.mockResolvedValue({ id: "subscription" });
  const connected = mount(undefined, "chatgpt");
  expect(document.querySelector('[role="tab"]')).toBeNull();
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

// TEST_SCENARIO: The OpenAI API-key form cannot create a subscription that later appears under a different provider row.
it("keeps API-key setup separate from subscriptions", () => {
  mount();
  expect(document.querySelector('input[type="password"]')).not.toBeNull();
  expect(document.querySelector('[role="tab"]')).toBeNull();
  expect(document.body.textContent).not.toContain(
    "Enable ChatGPT subscription",
  );
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
