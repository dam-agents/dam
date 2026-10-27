// @vitest-environment happy-dom
// TEST_OVERVIEW: The connect warning a not-connected pick opens leaves the picker's popover open: a cancel returns to it unchanged and a confirm returns to it with the pick applied, focus back on the row that asked, with the real popover and the real dialog.
import { act, createElement, Fragment, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { DialogOverlay } from "../../components/dialog-overlay.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import {
  keepOpenWhileDialog,
  useConnectOnPick,
} from "../../modules/sessions/hooks/use-connect-on-pick.js";
import type { ModelGroup } from "../../modules/sessions/lib/catalog-groups.js";

const grant = vi.hoisted(() => vi.fn(async (_id: string) => true));
vi.mock("../../modules/sessions/api/session-pair.js", () => ({
  useGrantProvider: () => ({ grant }),
}));

const group: ModelGroup = {
  connectionId: "conn-bedrock",
  alias: "bedrock",
  displayName: "AWS Bedrock",
  status: "listed",
  listedAt: null,
  native: true,
  attached: false,
  models: [],
};

function Picker({ apply }: { apply: () => void }) {
  const [open, setOpen] = useState(true);
  const connectOnPick = useConnectOnPick("agent-1");
  return createElement(
    Fragment,
    null,
    createElement(
      Popover,
      { open, onOpenChange: setOpen },
      createElement(PopoverTrigger, null, "Picker"),
      createElement(
        PopoverContent,
        { "aria-label": "Picker", onInteractOutside: keepOpenWhileDialog },
        createElement(
          "button",
          {
            type: "button",
            onClick: () => connectOnPick(group, "bedrock/opus", apply),
          },
          "opus",
        ),
      ),
    ),
    createElement(DialogOverlay),
  );
}

const flush = () => act(async () => new Promise((r) => setTimeout(r, 50)));
const button = (name: string) =>
  [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === name,
  )!;

let root: ReturnType<typeof createRoot> | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

/** TEST_SCENARIO: cancel leaves the pick unapplied and the picker open with focus on its row; confirm grants the provider, applies the pick, and returns to the same open picker. */
it("returns to the open picker after the connect warning", async () => {
  const apply = vi.fn();
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root!.render(createElement(Picker, { apply })));
  await flush();

  act(() => button("opus").focus());
  act(() => button("opus").click());
  await flush();
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  act(() => button("Cancel").click());
  await flush();
  expect(apply).not.toHaveBeenCalled();
  expect(grant).not.toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Picker"]')).not.toBeNull();
  expect(document.activeElement).toBe(button("opus"));

  act(() => button("opus").click());
  await flush();
  act(() => button("Connect").click());
  await flush();
  expect(grant).toHaveBeenCalledWith("conn-bedrock");
  expect(apply).toHaveBeenCalledOnce();
  expect(document.querySelector('[aria-label="Picker"]')).not.toBeNull();
  expect(document.activeElement).toBe(button("opus"));
});
