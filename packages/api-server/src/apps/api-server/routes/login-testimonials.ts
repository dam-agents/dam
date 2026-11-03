import { Hono } from "hono";
import type { AddressSets } from "../../../core/address-sets.js";
import { getLogger } from "../../../core/logger.js";
import type { PublicTestimonials } from "../../../modules/login-testimonials/index.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: `GET /api/public/login-testimonials`, which the
 * login page on Keycloak's host fetches with no sign-in. Only the Keycloak
 * origins of the install's address sets may read it from a browser; any other
 * origin gets no CORS header. A minute of caching lets an operator's save reach
 * the page within a minute. A failed read answers an empty list, so the page
 * hides the section and sign-in is unaffected.
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
    if (origin !== undefined && allowed.has(origin)) {
      c.header("Access-Control-Allow-Origin", origin);
      c.header("Vary", "Origin");
    }
    c.header("Cache-Control", "public, max-age=60");
    try {
      return c.json({ testimonials: await deps.read() });
    } catch (err) {
      getLogger().warn({ err }, "login_testimonials.read_failed");
      return c.json({ testimonials: [] });
    }
  });
  return routes;
}
