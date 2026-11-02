export type ToolContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolContent {
  content: ToolContentBlock[];
  isError?: boolean;
  [key: string]: unknown;
}

export interface TextContent extends ToolContent {
  content: { type: "text"; text: string }[];
}

export function textResult(text: string): TextContent {
  return { content: [{ type: "text", text }] };
}

export function json(value: unknown): TextContent {
  return textResult(JSON.stringify(value, null, 2));
}

export function errorResult(text: string): TextContent {
  return { content: [{ type: "text", text }], isError: true };
}

export async function run(
  fn: () => Promise<ToolContent>,
): Promise<ToolContent> {
  try {
    return await fn();
  } catch (err) {
    return errorResult(err instanceof Error ? err.message : String(err));
  }
}
