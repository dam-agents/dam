import { Hono } from "hono";
import type { AddressSets } from "../../../core/address-sets.js";
import { getLogger } from "../../../core/logger.js";
import type { PublicTestimonials } from "../../../modules/login-testimonials/index.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: `GET /api/public/login-testimonials`, which the
 * login page on Keycloak's host fetches with no sign-in. Only the Keycloak
 * origins of the install's address sets may read it from a browser; any other
 * origin gets no CORS header; every answer varies by Origin, so a shared cache
 * never hands one origin's answer to another. A minute of caching lets an
 * operator's save reach the page within a minute. A failed read answers 503 and
 * is not cached, so a short outage is not remembered as an empty list; the
 * page hides the section on any failure and sign-in is unaffected.
 */
export function createLoginTestimonialsRoutes(deps: {
  read: PublicTestimonials;
  addresses: AddressSets;
}) {
  const allowed = new Set(
    deps.addresses.all.map((set) => new URL(set.keycloakExternalUrl).origin),
  );
  const routes = new Hono();
  routes.get("/", async (c) => {
    const origin = c.req.header("Origin");
    c.header("Vary", "Origin");
    if (origin !== undefined && allowed.has(origin))
      c.header("Access-Control-Allow-Origin", origin);
    try {
      const testimonials = await deps.read();
      c.header("Cache-Control", "public, max-age=60");
      return c.json({ testimonials });
    } catch (err) {
      getLogger().warn({ err }, "login_testimonials.read_failed");
      c.header("Cache-Control", "no-store");
      return c.json({ error: "testimonials unavailable" }, 503);
    }
  });
  return routes;
}
