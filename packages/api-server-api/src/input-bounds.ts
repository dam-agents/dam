// UNIT_BOUNDARY_DESCRIPTION: the one size limit on every array in a request from outside the api-server — user and agent tRPC calls, MCP messages, agent request bodies. It checks the raw JSON before any schema parses an element, so no schema parses the elements of a huge array, and no published JSON schema or tool description shows it. The limit sits above the largest explicit `.max()` in the input schemas (20 000 kb-publish files).
export const MAX_INPUT_ARRAY_LENGTH = 100_000;

export const OVERSIZED_ARRAY_MESSAGE = `input array exceeds ${MAX_INPUT_ARRAY_LENGTH} items`;

export function hasOversizedArray(value: unknown): boolean {
  const pending = [value];
  while (pending.length > 0) {
    const next = pending.pop();
    if (Array.isArray(next)) {
      if (next.length > MAX_INPUT_ARRAY_LENGTH) return true;
      for (const item of next) pending.push(item);
    } else if (
      typeof next === "object" &&
      next !== null &&
      [Object.prototype, null].includes(Object.getPrototypeOf(next))
    ) {
      for (const item of Object.values(next)) pending.push(item);
    }
  }
  return false;
}
