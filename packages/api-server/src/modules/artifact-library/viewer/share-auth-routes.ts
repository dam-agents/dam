import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import {
  SHARE_SESSION_COOKIE,
  SHARE_SESSION_TTL_MS,
  safeNextOrRoot,
  type ShareSession,
} from "../domain/share-session.js";
import type { ShareAuthService } from "../services/share-auth-service.js";
import { renderSignInFailed } from "./renderer.js";

export interface ShareAuthRoutesDeps {
  auth: ShareAuthService;
  brandName: string;
  secureCookie: boolean;
}

export function loginPath(next: string | undefined): string {
  return `/auth/login?next=${encodeURIComponent(safeNextOrRoot(next))}`;
}

export async function readShareSession(
  c: Context,
  auth: Pick<ShareAuthService, "getSession">,
): Promise<ShareSession | null> {
  const id = getCookie(c, SHARE_SESSION_COOKIE);
  return id ? auth.getSession(id) : null;
}

export function createShareAuthRoutes(deps: ShareAuthRoutesDeps): Hono {
  const { auth } = deps;
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "no-referrer");
    c.header("Cache-Control", "no-store");
    c.header(
      "Content-Security-Policy",
      "frame-ancestors 'self'; form-action 'self'",
    );
  });

  app.get("/login", async (c) => {
    return c.redirect(await auth.beginLogin(c.req.query("next")), 302);
  });

  app.get("/callback", async (c) => {
    const state = c.req.query("state");
    const code = c.req.query("code");
    const result =
      state && code
        ? await auth.completeLogin(state, code)
        : ({ ok: false } as const);
    if (!result.ok) {
      return c.html(
        renderSignInFailed({
          brandName: deps.brandName,
          retryUrl: loginPath(undefined),
        }),
        400,
      );
    }
    setCookie(c, SHARE_SESSION_COOKIE, result.value.sessionId, {
      httpOnly: true,
      secure: deps.secureCookie,
      sameSite: "Lax",
      path: "/",
      maxAge: Math.floor(SHARE_SESSION_TTL_MS / 1000),
    });
    return c.redirect(result.value.next, 302);
  });

  app.get("/logout", async (c) => {
    const id = getCookie(c, SHARE_SESSION_COOKIE);
    if (id) await auth.endSession(id);
    deleteCookie(c, SHARE_SESSION_COOKIE, {
      path: "/",
      secure: deps.secureCookie,
    });
    return c.redirect(auth.logoutUrl(c.req.query("next")), 302);
  });

  return app;
}
