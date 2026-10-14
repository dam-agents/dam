const SERVER_PREFIXES = [
  /^mcp__(?:[A-Za-z0-9-]|_(?!_))+__(?<tool>.+)$/,
  /^mcp\.[\w-]+\.(?<tool>.+)$/,
  /^Tool: [\w-]+\/(?<tool>.+)$/,
];
const BOB_LABEL = /^Running (?<tool>[\w ]+) \([\w:-]+\)$/;

function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textOf(block: unknown): string | null {
  if (typeof block === "string") return block;
  const text = objectOf(block)?.text;
  return typeof text === "string" ? text : null;
}

function textsOf(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.map(textOf).filter((text): text is string => text !== null);
}

function contentTexts(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((entry) => {
    const item = objectOf(entry);
    return item?.type === "content" ? textsOf([item.content]) : [];
  });
}

export function resultObjectTexts(update: unknown): string[] {
  const output = objectOf(objectOf(update)?.rawOutput);
  if (!output) return [];
  const result = output.result;
  return [
    ...textsOf(result),
    ...textsOf(objectOf(result)?.content),
    ...textsOf(output.content),
    ...textsOf(objectOf(output.error)?.message),
  ];
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Reads a tool call's output and name the same way
 * on every harness, because each ACP adapter shapes them its own way.
 * Output is in the standard `content` (Pi, Bob, often Claude Code), in
 * `rawOutput` as Claude Code's raw tool result (text or text blocks), or in a
 * result object in `rawOutput` (Codex `{result, error}`, Bob `{result}`, Pi
 * `{content, details}`). Codex and Pi send a shell command's output only in
 * `_meta`, one new part per update. The runtime reads spawn lines and artifact
 * markers from these texts, and the chat shows them, so this is the one place
 * that knows the shapes.
 */
export function toolOutputTexts(update: unknown): string[] {
  const fields = objectOf(update);
  if (!fields) return [];
  return [
    ...new Set([
      ...contentTexts(fields.content),
      ...textsOf(fields.rawOutput),
      ...resultObjectTexts(update),
    ]),
  ];
}

export function terminalOutputPart(update: unknown): string | null {
  const meta = objectOf(objectOf(update)?._meta);
  const output =
    objectOf(meta?.terminal_output_delta) ?? objectOf(meta?.terminal_output);
  const data = output?.data;
  return typeof data === "string" && data !== "" ? data : null;
}

export function toolNameOf(title: string): string {
  const trimmed = title.trim();
  for (const prefix of SERVER_PREFIXES) {
    const tool = prefix.exec(trimmed)?.groups?.tool;
    if (tool) return tool;
  }
  const label = BOB_LABEL.exec(trimmed)?.groups?.tool;
  return label ? label.toLowerCase().replace(/ /g, "_") : trimmed;
}
