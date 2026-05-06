import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { registerVersionEndpoint } from "../../apps/api-server/version.js";

describe("/api/version handler", () => {
  function buildApp(serverVersion: string, minClientVersion: string) {
    const app = new Hono();
    registerVersionEndpoint(app, { serverVersion, minClientVersion });
    return app;
  }

  it("returns 200 with serverVersion and minClientVersion", async () => {
    const app = buildApp("1.2.3", "0.0.0");
    const res = await app.request("/api/version");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      serverVersion: "1.2.3",
      minClientVersion: "0.0.0",
    });
  });

  // The handler itself is auth-agnostic; the auth-bypass property in
  // production comes from where it's mounted in `app.ts`. We exercise both
  // request shapes anyway to guard against an accidental middleware leak.
  it("returns the same response with or without an Authorization header", async () => {
    const app = buildApp("1.0.0", "0.0.0");

    const without = await app.request("/api/version");
    const with_ = await app.request("/api/version", {
      headers: { Authorization: "Bearer obviously-not-a-real-token" },
    });

    expect(without.status).toBe(200);
    expect(with_.status).toBe(200);
    expect(await without.json()).toEqual(await with_.json());
  });

});
