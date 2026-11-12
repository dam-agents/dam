// @vitest-environment happy-dom
// TEST_OVERVIEW: An artifact opened alone in a browser tab shows the icon its
// TEST_OVERVIEW: Agent picked as the tab's favicon, so several artifact tabs
// TEST_OVERVIEW: can be told apart; every other page keeps the brand icon.
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyDocumentIcon,
  BRAND_ICON_HREF,
  documentIconHref,
} from "../../lib/document-icon.js";

describe("the app tab's favicon", () => {
  beforeEach(() => {
    document.head.innerHTML = `<link rel="icon" type="image/svg+xml" href="${BRAND_ICON_HREF}" />`;
  });

  const icon = () =>
    document.head.querySelector('link[rel="icon"]')!.getAttribute("href");

  it("is the artifact's icon, drawn by the api-server", () => {
    applyDocumentIcon(document, documentIconHref("chart-line"));
    expect(icon()).toBe("/api/public/artifact-icon?icon=chart-line");
  });

  it("encodes an emoji icon in the address", () => {
    expect(documentIconHref("📈")).toBe(
      `/api/public/artifact-icon?icon=${encodeURIComponent("📈")}`,
    );
  });

  // TEST_SCENARIO: The user goes from an artifact's own page to another page, or the artifact has no icon or has not loaded yet; the tab shows the brand icon again.
  it("is the brand icon without an artifact icon", () => {
    applyDocumentIcon(document, documentIconHref("list-check"));
    applyDocumentIcon(document, documentIconHref(null));
    expect(icon()).toBe(BRAND_ICON_HREF);
    expect(documentIconHref(undefined)).toBe(BRAND_ICON_HREF);
  });
});
