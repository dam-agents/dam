// @vitest-environment happy-dom
// TEST_OVERVIEW: What the Satellites UI says about a files satellite — a Satellite that offers one directory as a mount instead of tools. Its row is tagged by what it is rather than by a tool count, adding it promises the mount within 30 seconds and no restart, and removing it warns that agents lose the mount rather than tools and job history.
import type { SatelliteView } from "api-server-api";
import type { ReactElement } from "react";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toasts: { kind: string; message: string }[] = [];
const confirmed: { message: ReactElement; title: string }[] = [];
const grant = { mutate: vi.fn() };

const satellite: SatelliteView = {
  name: "lab",
  kind: "files",
  filesWritable: true,
  description: null,
  host: "lab.local",
  online: true,
  draining: false,
  lastSeenAt: null,
  tools: [],
  maxConcurrent: 16,
  activeJobs: 0,
  grantedAgentIds: [],
};

vi.mock("../../modules/satellites/api/queries.js", () => ({
  NO_SATELLITES: [],
  useSatellites: () => ({ data: [satellite] }),
}));
vi.mock("../../modules/satellites/api/mutations.js", () => ({
  useGrantSatellite: () => grant,
  useRevokeSatellite: () => ({ mutate: () => {} }),
  useRemoveSatellite: () => ({ mutate: () => {}, isPending: false }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgents: () => ({ data: { list: [] } }),
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (state: unknown) => unknown) =>
    select({
      showConfirm: async (message: ReactElement, title: string) => {
        confirmed.push({ message, title });
        return false;
      },
    }),
}));
vi.mock("../../lib/toast.js", () => ({
  emitToast: (toast: { kind: string; message: string }) => toasts.push(toast),
}));

const { SatelliteRow } =
  await import("../../modules/satellites/components/satellite-row.js");
const { useAgentSatellites } =
  await import("../../modules/satellites/hooks/use-agent-satellites.js");
const { useRemoveSatelliteWithConfirm } =
  await import("../../modules/satellites/hooks/use-remove-satellite.js");

let root: Root | undefined;

function render(element: ReactElement) {
  if (root) act(() => root?.unmount());
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  toasts.length = 0;
  confirmed.length = 0;
  grant.mutate.mockReset();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

describe("a files satellite's row", () => {
  /**
   * TEST_SCENARIO: AC-13. A files satellite has no tools to count, so its tag
   * says what it is and whether the worker was started writable, with the machine
   * it is.
   */
  it("is tagged by what it is, not by a tool count", () => {
    const container = render(createElement(SatelliteRow, { satellite }));

    expect(container.textContent).toContain("files · writable · lab.local");
  });

  /**
   * TEST_SCENARIO: AC-13. A worker started without `--write` reads as read-only,
   * which is the fact an Agent meets as "Read-only file system".
   */
  it("reads as read-only when it is not writable", () => {
    const container = render(
      createElement(SatelliteRow, {
        satellite: { ...satellite, filesWritable: false },
      }),
    );

    expect(container.textContent).toContain("files · read-only");
  });
});

describe("what adding and removing a files satellite says", () => {
  /**
   * TEST_SCENARIO: AC-13. A grant mounts the tree within the mount server's
   * polling window and needs no restart, unlike a tool surface whose tools are
   * read when a harness starts.
   */
  it("promises the mount within 30 seconds when the satellite is added", () => {
    const container = render(
      createElement(function Harness() {
        const { grantControls } = useAgentSatellites("agent-1");
        return createElement("button", {
          onClick: () => grantControls(satellite).onToggle(true),
        });
      }),
    );

    act(() => container.querySelector("button")!.click());
    grant.mutate.mock.calls[0]![1].onSuccess();

    expect(toasts).toHaveLength(1);
    expect(toasts[0]!.message).toContain("/mnt/sat/lab");
    expect(toasts[0]!.message).toContain("30 seconds");
    expect(toasts[0]!.message).not.toContain("harness");
  });

  /**
   * TEST_SCENARIO: AC-13. Removing a files satellite costs no job history,
   * because it has no Jobs, so the confirm names the mount alone.
   */
  it("warns that agents lose the mount when the satellite is removed", async () => {
    const container = render(
      createElement(function Harness() {
        const { confirmAndRemove } = useRemoveSatelliteWithConfirm();
        return createElement("button", {
          onClick: () => void confirmAndRemove(satellite),
        });
      }),
    );

    await act(async () => container.querySelector("button")!.click());

    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.title).toBe("Remove lab?");
    const text = JSON.stringify(confirmed[0]!.message);
    expect(text).toContain("/mnt/sat/lab");
    expect(text).not.toContain("job history");
    expect(text).not.toContain("tools");
  });
});
