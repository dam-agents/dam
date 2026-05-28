import { execSync } from "node:child_process";
import type { TestProject } from "vitest/node";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "api-server-api";
import { waitForKeycloak, getToken } from "./auth.js";

const API_URL = "http://localtest.me:5555";

async function waitForReady(url: string, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`API server not ready after ${timeoutMs}ms`);
}

async function acceptCurrentTerms(token: string) {
  const client = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${API_URL}/api/trpc`,
        headers: { Authorization: `Bearer ${token}` },
      }),
    ],
  });
  const current = await client.terms.current.query();
  await client.terms.accept.mutate({ version: current.version });
}

export async function setup(project: TestProject) {
  console.log("Waiting for Keycloak realm to be ready...");
  await waitForKeycloak();

  console.log("Waiting for API server to be reachable...");
  await waitForReady(`${API_URL}/api/health`);

  console.log("Getting auth token...");
  const token = await getToken();

  console.log("Accepting terms of use...");
  await acceptCurrentTerms(token);

  project.provide("authToken", token);

  console.log("Test cluster ready.");
}

declare module "vitest" {
  export interface ProvidedContext {
    authToken: string;
  }
}

export async function teardown() {
  if (process.env.CI) return;
  console.log("Deleting test cluster...");
  try {
    execSync("mise run cluster:delete -- --vm-name=platform-k3s-test --force", {
      stdio: "inherit",
      timeout: 120_000,
    });
  } catch (e) {
    console.error("Failed to delete test cluster:", e);
  }
}
