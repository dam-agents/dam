import { Cable, KeyRound, Server } from "lucide-react";

import { GithubIcon } from "@/components/brand-icons";

const SVG_BY_SLUG = new Set([
  "github-enterprise",
  "gmail",
  "google-admin",
  "google-analytics",
  "google-calendar",
  "google-classroom",
  "google-docs",
  "google-drive",
  "google-forms",
  "google-health",
  "google-meet",
  "google-photos",
  "google-search-console",
  "google-sheets",
  "google-slides",
  "google-tasks",
  "slack",
  "spotify",
  "youtube",
]);

interface Props {
  iconSlug: string | undefined;
  alt: string;
  size?: number;
  className?: string;
}

export function ConnectionIcon({ iconSlug, alt, size = 16, className }: Props) {
  if (iconSlug === "github") {
    return (
      <GithubIcon
        width={size}
        height={size}
        aria-label={alt}
        className={`block ${className ?? ""}`.trim()}
      />
    );
  }
  if (iconSlug && SVG_BY_SLUG.has(iconSlug)) {
    return (
      <img
        src={`/icons/${iconSlug}.svg`}
        alt={alt}
        width={size}
        height={size}
        className={`block ${className ?? ""}`.trim()}
      />
    );
  }
  if (iconSlug === "mcp") {
    return <Server size={size} aria-label={alt} className={className} />;
  }
  if (iconSlug === "key") {
    return <KeyRound size={size} aria-label={alt} className={className} />;
  }
  return <Cable size={size} aria-label={alt} className={className} />;
}
