// @vitest-environment happy-dom
// TEST_OVERVIEW: the pane that makes this install's own Connection. It answers
// TEST_OVERVIEW: with the one Connection the person holds, and the pane hands
// TEST_OVERVIEW: that id to its caller exactly once per create — the caller
// TEST_OVERVIEW: re-renders it with a fresh callback after the create
// TEST_OVERVIEW: invalidates the connection list, and a completion that fired
// TEST_OVERVIEW: again would grant the Connection, toast and close a second time.
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const created: { id: string | null } = { id: "conn-dam" };
const mutateAsync = vi.fn(async () => created);

vi.mock("../../modules/connections/api/mutations.js", () => ({
  useCreateDamConnection: () => {
    const [data, setData] = useState<{ id: string | null } | undefined>(
      undefined,
    );
    return {
      data,
      isPending: false,
      mutateAsync: async () => {
        const result = await mutateAsync();
        setData(result);
        return result;
      },
    };
  },
}));

const { DamConnectionCreateBody } =
  await import("../../modules/connections/components/dam-connection-create-body.js");

const onCreated = vi.fn();
let bump: (n: number) => void;

function Host() {
  const [, setTick] = useState(0);
  bump = (n) => setTick(n);
  const created = (id: string) => onCreated(id);
  return createElement(DamConnectionCreateBody, {
    connectionName: "DAM connection",
    onCreated: created,
    onCancel: () => {},
  });
}

let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;

beforeEach(async () => {
  mutateAsync.mockClear();
  onCreated.mockClear();
  created.id = "conn-dam";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(Host)));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const click = async () => {
  act(() => bump(1));
  const button = host.querySelector<HTMLButtonElement>(
    '[data-testid="dam-connection-create-submit"]',
  );
  expect(button).not.toBeNull();
  await act(async () =>
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true })),
  );
  await act(async () => bump(2));
};

describe("the form-less create", () => {
  // TEST_SCENARIO: one click makes the Connection and hands its id on once, and the re-render that follows the create does not hand it on again.
  it("completes exactly once per create", async () => {
    await click();
    expect(mutateAsync).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onCreated).toHaveBeenCalledWith("conn-dam");

    await act(async () => bump(3));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: an install that cannot have the Connection answers with no id, so the pane says so and completes nothing.
  it("says so when the install cannot offer it", async () => {
    created.id = null;
    await click();
    expect(onCreated).not.toHaveBeenCalled();
    expect(host.textContent).toContain(
      "This install cannot offer its own connection to you.",
    );
  });
});
