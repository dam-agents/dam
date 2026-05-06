import { Cable } from "lucide-react";

/**
 * Per-app brand icon. Known app ids resolve to a brand SVG under
 * `/icons/`; everything else falls back to a `Cable` glyph — visually
 * distinct from KeyRound (which generic app-connection rows use) and
 * Globe (MCP rows), and reads as "user-supplied integration." SVGs
 * carry their own `fill` so they render the same in light/dark themes
 * without runtime CSS gymnastics.
 *
 * Brand SVGs are SimpleIcons-style canonical glyphs (Apache 2.0).
 */
const ICON_BY_APP_ID: Record<string, string> = {
  github: "/icons/github.svg",
  "github-enterprise": "/icons/github-enterprise.svg",
  spotify: "/icons/spotify.svg",
  gmail: "/icons/gmail.svg",
  "google-admin": "/icons/google-admin.svg",
  "google-analytics": "/icons/google-analytics.svg",
  "google-calendar": "/icons/google-calendar.svg",
  "google-classroom": "/icons/google-classroom.svg",
  "google-docs": "/icons/google-docs.svg",
  "google-drive": "/icons/google-drive.svg",
  "google-forms": "/icons/google-forms.svg",
  "google-health": "/icons/google-health.svg",
  "google-meet": "/icons/google-meet.svg",
  "google-photos": "/icons/google-photos.svg",
  "google-search-console": "/icons/google-search-console.svg",
  "google-sheets": "/icons/google-sheets.svg",
  "google-slides": "/icons/google-slides.svg",
  "google-tasks": "/icons/google-tasks.svg",
  youtube: "/icons/youtube.svg",
};

interface Props {
  appId: string;
  /** Alt text — usually the app's display name. */
  alt: string;
  /** Pixel size; matches Lucide's default 16. */
  size?: number;
}

export function OAuthAppIcon({ appId, alt, size = 16 }: Props) {
  const src = ICON_BY_APP_ID[appId];
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        // `block` prevents the inline-img baseline gap inside the
        // flex-centered icon slot.
        className="block"
      />
    );
  }
  return <Cable size={size} aria-label={alt} />;
}
