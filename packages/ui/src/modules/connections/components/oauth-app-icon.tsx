import { Cable } from "lucide-react";

/**
 * Per-app brand icon. Known app ids resolve to a brand SVG under
 * `/icons/`; everything else falls back to a `Cable` glyph — visually
 * distinct from KeyRound (which the OneCLI app-connection rows already
 * use) and Globe (MCP rows), and reads as "user-supplied integration."
 * SVGs carry their own `fill` so they render the same in light/dark
 * themes without runtime CSS gymnastics.
 *
 * Brand SVGs sourced from the kagenti/onecli fork (Apache 2.0); the
 * shapes are SimpleIcons-style canonical octocats.
 */
const ICON_BY_APP_ID: Record<string, string> = {
  github: "/icons/github.svg",
  "github-enterprise": "/icons/github-enterprise.svg",
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
