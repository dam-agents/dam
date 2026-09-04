import type { ArtifactVisibility } from "api-server-api";

export const PUBLIC_SHARE_TITLE = "Share with anyone who has the link?";

export function becomesPublic(
  saved: ArtifactVisibility,
  next: ArtifactVisibility,
): boolean {
  return next === "public" && saved !== "public";
}

export function publicShareMessage(vendor: string): string {
  const audience = vendor
    ? `Anyone with this link can view the content without signing in. This includes people outside of ${vendor}.`
    : "Anyone with this link can view the content without signing in.";
  return `${audience} Make sure you're comfortable sharing this artifact publicly before proceeding.`;
}
