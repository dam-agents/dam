import type { ArtifactKind } from "api-server-api";

/** Extensions that render as highlighted code in-app and on the share page. */
const CODE_EXTENSIONS = new Set([
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "py",
  "go",
  "rs",
  "java",
  "kt",
  "c",
  "h",
  "cpp",
  "hpp",
  "cs",
  "rb",
  "php",
  "swift",
  "sh",
  "bash",
  "zsh",
  "sql",
  "yaml",
  "yml",
  "json",
  "toml",
  "xml",
  "css",
  "scss",
  "dockerfile",
  "tf",
  "proto",
  "graphql",
  "lua",
  "r",
  "pl",
  "ex",
  "exs",
]);

const TEXT_EXTENSIONS = new Set(["txt", "log", "csv", "tsv", "env", "ini"]);

const KIND_BY_EXTENSION: ReadonlyArray<[ArtifactKind, ReadonlySet<string>]> = [
  ["html", new Set(["html", "htm"])],
  ["jsx", new Set(["jsx"])],
  ["markdown", new Set(["md", "markdown"])],
  ["code", CODE_EXTENSIONS],
  ["text", TEXT_EXTENSIONS],
];

export const DEFAULT_CONTENT_TYPE: Record<ArtifactKind, string> = {
  html: "text/html; charset=utf-8",
  jsx: "text/jsx; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  code: "text/plain; charset=utf-8",
  text: "text/plain; charset=utf-8",
  binary: "application/octet-stream",
};

export function extensionOf(fileName: string): string {
  const base = fileName.split("/").pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

/** Content heuristics ported from slop's `detect.ts`. Order matters: an
 *  explicit `import` opener wins for JSX, then strong HTML anchors are checked
 *  before the weaker JSX signals so HTML-with-embedded-React reads as HTML. */
function detectTextKind(content: string): ArtifactKind | null {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("import ")) return "jsx";
  const lower = trimmed.slice(0, 200).toLowerCase();
  if (
    lower.startsWith("<!doctype html") ||
    lower.startsWith("<html") ||
    lower.startsWith("<head") ||
    lower.startsWith("<body") ||
    content.trimEnd().toLowerCase().endsWith("</html>")
  ) {
    return "html";
  }
  if (
    /\bexport default\b/.test(content) ||
    /from ["']react["']/.test(content) ||
    content.includes("React.createElement") ||
    /\buse(State|Effect|Ref|Memo)\s*\(/.test(content)
  ) {
    return "jsx";
  }
  return null;
}

/** True when the buffer looks like text (no NUL in the first 8 KiB and valid
 *  enough UTF-8). Cheap gate before treating uploaded bytes as a text kind. */
export function looksLikeText(content: Buffer): boolean {
  const probe = content.subarray(0, 8192);
  return !probe.includes(0);
}

/** Resolve the artifact kind: explicit wins, then the file extension, then
 *  content sniffing for text, else binary. */
export function detectKind(input: {
  explicit?: ArtifactKind;
  fileName?: string;
  content?: Buffer;
}): ArtifactKind {
  if (input.explicit) return input.explicit;
  if (input.fileName) {
    const ext = extensionOf(input.fileName);
    for (const [kind, exts] of KIND_BY_EXTENSION) {
      if (exts.has(ext)) return kind;
    }
    if (ext !== "") return "binary";
  }
  if (input.content && looksLikeText(input.content)) {
    const text = input.content.toString("utf8");
    return detectTextKind(text) ?? "text";
  }
  return input.content ? "binary" : "text";
}

/** Kinds whose bytes are utf-8 text (previewable in-app without base64). */
export function isTextKind(kind: ArtifactKind): boolean {
  return kind !== "binary";
}

/** File name fallback when the caller supplied none — derived from the title
 *  so downloads and highlighting have something sensible to key off. */
export function defaultFileName(title: string, kind: ArtifactKind): string {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "artifact";
  const ext: Record<ArtifactKind, string> = {
    html: "html",
    jsx: "jsx",
    markdown: "md",
    code: "txt",
    text: "txt",
    binary: "bin",
  };
  return `${base}.${ext[kind]}`;
}
