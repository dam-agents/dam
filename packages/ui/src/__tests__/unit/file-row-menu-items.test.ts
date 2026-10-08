import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FileRowMenuItems } from "../../modules/files/components/file-row-menu-items.js";

const Item = ({ children }: { children: ReactNode }) =>
  createElement("li", null, children);

const render = (path: string) =>
  renderToStaticMarkup(
    createElement(FileRowMenuItems, {
      path,
      isDir: false,
      onAction: () => {},
      Item,
    }),
  );

describe("FileRowMenuItems", () => {
  it("offers Edit for an ordinary file", () => {
    expect(render("work/AGENTS.md")).toContain("<li>Edit</li>");
  });

  it("does not offer Edit for the root AGENTS.md", () => {
    expect(render("AGENTS.md")).not.toContain("<li>Edit</li>");
  });
});
