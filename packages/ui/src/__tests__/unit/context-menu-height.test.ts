import { createElement, Fragment, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ContextMenuContent } from "../../components/ui/context-menu.js";

vi.mock("@radix-ui/react-context-menu", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  Portal: ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children),
  Content: ({ className }: { className: string }) =>
    createElement("div", { className }),
}));

describe("ContextMenuContent", () => {
  it("caps its height at the space Radix reports and scrolls past it", () => {
    const html = renderToStaticMarkup(createElement(ContextMenuContent));
    expect(html).toContain(
      "max-h-[var(--radix-context-menu-content-available-height)]",
    );
    expect(html).toContain("overflow-y-auto");
  });
});
