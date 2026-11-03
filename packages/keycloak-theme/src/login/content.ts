/* UNIT_BOUNDARY_DESCRIPTION: The login page's deployment-specific content: the
 * docs link, the community link and the testimonials. Each deployment sets them
 * through the chart's keycloak.login values, which reach the theme as the
 * PLATFORM_LOGIN_* properties; readLoginContent turns those into the one
 * LoginContent value the sections read. An empty docs URL, a community link
 * without both a label and a URL, or no testimonials hides that part of the
 * page. Testimonials are a JSON list of { name, role, quote }; an entry that is
 * not one is dropped with a console warning, so a bad value never breaks the
 * sign-in page. A quote may name the product as {brand}. */

export type Testimonial = {
  name: string;
  role: string;
  quote: string;
  initials: string;
  color: string;
};

export type CommunityLink = { label: string; url: string };

export type LoginContent = {
  docsUrl: string;
  community: CommunityLink | undefined;
  testimonials: Testimonial[];
};

export type LoginContentProperties = {
  PLATFORM_LOGIN_DOCS_URL: string;
  PLATFORM_LOGIN_COMMUNITY_LABEL: string;
  PLATFORM_LOGIN_COMMUNITY_URL: string;
  PLATFORM_LOGIN_TESTIMONIALS: string;
};

const AVATAR_COLORS = ["#4589ff", "#42be65", "#a56eff", "#ee5396", "#0f62fe"];

export function readLoginContent(
  properties: LoginContentProperties,
): LoginContent {
  const label = properties.PLATFORM_LOGIN_COMMUNITY_LABEL.trim();
  const url = properties.PLATFORM_LOGIN_COMMUNITY_URL.trim();
  return {
    docsUrl: properties.PLATFORM_LOGIN_DOCS_URL.trim(),
    community: label && url ? { label, url } : undefined,
    testimonials: parseTestimonials(properties.PLATFORM_LOGIN_TESTIMONIALS),
  };
}

export function parseTestimonials(raw: string): Testimonial[] {
  if (raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[keycloak-theme] PLATFORM_LOGIN_TESTIMONIALS is not JSON");
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn("[keycloak-theme] PLATFORM_LOGIN_TESTIMONIALS is not a list");
    return [];
  }
  const testimonials: Testimonial[] = [];
  parsed.forEach((entry: unknown, index) => {
    const name = text(entry, "name");
    const quote = text(entry, "quote");
    if (!name || !quote) {
      console.warn(
        `[keycloak-theme] testimonial ${index} has no name or quote; skipped`,
      );
      return;
    }
    testimonials.push({
      name,
      quote,
      role: text(entry, "role"),
      initials: initialsOf(name),
      color: AVATAR_COLORS[testimonials.length % AVATAR_COLORS.length]!,
    });
  });
  return testimonials;
}

function text(entry: unknown, key: string): string {
  if (typeof entry !== "object" || entry === null) return "";
  const value = (entry as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? words[words.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

export function withBrand(quote: string, brand: string): string {
  return quote.split("{brand}").join(brand);
}
