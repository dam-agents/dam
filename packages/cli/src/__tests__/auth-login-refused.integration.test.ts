// TEST_OVERVIEW: `dam auth login` when the user refuses the grant in the browser (#5701). The token endpoint answers the device-code poll with `access_denied`, as Keycloak does after "No" on the grant screen. Login must exit non-zero, say the sign-in was refused, and save no credentials. A fake server stands in for the api-server and Keycloak: `/api/auth/config`, `/api/version`, OIDC discovery, the device endpoint and the token endpoint.
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { runDam } from "./run-dam.js";

interface Fixture {
  url: string;
  tokenPolls: () => number;
  close: () => Promise<void>;
}

async function startRefusingIdp(): Promise<Fixture> {
  let url = "";
  let tokenPolls = 0;
  const json = (
    res: import("node:http").ServerResponse,
    status: number,
    body: object,
  ) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server: Server = createServer((req, res) => {
    switch (req.url) {
      case "/api/auth/config":
        return json(res, 200, {
          issuer: `${url}/realms/platform`,
          clientId: "platform-ui",
          cliClientId: "platform-cli",
        });
      case "/api/version":
        return json(res, 200, {
          serverVersion: "1.0.0",
          minClientVersion: "0.0.0",
        });
      case "/realms/platform/.well-known/openid-configuration":
        return json(res, 200, {
          token_endpoint: `${url}/token`,
          revocation_endpoint: `${url}/revoke`,
          device_authorization_endpoint: `${url}/device`,
        });
      case "/device":
        return json(res, 200, {
          device_code: "device-code",
          user_code: "ABCD-EFGH",
          verification_uri: `${url}/verify`,
          expires_in: 600,
          interval: 1,
        });
      case "/token":
        tokenPolls += 1;
        return json(res, 400, {
          error: "access_denied",
          error_description: "The end user denied the authorization request.",
        });
      default:
        res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) {
    throw new Error("fixture server failed to bind");
  }
  url = `http://127.0.0.1:${addr.port}`;
  return {
    url,
    tokenPolls: () => tokenPolls,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

let home: string;
let fixture: Fixture;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "dam-auth-refused-"));
  fixture = await startRefusingIdp();
});

afterEach(async () => {
  await fixture.close();
  await rm(home, { recursive: true, force: true });
});

// TEST_SCENARIO: The user clicked "No". Login stops at the first poll, exits 1 with a message that the user refused the sign-in, and writes no auth.toml.
it("exits non-zero, says the sign-in was refused, and saves nothing", async () => {
  const r = await runDam(
    ["auth", "login", "--server", fixture.url, "--no-browser"],
    {
      HOME: home,
      XDG_STATE_HOME: join(home, "state"),
      XDG_CONFIG_HOME: join(home, "config"),
      PATH: process.env.PATH ?? "",
    },
  );
  expect(r.exitCode, `stdout: ${r.stdout}\nstderr: ${r.stderr}`).toBe(1);
  expect(r.stderr).toBe(
    "error: the user refused the sign-in; no credentials were saved (The end user denied the authorization request.)\n",
  );
  expect(r.stdout).not.toContain("Logged in");
  expect(fixture.tokenPolls()).toBe(1);
  await expect(stat(join(home, "state", "dam", "auth.toml"))).rejects.toThrow();
});
