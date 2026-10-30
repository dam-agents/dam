import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnDam } from "./run-dam.js";

const DIST_TAGS_PATH = "/-/package/%40dam-agents%2Fcli/dist-tags";

interface RegistryFixture {
  url: string;
  setLatest: (version: string | undefined) => void;
  close: () => Promise<void>;
}

async function localCliVersion(): Promise<string> {
  const pkg = JSON.parse(
    await readFile(new URL("../../package.json", import.meta.url), "utf-8"),
  ) as { version: string };
  return pkg.version;
}

async function startRegistry(): Promise<RegistryFixture> {
  let latest: string | undefined = "99.0.0";
  const server: Server = createServer((req, res) => {
    if (req.url !== DIST_TAGS_PATH) {
      res.writeHead(404).end();
      return;
    }
    if (latest === undefined) {
      res.writeHead(503).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ latest }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("fixture registry failed to bind");
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    setLatest: (version) => {
      latest = version;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe("dam update (integration)", () => {
  let home: string;
  let bin: string;
  let npmArgs: string;
  let registry: RegistryFixture;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "dam-update-"));
    bin = join(home, "bin");
    npmArgs = join(home, "npm-args");
    registry = await startRegistry();
    await mkdir(bin);
    const fakeNpm = join(bin, "npm");
    await writeFile(
      fakeNpm,
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$DAM_TEST_NPM_ARGS"\necho "added 1 package in 2s"\nexit "${DAM_TEST_NPM_EXIT:-0}"\n',
    );
    await chmod(fakeNpm, 0o755);
  });

  afterEach(async () => {
    await registry.close();
    await rm(home, { recursive: true, force: true });
  });

  function env(extra: Record<string, string> = {}): Record<string, string> {
    return {
      HOME: home,
      PATH: bin,
      npm_config_registry: registry.url,
      DAM_TEST_NPM_ARGS: npmArgs,
      ...extra,
    };
  }

  it("installs the exact latest version and keeps CLI state", async () => {
    const configDir = join(home, ".config", "dam");
    const stateDir = join(home, ".local", "state", "dam");
    await mkdir(configDir, { recursive: true });
    await mkdir(stateDir, { recursive: true });
    const configPath = join(configDir, "config.toml");
    const authPath = join(stateDir, "auth.toml");
    await writeFile(configPath, 'server = "https://example.test"\n');
    await writeFile(authPath, "saved-auth-state\n");

    const result = await spawnDam(["update", "--json"], env());

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "updated",
      from: await localCliVersion(),
      to: "99.0.0",
    });
    expect(await readFile(npmArgs, "utf-8")).toBe(
      "install\n--global\n@dam-agents/cli@99.0.0\n",
    );
    expect(await readFile(configPath, "utf-8")).toBe(
      'server = "https://example.test"\n',
    );
    expect(await readFile(authPath, "utf-8")).toBe("saved-auth-state\n");
  });

  it("keeps npm's own output out of the JSON result", async () => {
    const result = await spawnDam(["update", "--json"], env());

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "updated" });
    expect(result.stderr).toContain("added 1 package in 2s");
  });

  it("supports upgrade as an alias and skips npm when current", async () => {
    const version = await localCliVersion();
    registry.setLatest(version);

    const result = await spawnDam(["upgrade"], env());

    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout).toContain(`CLI ${version} is already up to date`);
    await expect(readFile(npmArgs, "utf-8")).rejects.toThrow();
  });

  it("reports the current outcome as JSON", async () => {
    const version = await localCliVersion();
    registry.setLatest(version);

    const result = await spawnDam(["update", "--json"], env());

    expect(result.exitCode, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "current",
      from: version,
      to: version,
    });
  });

  it("explains an npm failure and exits unsuccessfully", async () => {
    const result = await spawnDam(["update"], env({ DAM_TEST_NPM_EXIT: "13" }));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("npm failed with exit code 13");
    expect(result.stderr).toContain("npm install -g @dam-agents/cli@latest");
  });

  it("explains when npm is not on PATH", async () => {
    const result = await spawnDam(["update"], env({ PATH: "" }));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("npm was not found on PATH");
  });

  it("does not run npm when the latest version cannot be checked", async () => {
    registry.setLatest(undefined);

    const result = await spawnDam(["update"], env());

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("could not check the latest CLI version");
    await expect(readFile(npmArgs, "utf-8")).rejects.toThrow();
  });
});
