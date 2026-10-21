import { Hono, type Context } from "hono";
import { securityLog } from "../../../core/security-log.js";
import {
  decideAccess,
  effectiveAccess,
  parseAddress,
  type EnvironmentSession,
} from "../domain/gate.js";
import type { EnvironmentsRepository } from "../infrastructure/environments-repository.js";
import type {
  EnvironmentSignIn,
  Visitor,
} from "../services/environment-signin.js";
import { renderGatePage } from "./pages.js";

// UNIT_BOUNDARY_DESCRIPTION: the share host's own sign-in, as the front door uses it: the visitor its session names, if any, and the paths that sign a visitor in and out and come back here.
export interface ShareSignIn {
  visitor(c: Context): Promise<Visitor | null>;
  loginPath(next: string): string;
  logoutPath: string;
}

export interface FrontDoorDeps {
  domain: string;
  repo: Pick<EnvironmentsRepository, "getByHost">;
  ownerList: (owningAgentId: string) => Promise<string[]>;
  signIn: Pick<EnvironmentSignIn, "handoff">;
  share: ShareSignIn;
  brandName: string;
}

const GATE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};

/**
 * UNIT_BOUNDARY_DESCRIPTION: An Environment's front door, on the share host
 * at `/e/<address>`. An address without a session sends a visitor here. A
 * visitor the share host has not signed in is sent through its sign-in, which
 * comes back here; one it has is checked against the Environment at once: the
 * owner, or a verified email on the effective list. Let in, they go straight
 * on to the address with a one-time code, with no page and no click; refused,
 * they see who they are signed in as, whom to ask, and a switch of account.
 * The address checks again on every request; this only decides who gets a
 * session there. Signing out of an address lands on its signed-out page here,
 * which offers to come back or to switch account, by a form to the share
 * host's own sign-out, so the share session goes with it.
 */
export function createEnvironmentFrontDoor(deps: FrontDoorDeps): Hono {
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    for (const [name, value] of Object.entries(GATE_HEADERS))
      c.header(name, value);
  });

  function page(
    c: Context,
    status: 403 | 404,
    title: string,
    body: string,
    switchAccount?: { action: string; next: string },
  ) {
    return c.html(
      renderGatePage({ brandName: deps.brandName, title, body, switchAccount }),
      status,
    );
  }

  app.get("/:address/signed-out", (c) => {
    const address = c.req.param("address");
    if (!parseAddress(`${address}.${deps.domain}`, deps.domain))
      return page(
        c,
        404,
        "No such Environment",
        "This link names no Environment.",
      );
    return c.html(
      renderGatePage({
        brandName: deps.brandName,
        title: "Signed out",
        body: "You are signed out of this Environment. Open its link again to come back, or switch account to sign in as someone else.",
        switchAccount: { action: deps.share.logoutPath, next: `/e/${address}` },
      }),
      200,
    );
  });

  app.get("/:address", async (c) => {
    const address = c.req.param("address");
    const next = c.req.query("next");
    const here = `/e/${address}${next === undefined ? "" : `?next=${encodeURIComponent(next)}`}`;
    const parsed = parseAddress(`${address}.${deps.domain}`, deps.domain);
    const record = parsed ? await deps.repo.getByHost(parsed.host) : null;
    if (
      !parsed ||
      !record ||
      !record.endpoints.some((e) => e.name === parsed.endpoint)
    )
      return page(
        c,
        404,
        "No such Environment",
        "This link names no Environment, or one that was deleted.",
      );

    const visitor = await deps.share.visitor(c);
    if (!visitor) return c.redirect(deps.share.loginPath(here), 302);

    const session: EnvironmentSession = {
      sub: visitor.sub,
      email: visitor.email,
      address: parsed.address,
      createdAt: Date.now(),
    };
    const access = decideAccess(
      record,
      effectiveAccess(
        await deps.ownerList(record.owningAgentId),
        record.access,
      ),
      session,
      parsed.address,
    );
    if (!access.allow) {
      securityLog("warn", "environment.access_deny", {
        category: "authz",
        actor: visitor.sub,
        actorKind: "user",
        agentId: record.agentId,
        decision: "deny",
        reason: access.reason,
        detail: { address: parsed.address, surface: "front-door" },
      });
      return page(
        c,
        403,
        "You don't have access",
        visitor.email
          ? `You are signed in as ${visitor.email}, which is not on this Environment's list. Ask the person who sent you the link to add you, or switch account.`
          : "Your account has no verified email address, so it cannot be on this Environment's list. Ask the person who sent you the link, or switch account.",
        { action: deps.share.logoutPath, next: here },
      );
    }
    return c.redirect(
      await deps.signIn.handoff(visitor, parsed.address, next),
      302,
    );
  });

  return app;
}
