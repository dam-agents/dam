// @vitest-environment happy-dom
// TEST_OVERVIEW: a user tells a kit the platform team publishes from a kit another user published, on the catalog tile and in the kit modal's header. The team's kit names the install's brand, as configured, beside a mark; a user's kit names that user, and only the header links the user's page, because the whole tile is one button.
import type { StarterKitPublisher, StarterKitView } from "api-server-api";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../brand.js", () => ({ getBrand: () => ({ name: "Acme" }) }));

const { KitPublisher } =
  await import("../../modules/starter-kits/components/kit-publisher.js");
const { KitCard } =
  await import("../../modules/starter-kits/components/kit-browser.js");

const TEAM: StarterKitPublisher = { kind: "team" };
const USER: StarterKitPublisher = {
  kind: "user",
  name: "Adi Digidh",
  url: "https://github.com/adigidh",
};

function kit(publisher: StarterKitPublisher | undefined): StarterKitView {
  return {
    schemaVersion: "v1",
    id: "software-factory",
    name: "Software Factory",
    description: "Turns an issue into a reviewed pull request.",
    category: "software",
    egressRules: [],
    connections: [],
    channels: [],
    schedules: [],
    skills: [],
    env: [],
    startupItems: [],
    catalog: "curated",
    version: "a".repeat(40),
    source: "https://github.com/acme/software-factory",
    skillsInKit: [],
    ...(publisher ? { publisher } : {}),
  };
}

function byline(publisher: StarterKitPublisher, surface: "tile" | "header") {
  return renderToStaticMarkup(
    createElement(KitPublisher, { publisher, surface }),
  );
}

function text(html: string): string {
  return (
    new DOMParser().parseFromString(html, "text/html").body.textContent ?? ""
  );
}

describe("KitPublisher", () => {
  // TEST_SCENARIO: the team's kit says it is the install's own by the brand the install configures, never a name written in the code.
  it("names the install's brand on a kit the team publishes", () => {
    const html = byline(TEAM, "header");
    expect(text(html)).toBe("By Acme");
    expect(html).toContain("<svg");
    expect(html).not.toContain("<a ");
  });

  // TEST_SCENARIO: in the modal header a user's kit names the user and links the page the catalog entry gives, so the user can find who to ask about it.
  it("links the user who publishes a kit from the modal header", () => {
    const html = byline(USER, "header");
    expect(text(html)).toBe("By Adi Digidh");
    expect(html).toContain('href="https://github.com/adigidh"');
    expect(html).toContain('target="_blank"');
  });

  // TEST_SCENARIO: a user named with no page, and any user on a tile, is named as plain text: a tile is one button, and a link inside a button is a control nobody can reach.
  it("names a user without a link on the tile, or when the entry gives none", () => {
    expect(byline(USER, "tile")).not.toContain("<a ");
    expect(text(byline(USER, "tile"))).toBe("By Adi Digidh");
    const nameOnly = byline({ kind: "user", name: "Jane Doe" }, "header");
    expect(nameOnly).not.toContain("<a ");
    expect(text(nameOnly)).toBe("By Jane Doe");
  });
});

describe("KitCard", () => {
  const card = (publisher: StarterKitPublisher | undefined) =>
    renderToStaticMarkup(
      createElement(KitCard, {
        kit: kit(publisher),
        templates: [],
        templateById: new Map(),
        onOpen: () => {},
      }),
    );

  // TEST_SCENARIO: two kits of the same kind sit side by side in one list, and each tile says who publishes it, so a user picks the team's or the user's on purpose.
  it("says on the tile who publishes the kit", () => {
    expect(text(card(TEAM))).toContain("By Acme");
    expect(text(card(USER))).toContain("By Adi Digidh");
    expect(card(USER)).not.toContain("<a ");
  });

  it("shows no byline for a kit the view names no publisher for", () => {
    expect(card(undefined)).not.toContain('data-testid="kit-publisher"');
  });
});
