/**
 * Bundled default brand icon. Used when `BRAND_ICON_SVG` env var is unset
 * (i.e. no Helm `brand.icon` override). The icon is rasterized on demand by
 * the brand-icon routes; admins override it via Helm without rebuilding the
 * api-server image.
 *
 * Two bundled variants of the "DAM" square mark:
 *
 *   - `DEFAULT_BRAND_ICON_SVG` is the favicon source. It adapts to the
 *     browser/OS color scheme via an embedded `prefers-color-scheme` media
 *     query: a black square with white letters in light mode, a gradient
 *     square with black letters in dark mode. Browsers that honor media
 *     queries in SVG favicons (Chrome, Firefox) switch automatically; the
 *     rest fall back to the light-mode default.
 *   - `DEFAULT_BRAND_ICON_RASTER_SVG` is the source for the PNG rasters
 *     (PWA + Apple touch icons), which cannot adapt to color scheme. It is
 *     the gradient square so the installed-app icon reads on any home
 *     screen.
 *
 * Inlined as TS strings (not file reads at startup) so the api-server has
 * no filesystem dependency at module init and the icon ships with the
 * compiled bundle exactly once.
 */

// The three "DAM" glyphs, centered in the 270×270 square. `attr` carries the
// fill — a CSS class for the adaptive favicon, a fixed color for the raster.
const damLetters = (
  attr: string,
): string => String.raw`<path ${attr} d="M162.314 162.226V107H174.103L188.265 133.98H188.582L202.586 107H213.9V162.226H204.01V122.587H203.694L199.421 131.369L188.107 152.257L176.793 131.369L172.52 122.587H172.204V162.226H162.314Z"/>
<path ${attr} d="M154.171 162.226H143.332L138.901 148.143H119.279L114.928 162.226H104.326L122.84 107H135.816L154.171 162.226ZM136.369 139.202L129.249 116.494H128.853L121.811 139.202H136.369Z"/>
<path ${attr} d="M57 162.226V107H77.0966C91.4966 107 100.912 116.257 100.912 134.613C100.912 152.969 91.4966 162.226 77.0966 162.226H57ZM67.4439 152.969H77.0966C84.8504 152.969 89.835 148.38 89.835 138.965V130.261C89.835 120.846 84.8504 116.257 77.0966 116.257H67.4439V152.969Z"/>`;

const GRADIENT = String.raw`<linearGradient id="dam-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f5d5d5"/><stop offset="100%" stop-color="#c9d5f0"/></linearGradient>`;

export const DEFAULT_BRAND_ICON_SVG = String.raw`<svg viewBox="0 0 270 270" xmlns="http://www.w3.org/2000/svg" aria-label="DAM">
<style>.dam-bg{fill:#000}.dam-fg{fill:#fff}@media (prefers-color-scheme:dark){.dam-bg{fill:url(#dam-grad)}.dam-fg{fill:#000}}</style>
<defs>${GRADIENT}</defs>
<rect class="dam-bg" width="270" height="270"/>
${damLetters(`class="dam-fg"`)}
</svg>`;

export const DEFAULT_BRAND_ICON_RASTER_SVG = String.raw`<svg viewBox="0 0 270 270" xmlns="http://www.w3.org/2000/svg" aria-label="DAM">
<defs>${GRADIENT}</defs>
<rect width="270" height="270" fill="url(#dam-grad)"/>
${damLetters(`fill="black"`)}
</svg>`;
