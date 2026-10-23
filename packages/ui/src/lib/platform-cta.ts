export function parsePlatformCta(raw: string): {
  message: string;
  cta: string | null;
} {
  const cta = raw.match(/platform-cta:(\S+)/)?.[1] ?? null;
  const message = raw.replace(/\nplatform-cta:\S+/, "").trim();
  return { message, cta };
}
