// @vitest-environment happy-dom
// TEST_OVERVIEW: a user with a link to a kit's repository finds "Import from link" beside the starter kit search, whether or not the catalog has loaded; the dialog it opens takes the link and opens that kit's page, and refuses a link that names no repository, as the form under the catalog did before.
import { LINKED_KIT_CATALOG } from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { StarterKitCatalog } from "../../modules/starter-kits/components/browse-kits-modal.js";

const navigateToStarterKit = vi.fn();
const kits = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
}));

vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ navigateToStarterKit }),
}));
vi.mock("../../modules/starter-kits/api/queries.js", () => ({
  useStarterKits: () => kits.state,
}));
vi.mock("../../modules/connections/api/queries.js", () => ({
  useConnectionTemplates: () => ({ data: [] }),
}));
vi.mock("../../modules/agents/hooks/use-create-default-agent.js", () => ({
  useCreateDefaultAgent: () => ({ create: vi.fn(), ready: true }),
}));

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let onOpenKit: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  navigateToStarterKit.mockReset();
  onOpenKit = vi.fn<() => void>();
  kits.state = { data: [], isPending: false, isError: false };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(StarterKitCatalog, { onOpenKit }),
      ),
    ),
  );
}

const importButton = () =>
  container.querySelector<HTMLButtonElement>('[data-testid="kit-link-import"]');
const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const buttonNamed = (name: string) =>
  [...(dialog()?.querySelectorAll("button") ?? [])].find(
    (b) => b.textContent?.trim() === name,
  );

async function openDialog() {
  await act(async () => importButton()?.click());
}

async function paste(value: string) {
  const input = dialog()?.querySelector("input") as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  await act(async () => buttonNamed("Open kit")?.click());
}

// TEST_SCENARIO: the catalog has loaded; the button sits in the search row beside the search field, and no link field shows until the user asks for it.
it("puts Import from link beside the search", () => {
  mount();
  const search = container.querySelector('[aria-label="Search starter kits"]');
  expect(importButton()?.textContent).toContain("Import from link");
  expect(importButton()?.parentElement?.contains(search)).toBe(true);
  expect(container.querySelector('[data-testid="kit-link-form"]')).toBeNull();
  expect(dialog()).toBeNull();
});

// TEST_SCENARIO: the catalog is still loading, or failed to load; a kit link does not need it, so the button is there all the same.
it.each([
  { isPending: true, isError: false },
  { isPending: false, isError: true, refetch: vi.fn() },
])("offers Import from link without a catalog (%o)", (state) => {
  kits.state = { data: undefined, ...state };
  mount();
  expect(importButton()).not.toBeNull();
});

// TEST_SCENARIO: the user pastes a kit link and presses Open kit; the dialog closes, the surface around the catalog is told (the Browse starter kits dialog closes on it) and the kit's page opens.
it("opens the kit page of a pasted link", async () => {
  mount();
  await openDialog();
  expect(dialog()?.textContent).toContain("Import a starter kit");
  expect(dialog()?.textContent).toContain(
    "A public GitHub repository with a kit.yaml.",
  );
  await paste("https://github.com/acme/shared-kit");
  await submit();
  expect(navigateToStarterKit).toHaveBeenCalledWith(
    LINKED_KIT_CATALOG,
    "acme/shared-kit",
  );
  expect(onOpenKit).toHaveBeenCalledOnce();
  expect(dialog()).toBeNull();
});

// TEST_SCENARIO: a link into a folder names no kit; the dialog stays open and says what to paste instead, and nothing is opened.
it("refuses a link that names no repository", async () => {
  mount();
  await openDialog();
  await paste("https://github.com/acme/shared-kit/tree/main/kits/a");
  await submit();
  expect(dialog()?.querySelector('[role="alert"]')?.textContent).toContain(
    "not a link to a branch or folder",
  );
  expect(navigateToStarterKit).not.toHaveBeenCalled();
  expect(onOpenKit).not.toHaveBeenCalled();
});

// TEST_SCENARIO: an empty field cannot be submitted, and Cancel closes the dialog without opening anything.
it("cancels without opening a kit", async () => {
  mount();
  await openDialog();
  expect(buttonNamed("Open kit")?.disabled).toBe(true);
  await act(async () => buttonNamed("Cancel")?.click());
  expect(dialog()).toBeNull();
  expect(navigateToStarterKit).not.toHaveBeenCalled();
  expect(onOpenKit).not.toHaveBeenCalled();
});
