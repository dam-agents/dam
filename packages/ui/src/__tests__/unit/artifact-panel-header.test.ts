// @vitest-environment happy-dom
// TEST_OVERVIEW: The artifact panel's top bar shows only the actions users take most: the title, the version switcher, Share with the current visibility, Download, Open in new tab, a ⋮ menu and close. Open in new tab opens the app's own page for the artifact, so a private artifact, which has no share link, opens in its own tab too, and its icon is the in-app one. The ⋮ menu holds the rest: Rename and Move, then Edit source and Start a new session, then View source, then Set expiration and Delete. There is no Full page: a wider panel or Open in new tab covers it. The artifact page in its own tab shows the same bar without the actions it has no use for, and another artifact's route starts it afresh.
import { Popup } from "@carbon/icons-react";
import type { ArtifactVersionInfo, LibraryArtifact } from "api-server-api";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

const fake = vi.hoisted(() => ({
  artifact: null as unknown,
  versions: [] as unknown[],
  agentListed: true,
}));

vi.mock("../../modules/artifacts/api/queries.js", () => ({
  useArtifact: () => ({
    data: fake.artifact,
    isPending: false,
    isError: false,
    refetch: async () => {},
  }),
  useArtifactVersions: () => ({ data: fake.versions }),
  useArtifactContent: () => ({
    data: {
      content: "<p>hi</p>",
      contentType: "text/html",
      fileName: "page.html",
      binary: false,
      tooLarge: false,
    },
    isLoading: false,
  }),
  useArtifactPreview: () => ({ data: "<p>hi</p>", isLoading: false }),
}));
vi.mock("../../modules/artifacts/api/mutations.js", () => ({
  useDeleteArtifact: () => ({
    mutate: (_: unknown, opts?: { onSuccess?: () => void }) =>
      opts?.onSuccess?.(),
  }),
  useSaveArtifactContent: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSendArtifactPrompt: () => ({ mutateAsync: vi.fn() }),
  useCallAgentApi: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("../../modules/agents/api/queries.js", () => ({
  useAgentsList: () =>
    fake.agentListed ? [{ id: "agent-1", name: "Jeeves" }] : [],
  cachedAgent: () => undefined,
}));

const { useStore } = await import("../../store.js");
const { ArtifactPanel } =
  await import("../../modules/artifacts/components/artifact-panel.js");
const { ArtifactPageView } =
  await import("../../modules/artifacts/views/artifact-page-view.js");

function artifact(overrides: Partial<LibraryArtifact> = {}): LibraryArtifact {
  return {
    id: "art-1",
    title: "PM dashboard",
    slug: "pm-dashboard",
    kind: "html",
    contentType: "text/html",
    fileName: "page.html",
    sizeBytes: 9,
    version: 2,
    folderId: null,
    sourcePath: null,
    agentId: "agent-1",
    visibility: "private",
    interactive: false,
    expiresAt: null,
    viewCount: 0,
    shareUrl: null,
    viewers: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-02T00:00:00.000Z",
    ...overrides,
  };
}

function versions(n: number): ArtifactVersionInfo[] {
  return Array.from({ length: n }, (_, i) => ({
    version: i + 1,
    createdAt: "2026-11-01T00:00:00.000Z",
    sizeBytes: 9,
    contentType: "text/html",
    author: null,
  })) as unknown as ArtifactVersionInfo[];
}

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

function render(props: { standalone?: boolean } = {}) {
  act(() =>
    root.render(
      createElement(
        TooltipProvider,
        null,
        createElement(ArtifactPanel, {
          artifactId: "art-1",
          agentId: null,
          onBack: props.standalone ? undefined : () => {},
          close: props.standalone
            ? undefined
            : createElement("button", { "aria-label": "Close panel" }),
          standalone: props.standalone,
        }),
      ),
    ),
  );
}

const bar = () => host.querySelector(".h-12")!;
const barLabels = () =>
  [...bar().querySelectorAll("button, a")].map(
    (el) => el.getAttribute("aria-label") ?? el.textContent?.trim(),
  );

function openMenu(): string[] {
  const trigger = host.querySelector<HTMLElement>(
    '[aria-label="More actions"]',
  )!;
  act(() => {
    trigger.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
  const menu = document.querySelector('[role="menu"]')!;
  return [...menu.children].map((el) =>
    el.getAttribute("role") === "separator" ? "—" : el.textContent!.trim(),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  fake.artifact = artifact();
  fake.versions = versions(2);
  fake.agentListed = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

describe("artifact panel top bar", () => {
  // TEST_SCENARIO: AC-2 — an artifact with two versions is docked; the bar shows the title, the version switcher, Share with its visibility, Download, Open in new tab, the ⋮ menu and close, and nothing else.
  it("shows only the primary actions", () => {
    render();
    expect(bar().textContent).toContain("PM dashboard");
    expect(barLabels()).toEqual([
      "Back to artifacts",
      "Older version",
      "v2 / 2",
      "Newer version",
      "Share: Private",
      "Download",
      "Open in new tab",
      "More actions",
      "Close panel",
    ]);
    expect(bar().textContent).toContain("Private");
  });

  // TEST_SCENARIO: AC-1 — a private artifact has no share link, yet Open in new tab is there and points at the app's own page for it, in a new tab, so the chat stays in the first one.
  it("opens a private artifact in a new tab", () => {
    render();
    const link = bar().querySelector<HTMLAnchorElement>(
      '[aria-label="Open in new tab"]',
    )!;
    expect(link.getAttribute("href")).toBe("/artifacts/art-1");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  // TEST_SCENARIO: Open in new tab stays in the app, so it carries the in-app Popup icon, not Launch, which marks a link that leaves the app.
  it("marks Open in new tab with the in-app icon", () => {
    render();
    const link = bar().querySelector('[aria-label="Open in new tab"]')!;
    expect(link.innerHTML).toBe(
      renderToStaticMarkup(createElement(Popup, { size: 16 })),
    );
  });

  // TEST_SCENARIO: the Share button names the visibility the artifact has now, so the state and the means to change it sit in one place.
  it("names the current visibility on Share", () => {
    fake.artifact = artifact({
      visibility: "public",
      shareUrl: "https://share.example.com/a/pm-dashboard",
    });
    render();
    expect(barLabels()).toContain("Share: Public");
  });

  // TEST_SCENARIO: AC-3 — the ⋮ menu lists Rename and Move first, then Edit source and Start a new session, then View source, then Set expiration and Delete. It offers no Full page.
  it("puts every other action in the menu", () => {
    render();
    expect(openMenu()).toEqual([
      "Rename",
      "Move",
      "—",
      "Edit source",
      "Start a new session",
      "—",
      "View source",
      "—",
      "Set expiration",
      "Delete artifact",
    ]);
  });

  // TEST_SCENARIO: an upload has no publishing Agent and a code artifact has no rendered preview, so the menu leaves out Start a new session and View source rather than offer what does nothing.
  it("leaves out actions the artifact cannot take", () => {
    fake.artifact = artifact({ kind: "code", agentId: null });
    fake.agentListed = false;
    render();
    const items = openMenu();
    expect(items).not.toContain("Start a new session");
    expect(items).not.toContain("View source");
    expect(items).toContain("Rename");
  });

  // TEST_SCENARIO: View source in the menu shows the source of a rendered artifact, and the same item, now View preview, takes it back.
  it("switches between the preview and the source", () => {
    render();
    expect(host.querySelector("iframe")).not.toBeNull();
    openMenu();
    act(() => {
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((el) => el.textContent?.trim() === "View source")!
        .click();
    });
    expect(host.querySelector("iframe")).toBeNull();
    expect(openMenu()).toContain("View preview");
  });
});

describe("artifact page in its own tab", () => {
  // TEST_SCENARIO: the artifact page already fills its tab, so it has no Back, no close, no Open in new tab and no Full page; Share, Download and the rest of the menu stay.
  it("shows the bar without the panel's own actions", () => {
    render({ standalone: true });
    expect(barLabels()).toEqual([
      "Older version",
      "v2 / 2",
      "Newer version",
      "Share: Private",
      "Download",
      "More actions",
    ]);
    expect(openMenu()).not.toContain("Full page");
  });

  // TEST_SCENARIO: the user pins an older version on one artifact's page, then the route changes to another artifact; that artifact's page opens at its latest version, as it would in a new tab.
  it("starts afresh on another artifact's route", () => {
    useStore.setState({ view: "artifact", pageArtifactId: "art-1" });
    act(() =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(ArtifactPageView, { artifactId: "art-1" }),
        ),
      ),
    );
    act(() => {
      host.querySelector<HTMLElement>('[aria-label="Older version"]')!.click();
    });
    expect(barLabels()).toContain("v1 / 2");
    fake.artifact = artifact({ id: "art-2", title: "Roadmap" });
    act(() =>
      root.render(
        createElement(
          TooltipProvider,
          null,
          createElement(ArtifactPageView, { artifactId: "art-2" }),
        ),
      ),
    );
    expect(barLabels()).toContain("v2 / 2");
  });

  // TEST_SCENARIO: the user deletes the artifact from its own page and confirms; the page leaves the deleted artifact for the Artifacts list instead of a dead route.
  it("opens the Artifacts list after a delete", async () => {
    useStore.setState({
      view: "artifact",
      pageArtifactId: "art-1",
      showConfirm: async () => true,
    });
    render({ standalone: true });
    openMenu();
    await act(async () => {
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((el) => el.textContent?.trim() === "Delete artifact")!
        .click();
    });
    expect(useStore.getState().view).toBe("artifacts");
    expect(window.location.pathname).toBe("/artifacts");
  });
});
