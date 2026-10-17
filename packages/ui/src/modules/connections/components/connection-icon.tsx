import {
  BareMetalServer,
  Link,
  LogoKubernetes,
  LogoSlack,
  LogoYoutube,
  Password,
} from "@carbon/icons-react";
import type { ComponentType, SVGProps } from "react";

import {
  GithubIcon,
  SpotifyIcon,
  TelegramIcon,
} from "@/components/brand-icons";

const MONOCHROME_BY_SLUG = new Map<
  string,
  ComponentType<SVGProps<SVGSVGElement>>
>([
  ["github", GithubIcon],
  ["github-enterprise", GithubIcon],
  ["kubernetes", LogoKubernetes],
  ["slack", LogoSlack],
  ["spotify", SpotifyIcon],
  ["telegram", TelegramIcon],
  ["youtube", LogoYoutube],
]);

const SVG_BY_SLUG = new Set([
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
]);

interface Props {
  iconSlug: string | undefined;
  alt: string;
  size?: number;
  className?: string;
}

export function ConnectionIcon({ iconSlug, alt, size = 16, className }: Props) {
  const Monochrome = iconSlug ? MONOCHROME_BY_SLUG.get(iconSlug) : undefined;
  if (Monochrome) {
    return (
      <Monochrome
        width={size}
        height={size}
        {...(alt
          ? { role: "img", "aria-label": alt }
          : { "aria-hidden": true })}
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
    return (
      <BareMetalServer size={size} aria-label={alt} className={className} />
    );
  }
  if (iconSlug === "key") {
    return <Password size={size} aria-label={alt} className={className} />;
  }
  return <Link size={size} aria-label={alt} className={className} />;
}
