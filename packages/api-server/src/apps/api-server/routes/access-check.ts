import { Hono } from "hono";
import { z } from "zod";
import { getLogger } from "../../../core/logger.js";
import { bearerMatches } from "../../../modules/access-list/index.js";

const bodySchema = z.object({ email: z.string().min(1).max(254) });

/**
 * UNIT_BOUNDARY_DESCRIPTION: `POST /internal/access-check`, which Keycloak's
 * access-list required action calls on the api-server's in-cluster Service at
 * each sign-in, with the person's email. It answers only whether that address
 * is on the Access List. It sits outside `/api`, so no browser sign-in applies
 * to it; the install's shared secret, which only the Keycloak and api-server
 * pods hold, is the gate, and a call without it is refused before the list is
 * read. A failed read answers 503, so Keycloak refuses the sign-in as
 * unavailable instead of as not allowed.
 */
export function createAccessCheckRoutes(deps: {
  secret: string;
  allows: (email: string) => Promise<boolean>;
}) {
  const routes = new Hono();
  routes.post("/", async (c) => {
    if (!bearerMatches(c.req.header("Authorization"), deps.secret))
      return c.json({ error: "unauthorized" }, 401);
    const body = bodySchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "email required" }, 400);
    try {
      return c.json({ allowed: await deps.allows(body.data.email) });
    } catch (err) {
      getLogger().warn({ err }, "access_list.check_failed");
      return c.json({ error: "access list unavailable" }, 503);
    }
  });
  return routes;
}
