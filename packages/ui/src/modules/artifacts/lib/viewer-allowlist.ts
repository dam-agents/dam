import { viewerEmailSchema } from "api-server-api";

export function normalizeViewerEmail(raw: string): string | null {
  const parsed = viewerEmailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function sameViewers(a: readonly string[], b: readonly string[]) {
  return a.length === b.length && a.every((email, i) => email === b[i]);
}
