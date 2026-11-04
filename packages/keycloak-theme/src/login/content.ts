import { useEffect, useState } from "react";

import { safeDocsUrl } from "./lib/docs-url.js";

/* UNIT_BOUNDARY_DESCRIPTION: The login page's deployment-specific content. The
 * docs link and the community link are the chart's keycloak.login values, read
 * from the PLATFORM_LOGIN_* properties by readLoginContent; an empty docs URL,
 * or a community link without both a label and a URL, hides it. The
 * testimonials are what operators saved in the platform: useTestimonials
 * fetches them from the api-server at PLATFORM_API_URL when the page loads,
 * and gives an empty list while loading, on a failure or after five seconds,
 * so the section stays hidden and sign-in never waits for it. A quote may name
 * the product as {brand}. */

export type Testimonial = {
  name: string;
  role: string;
  quote: string;
  photoUrl: string | null;
  initials: string;
  color: string;
};

export type CommunityLink = { label: string; url: string };

export type LoginContent = {
  docsUrl: string;
  community: CommunityLink | undefined;
};

export type LoginContentProperties = {
  PLATFORM_DOCS_URL: string;
  PLATFORM_LOGIN_COMMUNITY_LABEL: string;
  PLATFORM_LOGIN_COMMUNITY_URL: string;
};

const AVATAR_COLORS = ["#4589ff", "#42be65", "#a56eff", "#ee5396", "#0f62fe"];
const FETCH_TIMEOUT_MS = 5000;

export function readLoginContent(
  properties: LoginContentProperties,
): LoginContent {
  const label = properties.PLATFORM_LOGIN_COMMUNITY_LABEL.trim();
  const url = properties.PLATFORM_LOGIN_COMMUNITY_URL.trim();
  return {
    docsUrl: safeDocsUrl(properties.PLATFORM_DOCS_URL.trim()) ?? "",
    community: label && url ? { label, url } : undefined,
  };
}

export function useTestimonials(apiUrl: string): Testimonial[] {
  const [testimonials, setTestimonials] = useState<Testimonial[]>([]);
  useEffect(() => {
    if (!apiUrl) return;
    let unmounted = false;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    fetch(`${apiUrl.replace(/\/$/, "")}/api/public/login-testimonials`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((body: unknown) => setTestimonials(toTestimonials(body)))
      .catch((err: unknown) => {
        if (unmounted) return;
        console.warn(
          "[keycloak-theme] testimonials not shown:",
          controller.signal.aborted ? "no answer in time" : err,
        );
      })
      .finally(() => clearTimeout(timer));
    return () => {
      unmounted = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [apiUrl]);
  return testimonials;
}

export function toTestimonials(body: unknown): Testimonial[] {
  const list =
    typeof body === "object" && body !== null && "testimonials" in body
      ? (body as { testimonials: unknown }).testimonials
      : [];
  if (!Array.isArray(list)) return [];
  const testimonials: Testimonial[] = [];
  for (const entry of list) {
    const name = text(entry, "name");
    const quote = text(entry, "quote");
    if (!name || !quote) continue;
    const photoUrl = text(entry, "photoUrl");
    testimonials.push({
      name,
      quote,
      role: text(entry, "role"),
      photoUrl: photoUrl || null,
      initials: initialsOf(name),
      color: AVATAR_COLORS[testimonials.length % AVATAR_COLORS.length]!,
    });
  }
  return testimonials;
}

function text(entry: unknown, key: string): string {
  if (typeof entry !== "object" || entry === null) return "";
  const value = (entry as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? words[words.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}

export function withBrand(quote: string, brand: string): string {
  return quote.split("{brand}").join(brand);
}
