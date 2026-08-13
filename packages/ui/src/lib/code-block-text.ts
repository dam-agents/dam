import type { ExtraProps } from "react-markdown";

export type HastElement = NonNullable<ExtraProps["node"]>;
type HastChild = HastElement["children"][number];

export function codeBlockText(node: HastElement | undefined): string {
  if (!node) return "";
  return collectText(node).replace(/\r\n?/g, "\n").replace(/\n+$/, "");
}

function collectText(node: HastElement | HastChild): string {
  if (node.type === "text") return node.value;
  if (node.type === "element") return node.children.map(collectText).join("");
  return "";
}
