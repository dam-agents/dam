export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function errnoCode(e: unknown): string | undefined {
  return e instanceof Error && "code" in e && typeof e.code === "string"
    ? e.code
    : undefined;
}
