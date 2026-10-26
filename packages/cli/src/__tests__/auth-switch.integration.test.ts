import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runDam } from "./run-dam.js";
import { signInEnv, writeSavedSignIns } from "./saved-sign-ins.js";

/**
 * TEST_OVERVIEW: `dam auth switch <server>` makes a server the user already
 * signed in to the active one: it writes `server` to config.toml and opens no
 * browser. It finds the saved server by its URL, with or without a trailing
 * slash, or by its host name. An unknown server exits 2, lists the saved
 * ones and changes nothing. A server whose session expired still becomes
 * active, and the command says to run `dam auth login`.
 */

const DEV = "https://dev.example.test";
const PROD = "https://prod.example.test";

async function startExpiredIdp(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  let base = "";
  const server: Server = createServer((req, res) => {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/auth/config") {
      return json(200, {
        issuer: `${base}/realms/platform`,
        clientId: "platform-ui",
        cliClientId: "platform-cli",
      });
    }
    if (req.url === "/realms/platform/.well-known/openid-configuration") {
      return json(200, {
        token_endpoint: `${base}/token`,
        revocation_endpoint: `${base}/revoke`,
        device_authorization_endpoint: `${base}/device`,
      });
    }
    if (req.url === "/token") {
      return json(400, { error: "invalid_grant" });
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) {
    throw new Error("fixture failed to bind");
  }
  base = `http://127.0.0.1:${addr.port}`;
  return {
    url: base,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("dam auth switch (integration)", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-auth-switch-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  const configToml = () =>
    readFile(join(home, "config", "dam", "config.toml"), "utf-8");

  /** TEST_SCENARIO: AC-1 — two saved sign-ins, prod active; switching to dev needs no browser, and status then stars dev. */
  it("makes another saved server active, and status stars it", async () => {
    await writeSavedSignIns(home, [{ host: DEV }, { host: PROD }], PROD);

    const r = await runDam(["auth", "switch", DEV], signInEnv(home));

    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain(`Active server is now ${DEV}`);
    expect(r.stdout).not.toContain("Open this URL");
    expect(await configToml()).toBe(`server = "${DEV}"\n`);

    const status = await runDam(["auth", "status"], signInEnv(home));
    const starred = status.stdout
      .split("\n")
      .filter((line) => line.startsWith("*"));
    expect(starred).toHaveLength(1);
    expect(starred[0]).toContain(DEV);
  });

  /** TEST_SCENARIO: AC-2 — dev was saved with a trailing slash; its URL without the slash, and its host name alone, both make it active. */
  it.each([DEV, "dev.example.test"])(
    "finds a server saved with a trailing slash from %s",
    async (input) => {
      await writeSavedSignIns(
        home,
        [{ host: `${DEV}/` }, { host: PROD }],
        PROD,
      );

      const r = await runDam(["auth", "switch", input], signInEnv(home));

      expect(r.exitCode, r.stderr).toBe(0);
      expect(await configToml()).toBe(`server = "${DEV}"\n`);
    },
  );

  /** TEST_SCENARIO: AC-3 — a server the user never signed in to is refused with exit code 2; the active server stays, and the saved ones are listed. */
  it("refuses an unknown server, lists the saved ones, and changes nothing", async () => {
    await writeSavedSignIns(home, [{ host: DEV }, { host: PROD }], PROD);

    const r = await runDam(
      ["auth", "switch", "staging.example.test"],
      signInEnv(home),
    );

    expect(r.exitCode).toBe(2);
    expect(r.stderr).toContain("not signed in to staging.example.test");
    expect(r.stderr).toContain(DEV);
    expect(r.stderr).toContain(PROD);
    expect(await configToml()).toBe(`server = "${PROD}"\n`);
  });

  /** TEST_SCENARIO: AC-4 — the dev session cannot be refreshed any more; switch still makes dev active, says to run `dam auth login`, and keeps the saved entry so that status shows it as expired. */
  it("makes a server with an expired session active and says to sign in", async () => {
    const idp = await startExpiredIdp();
    try {
      await writeSavedSignIns(
        home,
        [
          { host: idp.url, expiresAt: "2020-01-01T00:00:00.000Z" },
          { host: PROD },
        ],
        PROD,
      );

      const r = await runDam(["auth", "switch", idp.url], signInEnv(home));

      expect(r.exitCode, r.stderr).toBe(0);
      expect(r.stderr).toContain("dam auth login");
      expect(await configToml()).toBe(`server = "${idp.url}"\n`);

      const status = await runDam(
        ["auth", "status", "--json"],
        signInEnv(home),
      );
      const report = JSON.parse(status.stdout) as {
        servers: Array<{ server: string; active: boolean; session: string }>;
      };
      expect(report.servers).toContainEqual(
        expect.objectContaining({
          server: idp.url,
          active: true,
          session: "expired",
        }),
      );
    } finally {
      await idp.close();
    }
  });
});

describe("dam auth status --json (integration)", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-auth-status-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  /** TEST_SCENARIO: AC-6 — an agent reads the saved servers, the active one and each session's state from JSON instead of the table; no token is in the output. */
  it("names each saved server, the active one, and each session's state", async () => {
    const idp = await startExpiredIdp();
    try {
      await writeSavedSignIns(
        home,
        [
          { host: `${DEV}/` },
          { host: idp.url, expiresAt: "2020-01-01T00:00:00.000Z" },
        ],
        `${DEV}/`,
      );

      const r = await runDam(["auth", "status", "--json"], signInEnv(home));

      expect(r.exitCode, r.stderr).toBe(0);
      expect(r.stdout).not.toContain("saved-access");
      expect(r.stdout).not.toContain("saved-refresh");
      const report = JSON.parse(r.stdout) as {
        activeServer: string;
        servers: Array<{ server: string; active: boolean; session: string }>;
      };
      expect(report.activeServer).toBe(DEV);
      expect(report.servers).toEqual([
        expect.objectContaining({
          server: DEV,
          active: true,
          session: "valid",
        }),
        expect.objectContaining({
          server: idp.url,
          active: false,
          session: "expired",
        }),
      ]);
    } finally {
      await idp.close();
    }
  });
});
