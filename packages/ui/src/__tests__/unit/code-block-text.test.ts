import { describe, expect, test } from "vitest";

import { codeBlockText, type HastElement } from "../../lib/code-block-text.js";

/** `<pre>` as rehype-highlight leaves it: text only at the token leaves. */
function pre(...lines: string[]): HastElement {
  const source = lines.join("");
  return {
    type: "element",
    tagName: "pre",
    properties: {},
    children: [
      {
        type: "element",
        tagName: "code",
        properties: { className: ["hljs", "language-js"] },
        children: source.split(/(?<=\n)/).map((line) => ({
          type: "element" as const,
          tagName: "span",
          properties: { className: ["hljs-line"] },
          children: [{ type: "text" as const, value: line }],
        })),
      },
    ],
  };
}

describe("codeBlockText", () => {
  test("joins text across nested token spans", () => {
    expect(codeBlockText(pre("const a = 1;\n"))).toBe("const a = 1;");
  });

  test("no node, empty fence and whitespace-only fence", () => {
    expect(codeBlockText(undefined)).toBe("");
    expect(codeBlockText(pre(""))).toBe("");
    expect(codeBlockText(pre("   \n"))).toBe("   ");
  });

  test("drops every trailing newline, not just the appended one", () => {
    expect(codeBlockText(pre("a\n\n\n"))).toBe("a");
  });

  test("normalizes interior CRLF so a paste carries no ^M", () => {
    expect(codeBlockText(pre("a\r\n", "b\r\n"))).toBe("a\nb");
  });

  test("preserves indentation and interior blank lines", () => {
    expect(codeBlockText(pre("if (x) {\n", "\n", "  y();\n", "}\n"))).toBe(
      "if (x) {\n\n  y();\n}",
    );
  });
});
