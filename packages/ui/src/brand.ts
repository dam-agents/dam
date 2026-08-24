import { type Brand, brandSchema } from "api-server-api";

const FALLBACK: Brand = {
  name: "Platform",
  short: "platform",
  title: "",
  vendor: "",
  theme: {
    light: {
      accent: "#0F62FE",
      accentHover: "#0353E9",
      accentLight: "#edf5ff",
    },
    dark: { accent: "#4589FF", accentHover: "#78A9FF", accentLight: "#0f1f3a" },
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
    console.warn("[brand] failed to load /api/brand, using fallback", err);
  }
  return cached;
}

export function getBrand(): Brand {
  return cached;
}

const COLOR_RE =
  /^(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-zA-Z]+)$/;

function setSafe(el: HTMLElement, prop: string, value: string): void {
  if (COLOR_RE.test(value)) el.style.setProperty(prop, value);
}

export function applyBrand(brand: Brand): void {
  document.title = brand.title || brand.name;

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

  const prev = (html as { __brandThemeObserver?: MutationObserver })
    .__brandThemeObserver;
  prev?.disconnect();
  const obs = new MutationObserver(applyActiveTheme);
  obs.observe(html, { attributes: true, attributeFilter: ["class"] });
  (html as { __brandThemeObserver?: MutationObserver }).__brandThemeObserver =
    obs;
}
