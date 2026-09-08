export interface ToolContent {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

export function textResult(text: string): ToolContent {
  return { content: [{ type: "text", text }] };
}

export function json(value: unknown): ToolContent {
  return textResult(JSON.stringify(value, null, 2));
}

export function errorResult(text: string): ToolContent {
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
