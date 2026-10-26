// @vitest-environment happy-dom
// TEST_OVERVIEW: One Environment's card in an agent's Environments list, at any width: it brings its own padding; each item of its status line stays whole, so the line wraps only between items; its controls are one menu on the name row; each endpoint's name, port and address are cells of their own; a long name and a long address truncate at the end and show in full on hover.
import type { EnvironmentView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";

vi.mock("../../modules/environments/api/mutations.js", () => ({
  useExtendEnvironment: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEnvironment: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../../store.js", () => ({
  useStore: (select: (s: Record<string, unknown>) => unknown) =>
    select({ showConfirm: vi.fn() }),
}));

const { EnvironmentCard, environmentAccessLabel } =
  await import("../../modules/environments/components/environment-card.js");

const longName = "pr-5728-a-rather-long-environment-name-for-a-narrow-card";
const longUrl = `https://app-${longName}-abcdef0123456789.env.example.com/some/long/path`;

const environment: EnvironmentView = {
  id: "agent-env1",
  owningAgentId: "agent-dev",
  name: longName,
  endpoints: [{ name: "app", port: 4444, url: longUrl }],
  access: null,
  expiresAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  createdAt: new Date().toISOString(),
  state: "running",
  nesting: null,
};

function render(access: string[] | null) {
  const html = renderToStaticMarkup(
    createElement(
      TooltipProvider,
      null,
      createElement(EnvironmentCard, {
        environment: { ...environment, access },
      }),
    ),
  );
  return new DOMParser().parseFromString(html, "text/html");
}

describe("an Environment's card", () => {
  // TEST_SCENARIO: every access text the card can show is one whole status item; none of them, nor the state or the expiry, can wrap inside itself.
  it.each([
    [null, "Your whole list may open it"],
    [[], "Only you may open it"],
    [["reviewer@example.com", "qa@example.com"], "2 of your list may open it"],
  ] as const)("keeps each status item whole for access %j", (access, text) => {
    expect(environmentAccessLabel(access === null ? null : [...access])).toBe(
      text,
    );
    const doc = render(access === null ? null : [...access]);

    const status = doc.querySelector('[data-testid="environment-status"]');
    expect(status?.className).toContain("flex-wrap");
    const items = [...(status?.children ?? [])];
    expect(items.map((i) => i.textContent)).toEqual([
      "Running",
      "·Expires in 2 d",
      `·${text}`,
    ]);
    for (const item of items)
      expect(item.className).toContain("whitespace-nowrap");
  });

  // TEST_SCENARIO: a long name and a long address truncate at the end and carry their full text on hover; the address takes the width the endpoint's name and port leave.
  it("truncates a long name and address, with each in full on hover", () => {
    const doc = render(null);

    const name = doc.querySelector('[data-testid="environment-card"] p');
    expect(name?.textContent).toBe(longName);
    expect(name?.getAttribute("title")).toBe(longName);
    expect(name?.className).toContain("truncate");

    const link = doc.querySelector(`a[href="${longUrl}"]`);
    expect(link?.getAttribute("title")).toBe(longUrl);
    expect(link?.className).toContain("min-w-0");
    expect(link?.querySelector("span")?.className).toContain("truncate");
    const endpoints = doc.querySelector(
      '[data-testid="environment-endpoints"]',
    );
    expect(endpoints?.className).toContain("minmax(0,1fr)");
  });

  // TEST_SCENARIO: the card brings its own padding, so it looks the same in the settings page's separated list and in the side panel; its controls are one menu on the name row, at any width.
  it("pads itself and keeps its controls in one menu on the name row", () => {
    const doc = render(null);

    const card = doc.querySelector('[data-testid="environment-card"]');
    expect(card?.className.split(" ")).toEqual(
      expect.arrayContaining(["px-4", "py-3"]),
    );
    const header = card?.firstElementChild;
    expect(header?.className.split(" ")).toContain("flex");
    expect(header?.className.split(" ")).not.toContain("flex-col");
    const actions = header?.querySelector(
      '[data-testid="environment-actions"]',
    );
    expect(actions?.getAttribute("aria-label")).toBe(`Actions for ${longName}`);
    expect(header?.lastElementChild).toBe(actions);
    expect(doc.querySelector("select")).toBeNull();
  });

  // TEST_SCENARIO: each endpoint row has its name, its port and its address in cells of their own: the port right-aligned with tabular digits, the name column at a shared minimum width, so ports line up in a card and the addresses start at one x.
  it("puts an endpoint's name, port and address in their own cells", () => {
    const html = renderToStaticMarkup(
      createElement(
        TooltipProvider,
        null,
        createElement(EnvironmentCard, {
          environment: {
            ...environment,
            endpoints: [
              { name: "ui", port: 4444, url: "https://ui.example.com" },
              { name: "keycloak", port: 4445, url: "https://kc.example.com" },
            ],
          },
        }),
      ),
    );
    const doc = new DOMParser().parseFromString(html, "text/html");

    const endpoints = doc.querySelector(
      '[data-testid="environment-endpoints"]',
    );
    expect(endpoints?.className).toContain(
      "grid-cols-[auto_auto_minmax(0,1fr)]",
    );
    const rows = [...(endpoints?.children ?? [])];
    expect(rows.map((r) => [...r.children].map((c) => c.textContent))).toEqual([
      ["ui", "4444", "https://ui.example.com"],
      ["keycloak", "4445", "https://kc.example.com"],
    ]);
    for (const row of rows) {
      expect(row.className).toContain("grid-cols-subgrid");
      const [name, port] = [...row.children];
      expect(name?.className).toContain("min-w-[8ch]");
      expect(port?.className.split(" ")).toEqual(
        expect.arrayContaining(["text-right", "tabular-nums"]),
      );
    }
  });
});
