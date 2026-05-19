import { describe, it, expect } from "vitest";
import { createClient, client } from "./helpers/trpc-client.js";
import { getToken } from "./helpers/auth.js";

const API_BASE = "http://localtest.me:5555";

describe("auth: public endpoints", () => {
  it("/api/health returns 200 without token", async () => {
    const res = await fetch(`${API_BASE}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("/api/auth/config returns issuer, clientId and cliClientId without token", async () => {
    const res = await fetch(`${API_BASE}/api/auth/config`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("issuer");
    expect(data).toHaveProperty("clientId");
    expect(data).toHaveProperty("cliClientId");
    expect(data.issuer).toContain("/realms/platform");
    expect(data.clientId).toBe("platform-ui");
    expect(data.cliClientId).toBe("platform-cli");
  });
});

describe("auth: protected endpoints reject unauthenticated requests", () => {
  const noAuthClient = createClient();

  it("tRPC returns 401 without token", async () => {
    const res = await fetch(`${API_BASE}/api/trpc/templates.list`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("tRPC client throws without token", async () => {
    await expect(noAuthClient.templates.list.query()).rejects.toThrow();
  });

  it("MCP connections returns 401 without token", async () => {
    const res = await fetch(`${API_BASE}/api/mcp/connections`);
    expect(res.status).toBe(401);
  });

  it("rejects invalid token", async () => {
    const res = await fetch(`${API_BASE}/api/trpc/templates.list`, {
      headers: { Authorization: "Bearer invalid.token.here" },
    });
    expect(res.status).toBe(401);
  });
});

describe("auth: authenticated requests succeed", () => {
  it("tRPC works with valid token (global client)", async () => {
    // The global client has the token set by test-cluster setup
    const templates = await client.templates.list.query();
    expect(Array.isArray(templates)).toBe(true);
  });

  it("tRPC works with explicit token", async () => {
    const token = await getToken();
    const authedClient = createClient(token);
    const templates = await authedClient.templates.list.query();
    expect(Array.isArray(templates)).toBe(true);
  });

  it("token contains expected audience", async () => {
    const token = await getToken();
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    expect(payload.aud).toContain("platform-api");
    expect(payload.preferred_username).toBe("dev");
  });
});

describe("auth: resource ownership", () => {
  const INSTANCE_NAME = "auth-test-inst";

  it("agents are scoped to the authenticated user", async () => {
    const agent = await client.agents.create.mutate({
      name: INSTANCE_NAME,
      image: "alpine:latest",
    });

    const agents = await client.agents.list.query();
    const found = agents.find((i) => i.name === INSTANCE_NAME);
    expect(found).toBeDefined();

    if (found) {
      await client.agents.delete.mutate({ id: found.id });
    }

    const after = await client.agents.list.query();
    expect(after.find((i) => i.name === INSTANCE_NAME)).toBeUndefined();

    try {
      await client.agents.delete.mutate({ id: agent.id });
    } catch {}
  });
});
