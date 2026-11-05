/**
 * UNIT_BOUNDARY_DESCRIPTION: puts `dam` on an assistant's PATH, pointed at this
 * install and at its own Agent id, and nothing else in the machine's hands.
 * There is no token and no file to steal: the launcher asks the install's own
 * harness path for the CLI of its build, keeps it under `~/.dam` by version, and
 * runs it with the two variables the CLI needs to call that path. Asking costs
 * one request a minute at most, and the bundle is downloaded again only when the
 * install answers a version the machine does not have — so an Agent that hibernates
 * a rebuild comes back on the new CLI without anyone touching it.
 */
export function cliInstallCommand(input: {
  agentId: string;
  harnessUrl: string;
}): string {
  const base = input.harnessUrl.replace(/\/+$/, "");
  const launcher = LAUNCHER.replaceAll("__DAM_BASE__", base).replaceAll(
    "__DAM_AGENT__",
    input.agentId,
  );
  return [
    "set -eu",
    'mkdir -p "$HOME/bin"',
    `cat > "$HOME/bin/dam-launch.mjs" <<'DAM_LAUNCH_EOF'`,
    launcher,
    "DAM_LAUNCH_EOF",
    "cat > \"$HOME/bin/dam\" <<'DAM_WRAPPER_EOF'",
    "#!/bin/sh",
    'exec node "$HOME/bin/dam-launch.mjs" "$@"',
    "DAM_WRAPPER_EOF",
    'chmod +x "$HOME/bin/dam" "$HOME/bin/dam-launch.mjs"',
  ].join("\n");
}

const LAUNCHER = `import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const BASE = "__DAM_BASE__";
const AGENT = "__DAM_AGENT__";
const CHECK_MS = 60_000;

const dir = join(homedir(), ".dam");
const bundle = join(dir, "dam.mjs");
const seen = join(dir, "version");
const know = join(dir, "bundle-version");

function read(path) {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return null;
  }
}

function fresh(path) {
  try {
    return Date.now() - statSync(path).mtimeMs < CHECK_MS;
  } catch {
    return false;
  }
}

function path_(name) {
  return \`\${BASE}/api/agents/\${encodeURIComponent(AGENT)}/\${name}\`;
}

async function servedVersion() {
  const known = read(seen);
  if (known !== null && fresh(seen)) return known;
  try {
    const res = await fetch(path_("cli/version"));
    if (!res.ok) throw new Error(String(res.status));
    const body = await res.json();
    const version = typeof body.cliVersion === "string" ? body.cliVersion : "";
    mkdirSync(dir, { recursive: true });
    writeFileSync(seen, version);
    return version;
  } catch {
    return null;
  }
}

const version = await servedVersion();
if (version !== null && version !== "" && read(know) !== version) {
  try {
    const res = await fetch(path_("cli/dam.mjs"));
    if (res.ok) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(bundle, Buffer.from(await res.arrayBuffer()));
      writeFileSync(know, version);
    }
  } catch {}
}

if (read(know) === null) {
  process.stderr.write(
    "error: this install has not served a CLI to this assistant yet; try again once its api-server carries one\\n",
  );
  process.exit(1);
}

process.env.DAM_HARNESS_URL = BASE;
process.env.DAM_AGENT_ID = AGENT;
await import(pathToFileURL(bundle).href);
`;
