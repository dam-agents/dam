import type { ZodError } from "zod";

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function errnoCode(e: unknown): string | undefined {
  return e instanceof Error && "code" in e && typeof e.code === "string"
    ? e.code
    : undefined;
}

export function zodIssuesMessage(error: ZodError): string {
  return error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}
