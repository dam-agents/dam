import type { ExtraProps } from "react-markdown";

export type HastElement = NonNullable<ExtraProps["node"]>;
type HastChild = HastElement["children"][number];

/** Raw source text of a rendered code block. rehype-highlight wraps every
 *  token in nested <span>s, so the text only exists at the leaves — walk the
 *  hast node instead of reading React children. */
export function codeBlockText(node: HastElement | undefined): string {
  if (!node) return "";
  // mdast keeps interior CRLF verbatim and mdast-util-to-hast appends its own
  // trailing "\n", so normalize both: a paste into a terminal should carry no
  // ^M and not auto-execute the last line.
  return collectText(node).replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

function collectText(node: HastElement | HastChild): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(collectText).join("");
  return "";
}
