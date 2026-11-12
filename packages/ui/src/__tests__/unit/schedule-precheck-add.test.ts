// @vitest-environment happy-dom
// TEST_OVERVIEW: the precheck row on a starter kit's schedule card: its "+ Add" opens the command box in place, and the keyboard user's focus moves into the box rather than being dropped when the Add button goes away.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SchedulePrecheckField } from "../../modules/schedules/forms/schedule-fields.js";

vi.mock("@/components/ui/tooltip", () => ({
  HintTooltip: ({ children }: { children: ReactNode }) => children,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("../../store.js", () => ({ useStore: () => undefined }));
vi.mock("../../modules/agents/api/harness-config.js", () => ({}));
vi.mock("../../modules/agents/api/queries.js", () => ({}));
vi.mock("../../modules/schedules/api/session-model.js", () => ({}));
vi.mock("../../modules/sessions/components/awake-models-gate.js", () => ({}));
vi.mock(
  "../../modules/sessions/components/model-settings-panel.js",
  () => ({}),
);
vi.mock("../../modules/sessions/components/session-pair-picker.js", () => ({}));
vi.mock("../../modules/sessions/components/stored-pair-summary.js", () => ({}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function Row() {
  const { register } = useForm<{ precheck: string }>({
    defaultValues: { precheck: "" },
  });
  return createElement(SchedulePrecheckField, {
    layout: "rows",
    registration: register("precheck"),
  });
}

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

describe("adding a precheck on a schedule row", () => {
  // TEST_SCENARIO: clicking "+ Add" shows the box, removes the Add button, and puts focus in the box.
  it("opens the box and moves focus into it", () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(createElement(Row)));

    const add = host.querySelector<HTMLButtonElement>(
      'button[aria-label="Add a precheck"]',
    )!;
    const box = host.querySelector("textarea")!;
    expect(box.closest("[hidden]")).not.toBeNull();

    add.focus();
    act(() => add.click());

    expect(
      host.querySelector('button[aria-label="Add a precheck"]'),
    ).toBeNull();
    expect(box.closest("[hidden]")).toBeNull();
    expect(document.activeElement).toBe(box);
  });
});
