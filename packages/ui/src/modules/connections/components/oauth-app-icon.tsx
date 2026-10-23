import { Link } from "@carbon/icons-react";

import { GithubIcon } from "@/components/brand-icons";

const ICON_BY_APP_ID: Record<string, string> = {
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
  alt: string;
  size?: number;
}

export function OAuthAppIcon({ appId, alt, size = 16 }: Props) {
  if (appId === "github") {
    return <GithubIcon width={size} height={size} aria-label={alt} />;
  }
  const src = ICON_BY_APP_ID[appId];
  if (src) {
    return (
      <img src={src} alt={alt} width={size} height={size} className="block" />
    );
  }
  return <Link size={size} aria-label={alt} />;
}
