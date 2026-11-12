export const BRAND_ICON_HREF = "/api/brand/icon.svg";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The favicon of the app's browser tab. An
 * artifact opened alone, at `/artifacts/<id>/view`, shows the icon its Agent
 * picked, drawn by the api-server from the icon's value, so several artifact
 * tabs can be told apart; every other page, and an artifact with no icon,
 * shows the brand icon.
 */
export function documentIconHref(artifactIcon: string | null | undefined) {
  return artifactIcon
    ? `/api/public/artifact-icon?icon=${encodeURIComponent(artifactIcon)}`
    : BRAND_ICON_HREF;
}

export function applyDocumentIcon(doc: Document, href: string): void {
  const link = doc.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) return;
  if (link.getAttribute("href") === href) return;
  link.setAttribute("href", href);
}
