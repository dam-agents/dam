import { fab } from "@fortawesome/free-brands-svg-icons";
import { fas } from "@fortawesome/free-solid-svg-icons";

type IconDefinition = (typeof fas)[keyof typeof fas];

function byName(pack: Record<string, IconDefinition>) {
  const names = new Map<string, IconDefinition>();
  for (const definition of Object.values(pack)) {
    names.set(definition.iconName, definition);
    for (const alias of definition.icon[2]) {
      if (typeof alias === "string" && !names.has(alias))
        names.set(alias, definition);
    }
  }
  return names;
}

const SOLID = byName(fas);
const BRANDS = byName(fab);

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

function isOneEmoji(value: string): boolean {
  const segments = [...graphemes.segment(value)];
  return (
    segments.length === 1 &&
    /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(value)
  );
}

function fontAwesomeIcon(name: string): IconDefinition | undefined {
  return SOLID.get(name) ?? BRANDS.get(name);
}

const STYLE_CLASS = /^(?:fa|fas|fab|fa-solid|fa-brands)\s+/;

function namedFontAwesomeIcon(value: string): IconDefinition | undefined {
  const name = value.toLowerCase().replace(STYLE_CLASS, "");
  return (
    fontAwesomeIcon(name) ??
    (name.startsWith("fa-") ? fontAwesomeIcon(name.slice(3)) : undefined)
  );
}

export type ArtifactIconParse =
  { ok: true; icon: string } | { ok: false; reason: string };

/**
 * UNIT_BOUNDARY_DESCRIPTION: An artifact's icon, the favicon of its browser
 * tab: one emoji, or the name of an icon of the free Font Awesome solid or
 * brands set. The agent picks it when it publishes, so `parseArtifactIcon`
 * turns what it wrote into the stored form (the emoji itself, or the icon's
 * canonical name, with an alias or an `fa-` prefix resolved) and refuses
 * anything else with a reason the agent can act on. `artifactIconSvg` draws a
 * stored icon as a small SVG document, which the share page inlines and the
 * app serves by the icon's value, so no page loads Font Awesome itself.
 */
export function parseArtifactIcon(raw: string): ArtifactIconParse {
  const value = raw.trim();
  if (value === "") return { ok: false, reason: "the icon is empty" };
  if (isOneEmoji(value)) return { ok: true, icon: value };
  const definition = namedFontAwesomeIcon(value);
  if (definition) return { ok: true, icon: definition.iconName };
  return {
    ok: false,
    reason: `"${raw}" is neither one emoji nor the name of a free Font Awesome icon (such as "chart-line" or "list-check")`,
  };
}

function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

const FONT_AWESOME_ATTRIBUTION =
  "<!-- Font Awesome Free by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free (Icons: CC BY 4.0) -->";

const ICON_INK = `<style>path{fill:#161616}@media (prefers-color-scheme:dark){path{fill:#f2f4f8}}</style>`;

export function artifactIconSvg(icon: string): string | null {
  if (isOneEmoji(icon)) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text x="50" y="50" font-size="86" text-anchor="middle" dominant-baseline="central">${escapeXml(icon)}</text></svg>`;
  }
  const definition = fontAwesomeIcon(icon);
  if (!definition) return null;
  const [width, height, , , path] = definition.icon;
  const d = Array.isArray(path) ? path.join(" ") : path;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${FONT_AWESOME_ATTRIBUTION}${ICON_INK}<path d="${escapeXml(d)}"/></svg>`;
}

export function artifactIconDataUrl(icon: string): string | null {
  const svg = artifactIconSvg(icon);
  return svg && `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
