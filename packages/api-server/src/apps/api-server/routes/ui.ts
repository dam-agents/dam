import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { compress } from "hono/compress";

/* UNIT_BOUNDARY_DESCRIPTION: The browser app, served from the API's own origin instead of a static host in front of it: the SPA's files, its shell for every route the app owns, and the headers the static host owed them. The shell always revalidates, so a deploy is picked up on the next load, while a file under /assets/ is content-hashed and never changes, so it is cached forever. Only a file that was served gets that cache, and a missing one is a 404: a browser then never keeps the shell under an asset URL and recovers on the next load. Compression is not optional: the entry chunk plus the lazily loaded one is the whole cost of a first visit, and the public agent page is opened from a Slack link on a stranger's phone. The CSP is navigation-only, because the srcdoc iframes that preview artifacts and files render arbitrary HTML and inherit the policy, and the app fetches Keycloak and Google Fonts cross-origin, so any fetch directive breaks one of them. A .well-known path or a top-level .txt that no route answers is a 404 rather than the shell, so an agent looking for robots.txt sees that it is absent. The shell names the deployment in its title before any JavaScript runs, because a client that runs none still reads it. */
export function createUiRoutes(options: { root: string; title: string }) {
  let shell: string;
  try {
    shell = readFileSync(join(options.root, "index.html"), "utf-8");
  } catch {
    process.stderr.write(
      `ui: no shell at ${join(options.root, "index.html")}, so this server serves no UI\n`,
    );
    return null;
  }
  const title = options.title.replace(
    /[&<>"']/g,
    (c) => `&#${c.charCodeAt(0)};`,
  );
  const html = shell.replace(
    "<title></title>",
    () => `<title>${title}</title>`,
  );
  const app = new Hono();
  app.use("*", compress());
  app.use("*", async (c, next) => {
    await next();
    c.header(
      "Content-Security-Policy",
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    );
    c.header(
      "Cache-Control",
      c.res.ok && c.req.path.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache, no-store, must-revalidate",
    );
  });
  app.get("/", (c) => c.html(html));
  app.get("/index.html", (c) => c.html(html));
  app.use("*", serveStatic({ root: options.root }));
  app.get("*", (c) =>
    /^\/(?:api(?:\/|$)|assets(?:\/|$)|\.well-known\/|[^/]+\.txt$)/.test(
      c.req.path,
    )
      ? c.notFound()
      : c.html(html),
  );
  return app;
}
