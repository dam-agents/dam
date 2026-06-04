/**
 * Brand config — fetched from the api-server at bootstrap (`GET /api/brand`).
 *
 * Single source of truth for everything user-visible: display name, theme
 * accent colors, slash-command identifier. Sourced from BRAND_* env vars on
 * the api-server pod (Helm values), so a deployment rebrand needs no UI
 * rebuild — `helm upgrade` flips the values and the next page load picks
 * them up.
 *
 * Theme colors are applied via `applyBrandTheme()` as CSS custom properties
 * on `<html>` so light/dark themes already wired through `App.css` keep
 * working unchanged.
 */
import { type Brand, brandSchema } from "api-server-api";

const FALLBACK: Brand = {
  name: "Platform",
  short: "platform",
  tagline: "",
  theme: {
    light: {
      accent: "#1D6BE1",
      accentHover: "#1556B8",
      accentLight: "#eaf2fe",
    },
    dark: { accent: "#3C92FD", accentHover: "#2F88FD", accentLight: "#0f1f3a" },
  },
};

let cached: Brand = FALLBACK;

export async function loadBrand(): Promise<Brand> {
  try {
    const res = await fetch("/api/brand", { credentials: "omit" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = brandSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.warn(
        "[brand] schema mismatch on /api/brand, using fallback:",
        parsed.error.issues,
      );
      return cached;
    }
    cached = parsed.data;
  } catch (err) {
    // Rare path — only fires when the api-server is unreachable on first
    // paint; the bundled fallback keeps the UI usable.
    console.warn("[brand] failed to load /api/brand, using fallback", err);
  }
  return cached;
}

export function getBrand(): Brand {
  return cached;
}

/** Apply brand to the document — title, theme-color meta, and CSS accent
 *  custom properties. Re-applies when the theme store toggles `.dark` on
 *  `<html>`. Safe to call repeatedly.
 *
 *  Implementation note: theme values reach this function through a fetched
 *  JSON response and are treated as untrusted. We only write them via
 *  `style.setProperty()`, which scopes the input to a CSS *property value*
 *  — even an attacker-shaped string like `"red; } body {"` cannot break
 *  out of the declaration the way it could if we appended a `<style>` tag.
 *  Hex/rgb-shape validation runs on top so a malformed value falls back
 *  silently instead of producing an invalid declaration. */
const COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)$/;

function setSafe(el: HTMLElement, prop: string, value: string): void {
  if (COLOR_RE.test(value)) el.style.setProperty(prop, value);
}

export function applyBrand(brand: Brand): void {
  document.title = brand.tagline || brand.name;

  const themeMeta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]',
  );
  if (themeMeta && COLOR_RE.test(brand.theme.light.accent)) {
    themeMeta.content = brand.theme.light.accent;
  }

  const html = document.documentElement;

  function applyActiveTheme() {
    const t = html.classList.contains("dark")
      ? brand.theme.dark
      : brand.theme.light;
    setSafe(html, "--c-accent", t.accent);
    setSafe(html, "--c-accent-hover", t.accentHover);
    setSafe(html, "--c-accent-light", t.accentLight);
  }

  applyActiveTheme();

  // Re-apply when the theme store flips the `.dark` class on <html>.
  // Idempotent: re-calling applyBrand replaces the observer instead of
  // stacking, so listeners don't leak across HMR or repeated bootstraps.
  const prev = (html as { __brandThemeObserver?: MutationObserver })
    .__brandThemeObserver;
  prev?.disconnect();
  const obs = new MutationObserver(applyActiveTheme);
  obs.observe(html, { attributes: true, attributeFilter: ["class"] });
  (html as { __brandThemeObserver?: MutationObserver }).__brandThemeObserver =
    obs;
}
