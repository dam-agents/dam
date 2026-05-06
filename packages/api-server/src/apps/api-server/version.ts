import type { Hono, Env } from "hono";

export interface VersionEndpointDeps {
  serverVersion: string;
  minClientVersion: string;
}

export function registerVersionEndpoint<E extends Env>(
  app: Hono<E>,
  deps: VersionEndpointDeps,
): void {
  app.get("/api/version", (c) =>
    c.json({
      serverVersion: deps.serverVersion,
      minClientVersion: deps.minClientVersion,
    }),
  );
}
