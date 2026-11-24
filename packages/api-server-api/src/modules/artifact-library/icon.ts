const PICTOGRAPH = String.raw`\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?\u20E3?`;
const KEYCAP = String.raw`[0-9#*]\uFE0F?\u20E3`;
const FLAG = String.raw`\p{Regional_Indicator}{2}`;
const ONE_EMOJI = new RegExp(
  String.raw`^(?:${FLAG}|${KEYCAP}|${PICTOGRAPH}(?:\u200D${PICTOGRAPH})*)$`,
  "u",
);

export const ARTIFACT_ICON_MAX_LENGTH = 32;

/**
 * UNIT_BOUNDARY_DESCRIPTION: An artifact's icon, one emoji its Agent picks so
 * the user tells the artifact apart in the library and in its browser tab.
 * `isArtifactIcon` is the one rule every writer passes, so a stored icon
 * always draws; `artifactIconSvg` draws it as the small SVG document a tab
 * shows as its favicon, from the emoji alone, in the server's pages and the
 * app alike.
 */
export function isArtifactIcon(value: string): boolean {
  if (value.length === 0 || value.length > ARTIFACT_ICON_MAX_LENGTH)
    return false;
  return ONE_EMOJI.test(value);
}

export const ARTIFACT_ICON_RULE =
  'the icon must be exactly one emoji, such as "📈" or "🗓️"';

export function artifactIconSvg(icon: string): string | null {
  if (!isArtifactIcon(icon)) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="50" font-size="86" text-anchor="middle" dominant-baseline="central">${icon}</text></svg>`;
}

export function artifactIconDataUrl(icon: string): string | null {
  const svg = artifactIconSvg(icon);
  return svg && `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
