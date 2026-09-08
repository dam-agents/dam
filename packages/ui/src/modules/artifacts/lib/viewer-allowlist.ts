import { viewerEmailSchema } from "api-server-api";

export function normalizeViewerEmail(raw: string): string | null {
  const parsed = viewerEmailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function sameViewers(a: readonly string[], b: readonly string[]) {
  const left = new Set(a);
  const right = new Set(b);
  return (
    left.size === right.size && [...left].every((email) => right.has(email))
  );
}
