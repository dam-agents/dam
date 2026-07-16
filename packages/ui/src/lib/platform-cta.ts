/** The scan/publish services encode a call-to-action URL on a structured
 *  upstream error (not connected / access not granted / repo not allow-listed)
 *  as a trailing `\nplatform-cta:<url>`. Split the human-readable message from
 *  that URL so callers can render a "Fix it" affordance. */
export function parsePlatformCta(raw: string): {
  message: string;
  cta: string | null;
} {
  const cta = raw.match(/platform-cta:(\S+)/)?.[1] ?? null;
  const message = raw.replace(/\nplatform-cta:\S+/, "").trim();
  return { message, cta };
}
