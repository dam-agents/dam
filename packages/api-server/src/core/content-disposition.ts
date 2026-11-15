// UNIT_BOUNDARY_DESCRIPTION: The RFC 6266 attachment disposition for a stored file: an ASCII `filename` every client reads plus the real name as `filename*`, so a Czech or emoji name reaches the browser instead of throwing inside a header value. Line breaks, quotes and backslashes never reach either form.
export function contentDisposition(name: string): string {
  const cleaned = name.replace(/[\r\n"\\]/g, "").trim() || "artifact";
  const ascii = cleaned.replace(/[^\x20-\x7e]/gu, "_");
  const encoded = encodeURIComponent(cleaned).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
