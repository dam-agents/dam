// @vitest-environment happy-dom
// TEST_OVERVIEW: The owner sees the icon an Agent picked for an artifact,
// TEST_OVERVIEW: before the list row's title and in the panel's top bar, and
// TEST_OVERVIEW: changes or clears it in the Rename dialog, so a bad pick is
// TEST_OVERVIEW: fixed without asking the Agent again.
import type { LibraryArtifact } from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const fake = vi.hoisted(() => ({
  saved: [] as unknown[],
  closed: 0,
}));

vi.mock("../../modules/artifacts/api/mutations.js", () => ({
  useUpdateArtifact: () => ({
    isPending: false,
    mutate: (input: unknown, opts?: { onSuccess?: () => void }) => {
      fake.saved.push(input);
      opts?.onSuccess?.();
    },
  }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentsList: () => [],
  cachedAgent: () => undefined,
}));

const { RenameArtifactDialog } =
  await import("../../modules/artifacts/components/rename-artifact-dialog.js");
const { ArtifactListRow } =
  await import("../../modules/artifacts/components/artifact-list-row.js");

function artifact(overrides: Partial<LibraryArtifact> = {}): LibraryArtifact {
  return {
    id: "art-1",
    title: "Cloud costs",
    icon: "📈",
    slug: "cloud-costs",
    kind: "html",
    contentType: "text/html",
    fileName: "costs.html",
    sizeBytes: 9,
    version: 1,
    folderId: null,
    sourcePath: null,
    agentId: "agent-1",
    visibility: "private",
    interactive: false,
    expiresAt: null,
    viewCount: 0,
    shareUrl: null,
    viewers: [],
    createdAt: "2026-11-12T00:00:00.000Z",
    updatedAt: "2026-11-12T00:00:00.000Z",
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function render(node: Parameters<typeof createElement>[0], props: object) {
  act(() =>
    root.render(
      createElement(TooltipProvider, null, createElement(node, props)),
    ),
  );
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const iconInput = () =>
  document.querySelector<HTMLInputElement>('input[aria-label="Icon"]')!;
const saveButton = () =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === "Save",
  )!;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.saved = [];
  fake.closed = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("the artifact's icon in the library", () => {
  it("leads the list row's title", () => {
    const noop = () => {};
    render(ArtifactListRow, {
      artifact: artifact(),
      depth: 0,
      active: false,
      onClick: noop,
      showCreator: false,
      onEdit: noop,
      onRename: noop,
      onMove: noop,
      onShare: noop,
      onSetRetention: noop,
      onSetPromptModel: noop,
    });
    const text = host.textContent ?? "";
    expect(text).toContain("📈");
    expect(text.indexOf("📈")).toBeLessThan(text.indexOf("Cloud costs"));
  });
});

describe("changing the icon in the Rename dialog", () => {
  const open = (a: LibraryArtifact) =>
    render(RenameArtifactDialog, {
      artifact: a,
      onClose: () => (fake.closed += 1),
    });

  // TEST_SCENARIO: The Agent picked an icon the owner does not like; the owner types another emoji and saves, and only the icon is sent.
  it("saves a new emoji", () => {
    open(artifact());
    expect(iconInput().value).toBe("📈");
    type(iconInput(), "💰");
    act(() => saveButton().click());
    expect(fake.saved).toEqual([{ id: "art-1", icon: "💰" }]);
  });

  it("clears the icon when the field is emptied", () => {
    open(artifact());
    type(iconInput(), "");
    act(() => saveButton().click());
    expect(fake.saved).toEqual([{ id: "art-1", icon: null }]);
  });

  // TEST_SCENARIO: The owner types a word, or two emoji; Save stays disabled and the dialog says what an icon must be, so nothing that cannot draw is sent.
  it("refuses what is not one emoji", () => {
    open(artifact());
    type(iconInput(), "chart");
    expect(saveButton().disabled).toBe(true);
    expect(document.body.textContent).toContain("exactly one emoji");
    type(iconInput(), "📈📊");
    expect(saveButton().disabled).toBe(true);
    expect(fake.saved).toEqual([]);
  });

  it("closes without saving when nothing changed", () => {
    open(artifact());
    act(() => saveButton().click());
    expect(fake.saved).toEqual([]);
    expect(fake.closed).toBe(1);
  });
});
