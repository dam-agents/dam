const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|svg\+xml)[;,]/i;

export function safeMediaUrl(
  url: string,
  kind: "image" | "media",
): string | null {
  if (kind === "image" && DATA_IMAGE.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}
