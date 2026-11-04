export function safeDocsUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const { protocol } = new URL(raw);
    return protocol === "https:" || protocol === "http:" ? raw : null;
  } catch {
    return null;
  }
}
