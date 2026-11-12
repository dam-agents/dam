import { artifactIconDataUrl } from "api-server-api";

export const BRAND_ICON_HREF = "/api/brand/icon.svg";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The favicon of the app's browser tab. An
 * artifact opened alone, at `/artifacts/<id>/view`, shows its icon, the emoji
 * its Agent or owner picked, so several artifact tabs can be told apart;
 * every other page, and an artifact with no icon, shows the brand icon, as
 * its share page does.
 */
export function documentIconHref(artifactIcon: string | null | undefined) {
  return (artifactIcon && artifactIconDataUrl(artifactIcon)) ?? BRAND_ICON_HREF;
}

export function applyDocumentIcon(doc: Document, href: string): void {
  const link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  if (link.getAttribute("href") === href) return;
  link.setAttribute("href", href);
}
