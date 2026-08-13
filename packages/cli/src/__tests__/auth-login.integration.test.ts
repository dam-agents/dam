import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { parse as parseToml } from "smol-toml";

const exec = promisify(execFile);

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "../..");
const BIN_PATH = join(PKG_ROOT, "dist", "bin.js");

const API_BASE = "http://api-server.localhost:4444";

async function isClusterUp(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/config`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

class CookieJar {
  private store = new Map<string, string>();

  ingest(setCookieHeader: string | null) {
    if (!setCookieHeader) return;
    const lines = setCookieHeader.split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
    for (const line of lines) {
      const [pair] = line.split(";");
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name.length === 0) continue;
      this.store.set(name, value);
    }
  }

  header(): string {
    return [...this.store.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

async function step(
  url: string,
  jar: CookieJar,
  init: RequestInit = {},
): Promise<{ res: Response; url: string }> {
  const headers = new Headers(init.headers);
  const cookieHeader = jar.header();
  if (cookieHeader.length > 0) headers.set("Cookie", cookieHeader);
  const res = await fetch(url, { ...init, headers, redirect: "manual" });
  const setCookie =
    (
      res.headers as unknown as { getSetCookie?: () => string[] }
    ).getSetCookie?.() ?? [];
  for (const sc of setCookie) jar.ingest(sc);
  return { res, url };
}

async function followRedirects(
  startUrl: string,
  jar: CookieJar,
): Promise<{ res: Response; url: string }> {
  let { res, url } = await step(startUrl, jar);
  for (let i = 0; i < 5; i++) {
    if (res.status < 300 || res.status >= 400) return { res, url };
    const location = res.headers.get("location");
    if (!location) return { res, url };
    url = new URL(location, url).toString();
    ({ res } = await step(url, jar));
  }
  return { res, url };
}

function extractKcContextString(html: string, key: string): string | null {
  const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(html);
  return m ? m[1]!.replace(/\\\//g, "/") : null;
}

async function authorizeAsDevUser(
  verificationUriComplete: string,
  username = "dev",
  password = "dev",
): Promise<void> {
  const jar = new CookieJar();

  const { res: loginPage, url: loginPageUrl } = await followRedirects(
    verificationUriComplete,
    jar,
  );
  const loginHtml = await loginPage.text();
  const loginAction = extractKcContextString(loginHtml, "loginAction");
  if (!loginAction) {
    const pageId = extractKcContextString(loginHtml, "pageId");
    throw new Error(
      `could not find kcContext.url.loginAction (status ${loginPage.status}, pageId ${pageId})\n--- head ---\n${loginHtml.slice(0, 400)}`,
    );
  }
  const loginPostUrl = new URL(loginAction, loginPageUrl).toString();

  let { res, url } = await step(loginPostUrl, jar, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password, credentialId: "" }),
  });
  for (let i = 0; i < 5 && res.status >= 300 && res.status < 400; i++) {
    const loc = res.headers.get("location");
    if (!loc) break;
    url = new URL(loc, url).toString();
    ({ res } = await step(url, jar));
  }

  const consentHtml = await res.text();

  if (extractKcContextString(consentHtml, "pageId") === "login") {
    const summary = extractKcContextString(consentHtml, "summary");
    throw new Error(
      `Keycloak rejected credentials for ${username}${summary ? ` (${summary})` : ""}`,
    );
  }

  const consentAction = extractKcContextString(consentHtml, "oauthAction");
  const codeValue = extractKcContextString(consentHtml, "code");
  if (!consentAction || !codeValue) {
    return;
  }
  const consentUrl = new URL(consentAction, url).toString();
  const consentRes = await step(consentUrl, jar, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ accept: "Yes", code: codeValue }),
  });
  if (consentRes.res.status >= 400) {
    throw new Error(
      `consent POST returned ${consentRes.res.status} ${consentRes.res.statusText}`,
    );
  }
}

let clusterUp = false;

beforeAll(async () => {
  clusterUp = await isClusterUp();
  if (!clusterUp) return;
  await exec("pnpm", ["exec", "tsup"], { cwd: PKG_ROOT });
}, 60_000);

describe.runIf(true)(
  "dam auth login (integration vs local k3s Keycloak)",
  () => {
    let tmpHome: string;
    let tmpState: string;
    let tmpConfig: string;

    beforeEach(async () => {
      if (!clusterUp) return;
      tmpHome = await mkdtemp(join(tmpdir(), "dam-auth-home-"));
      tmpState = await mkdtemp(join(tmpdir(), "dam-auth-state-"));
      tmpConfig = await mkdtemp(join(tmpdir(), "dam-auth-config-"));
    });

    afterEach(async () => {
      if (!clusterUp) return;
      await rm(tmpHome, { recursive: true, force: true });
      await rm(tmpState, { recursive: true, force: true });
      await rm(tmpConfig, { recursive: true, force: true });
    });

    afterAll(() => {});

    it("completes the device flow against the live cluster, writes auth.toml mode 0600, and the token authorizes api-server", async () => {
      if (!clusterUp) return;

      const env = {
        HOME: tmpHome,
        XDG_STATE_HOME: tmpState,
        XDG_CONFIG_HOME: tmpConfig,
        PATH: process.env.PATH ?? "",
      };

      const child = execFile(
        "node",
        [BIN_PATH, "auth", "login", "--server", API_BASE, "--no-browser"],
        {
          env,
        },
      );
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (d: Buffer) => {
        stdout += d.toString("utf-8");
      });
      child.stderr?.on("data", (d: Buffer) => {
        stderr += d.toString("utf-8");
      });

      const verificationUri = await waitForLine(
        () => stdout,
        (s) => {
          const m =
            /(http:\/\/keycloak[^\s]+device\?user_code=[A-Z0-9-]+)/.exec(s);
          return m?.[1];
        },
        10_000,
      );
      expect(verificationUri).toBeDefined();
      await authorizeAsDevUser(verificationUri!);

      const exit = await new Promise<{
        code: number;
        signal: NodeJS.Signals | null;
      }>((res) =>
        child.on("close", (code, signal) => res({ code: code ?? 0, signal })),
      );
      expect(exit.code, `stdout: ${stdout}\nstderr: ${stderr}`).toBe(0);
      expect(stdout).toContain("✓ Logged in to");

      const authPath = join(tmpState, "dam", "auth.toml");
      const stats = await stat(authPath);
      expect(stats.mode & 0o777).toBe(0o600);

      const tomlContent = await readFile(authPath, "utf-8");
      const parsed = parseToml(tomlContent) as {
        hosts?: Record<
          string,
          {
            access_token?: string;
            refresh_token?: string;
            cli_client_id?: string;
          }
        >;
      };
      expect(parsed.hosts).toBeDefined();
      const entry = parsed.hosts?.[API_BASE];
      expect(entry, `auth.toml missing entry for ${API_BASE}`).toBeDefined();
      expect(entry?.access_token).toBeTruthy();
      expect(entry?.refresh_token).toBeTruthy();
      expect(entry?.cli_client_id).toBe("platform-cli");

      const apiRes = await fetch(
        `${API_BASE}/api/trpc/templates.list?batch=1&input=${encodeURIComponent("{}")}`,
        {
          headers: { Authorization: `Bearer ${entry!.access_token!}` },
        },
      );
      expect(apiRes.status).toBeLessThan(400);
    }, 120_000);
  },
);

async function waitForLine(
  read: () => string,
  matcher: (s: string) => string | undefined,
  timeoutMs: number,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = matcher(read());
    if (match) return match;
    await new Promise((r) => setTimeout(r, 100));
  }
  return undefined;
}
