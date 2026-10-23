import { parseMarkdown, tableToAscii, type Content } from "chat";
import { match, P } from "ts-pattern";
import type { SlackBlock } from "./slack-gateway.js";

type MdNode = Content;

type MdList = Extract<MdNode, { type: "list" }>;

const SECTION_CHARS = 3000;

const SLACK_TOKEN = /(<[@#!][^<>\s]+>)/;

function escaped(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapedKeepingTokens(text: string): string {
  return text
    .split(SLACK_TOKEN)
    .map((part, i) => (i % 2 === 1 ? part : escaped(part)))
    .join("");
}

function inline(nodes: MdNode[]): string {
  return nodes.map(toMrkdwn).join("");
}

function fenced(code: string): string {
  return `\`\`\`\n${escaped(code)}\n\`\`\``;
}

function listToMrkdwn(list: MdList, depth: number): string {
  const indent = "    ".repeat(depth);
  return list.children
    .map((item, i) => {
      const bullet = list.ordered ? `${(list.start ?? 1) + i}.` : "•";
      return item.children
        .map((child, j) =>
          child.type === "list"
            ? listToMrkdwn(child, depth + 1)
            : `${indent}${j === 0 ? `${bullet} ` : "  "}${toMrkdwn(child)}`,
        )
        .join("\n");
    })
    .join("\n");
}

function toMrkdwn(node: MdNode): string {
  return match(node)
    .with({ type: "paragraph" }, (n) => inline(n.children))
    .with({ type: "heading" }, (n) => `*${inline(n.children)}*`)
    .with({ type: "text" }, (n) => escapedKeepingTokens(n.value))
    .with({ type: "strong" }, (n) => `*${inline(n.children)}*`)
    .with({ type: "emphasis" }, (n) => `_${inline(n.children)}_`)
    .with({ type: "delete" }, (n) => `~${inline(n.children)}~`)
    .with({ type: "inlineCode" }, (n) => `\`${escaped(n.value)}\``)
    .with({ type: "code" }, (n) => fenced(n.value))
    .with({ type: "link" }, (n) => {
      const label = inline(n.children);
      return label && label !== escaped(n.url)
        ? `<${n.url}|${label}>`
        : `<${n.url}>`;
    })
    .with({ type: "image" }, (n) =>
      n.alt ? `<${n.url}|${escaped(n.alt)}>` : `<${n.url}>`,
    )
    .with({ type: "linkReference" }, (n) => inline(n.children))
    .with({ type: "imageReference" }, (n) => escaped(n.alt ?? ""))
    .with({ type: "footnoteReference" }, (n) => `[^${n.label ?? n.identifier}]`)
    .with(
      { type: "footnoteDefinition" },
      (n) =>
        `[^${n.label ?? n.identifier}]: ${n.children.map(toMrkdwn).join(" ")}`,
    )
    .with({ type: "blockquote" }, (n) =>
      n.children
        .map(toMrkdwn)
        .join("\n\n")
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n"),
    )
    .with({ type: "list" }, (n) => listToMrkdwn(n, 0))
    .with({ type: "listItem" }, (n) => n.children.map(toMrkdwn).join("\n"))
    .with({ type: "table" }, (n) => fenced(tableToAscii(n)))
    .with({ type: "tableRow" }, (n) => n.children.map(toMrkdwn).join(" | "))
    .with({ type: "tableCell" }, (n) => inline(n.children))
    .with({ type: "break" }, () => "\n")
    .with({ type: "thematicBreak" }, () => "———")
    .with({ type: "html" }, (n) => escapedKeepingTokens(n.value))
    .with({ type: P.union("definition", "yaml") }, () => "")
    .exhaustive(() => "");
}

const FENCE = "```";

function cutPoint(text: string, limit: number): number {
  const head = text.slice(0, limit);
  const newline = head.lastIndexOf("\n");
  const space = head.lastIndexOf(" ");
  const half = limit / 2;
  let at = newline > half ? newline : space > half ? space : limit;
  const entity = /&[a-z]{0,4}$/.exec(text.slice(0, at));
  if (entity && entity.index > half) at = entity.index;
  const open = text.lastIndexOf("<", at - 1);
  if (open > half && open > text.lastIndexOf(">", at - 1)) at = open;
  if (/[\uD800-\uDBFF]/.test(text.charAt(at - 1))) at -= 1;
  return at;
}

function opensFence(piece: string): boolean {
  return piece.split(FENCE).length % 2 === 0;
}

function slices(text: string): string[] {
  const limit = SECTION_CHARS - 2 * (FENCE.length + 1);
  const out: string[] = [];
  let rest = text;
  while (rest.length > SECTION_CHARS) {
    const at = cutPoint(rest, limit);
    const piece = rest.slice(0, at);
    rest = rest.slice(at).replace(/^\n/, "");
    if (opensFence(piece)) {
      out.push(`${piece}\n${FENCE}`);
      rest = `${FENCE}\n${rest}`;
    } else {
      out.push(piece);
    }
  }
  out.push(rest);
  return out;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: An agent's Markdown as Slack mrkdwn `section`
 * blocks, for a post that carries a file. Such a post is made by
 * `files.completeUploadExternal`, which fails with `internal_error` when its
 * blocks hold a `markdown` block, so the text Slack renders from Markdown
 * elsewhere is converted here instead. A section holds at most 3000
 * characters, so the text is split between top-level parts (paragraphs, lists,
 * code blocks), and a part longer than that is cut into pieces. Slack renders
 * each section alone, so a cut falls at a line break or a space where it can,
 * never inside an entity, a `<...>` link or mention, or a surrogate pair, and
 * a code block cut in two is closed at the end of one piece and opened again
 * at the start of the next. mrkdwn reads
 * `&`, `<` and `>` as markup, so they are escaped, except in a mention written
 * in Slack's own form (`<@U...>`, `<#C...>`, `<!here>`).
 */
export function markdownToSections(markdown: string): SlackBlock[] {
  const parts = parseMarkdown(markdown)
    .children.map(toMrkdwn)
    .filter((part) => part.trim() !== "")
    .flatMap(slices);
  const sections: string[] = [];
  let current = "";
  for (const part of parts) {
    const joined = current ? `${current}\n\n${part}` : part;
    if (current && joined.length > SECTION_CHARS) {
      sections.push(current);
      current = part;
    } else {
      current = joined;
    }
  }
  if (current) sections.push(current);
  return sections.map((text) => ({
    type: "section",
    text: { type: "mrkdwn", text },
  }));
}
