export interface ToolCallArgumentRow {
  name: string;
  value: string;
  json: boolean;
}

const rowOf = (name: string, value: unknown): ToolCallArgumentRow =>
  typeof value === "string"
    ? { name, value, json: false }
    : typeof value === "number"
      ? { name, value: String(value), json: false }
      : { name, value: JSON.stringify(value, null, 2), json: true };

// UNIT_BOUNDARY_DESCRIPTION: the arguments of a tool call that has no renderer of its own, as one row per argument name, so the person who answers reads names and values and not one JSON block. A string or a number shows as it is; any other value shows as JSON. Null when the arguments are not an object of named values, which then show as JSON.
export function toolCallArgumentRows(
  value: unknown,
): ToolCallArgumentRow[] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  return Object.entries(value).map(([name, entry]) => rowOf(name, entry));
}
