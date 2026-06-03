import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SshPaths } from "./ssh-keys.js";

/** The agent's workspace — the default folder VS Code opens on `--code`. */
export const REMOTE_WORK_DIR = "/home/agent/work";

/** POSIX single-quote escaping, for embedding in an ssh `ProxyCommand` (which
 *  ssh runs via `/bin/sh -c`). */
function shQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

/** How to re-invoke this same `dam` binary as a ProxyCommand subprocess.
 *
 *  For the built/installed CLI this is just `node dist/bin.js`. When running TS
 *  source under a loader (e.g. `cli:dev` via tsx), the subprocess must
 *  re-register that loader or it can't resolve `.ts` modules behind `.js`
 *  import specifiers. `execArgv` carries flag-based loaders (`--import` /
 *  `--loader`); tsx registers in-process (no flag), so add it explicitly for a
 *  `.ts` entry. */
function damInvocation(): string[] {
  const script = process.argv[1];
  if (!script) return ["dam"];
  const abs = resolve(script);
  const cmd = [process.execPath, ...process.execArgv];
  const hasLoader = process.execArgv.some((a) =>
    /--import|--loader|--experimental-loader/.test(a),
  );
  if (/\.[cm]?ts$/.test(abs) && !hasLoader) cmd.push("--import", "tsx");
  cmd.push(abs);
  return cmd;
}

function proxyCommandString(agentRef: string, serverFlag?: string): string {
  const parts = [
    ...damInvocation(),
    "ssh",
    "--proxy",
    agentRef,
    ...(serverFlag ? ["--server", serverFlag] : []),
  ];
  return parts.map(shQuote).join(" ");
}

/** ssh hostname token — used only as the known_hosts key (the real route is
 *  the ProxyCommand). Normalized to a safe host-like string so names and IDs
 *  produce stable, valid entries. */
function sanitizeHost(agentRef: string): string {
  return agentRef.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
}

/** The ssh_config options every dam SSH connection uses, as ordered pairs so
 *  both the `ssh` argv (`-o k=v`) and the `~/.ssh/config` block (`  k v`) render
 *  from one source. ProxyCommand and the destination host are added per form. */
function sshHostOptions(paths: SshPaths): [string, string][] {
  return [
    ["User", "agent"],
    ["IdentitiesOnly", "yes"],
    ["IdentityFile", paths.privateKey],
    ["UserKnownHostsFile", paths.knownHosts],
    ["StrictHostKeyChecking", "accept-new"],
    ["PreferredAuthentications", "publickey"],
  ];
}

/** Full argv for the interactive `ssh` invocation. */
export function buildSshArgs(opts: {
  agentRef: string;
  serverFlag?: string;
  paths: SshPaths;
}): string[] {
  return [
    ...sshHostOptions(opts.paths).flatMap(([k, v]) => ["-o", `${k}=${v}`]),
    "-o",
    `ProxyCommand=${proxyCommandString(opts.agentRef, opts.serverFlag)}`,
    sanitizeHost(opts.agentRef),
  ];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** dam's own ssh config, pulled into `~/.ssh/config` via one `Include` line. */
function damSshConfigFile(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "dam", "ssh_config");
}

/** Materialize a managed `Host` block in dam's own ssh config and ensure
 *  `~/.ssh/config` pulls it in via a single `Include` line — so `ssh`, VS Code,
 *  and Zed all resolve the alias while dam's host churn stays in dam's file.
 *  Shared by `--code`, `--code-insiders`, and `--zed`. Returns the alias.
 *  Idempotent: re-running replaces the block and never dupes the `Include`. */
export async function ensureManagedSshHost(opts: {
  agentRef: string;
  serverFlag?: string;
  paths: SshPaths;
  env?: NodeJS.ProcessEnv;
}): Promise<string> {
  const env = opts.env ?? process.env;
  const host = sanitizeHost(opts.agentRef);
  const alias = `dam-${host}`;
  const start = `# >>> dam ssh: ${alias} (managed) >>>`;
  const end = `# <<< dam ssh: ${alias} (managed) <<<`;
  const block = [
    start,
    `Host ${alias}`,
    `  HostName ${host}`,
    ...sshHostOptions(opts.paths).map(([k, v]) => `  ${k} ${v}`),
    `  ProxyCommand ${proxyCommandString(opts.agentRef, opts.serverFlag)}`,
    end,
  ].join("\n");

  // Upsert the block in dam's config (replace this alias's prior block, else
  // append) — dam owns this file, so other agents' blocks coexist.
  const damConfig = damSshConfigFile(env);
  await mkdir(dirname(damConfig), { recursive: true });
  let damExisting = "";
  try {
    damExisting = await readFile(damConfig, "utf8");
  } catch {}
  const re = new RegExp(
    `\\n*${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n*`,
    "g",
  );
  const stripped = damExisting.replace(re, "\n").replace(/^\n+/, "");
  const sep = stripped && !stripped.endsWith("\n") ? "\n" : "";
  await writeFile(
    damConfig,
    `${stripped}${sep}${stripped ? "\n" : ""}${block}\n`,
    {
      mode: 0o600,
    },
  );

  // Pull dam's config into the user's via one idempotent `Include`. It must
  // precede any `Host` block to apply globally, so prepend it.
  const userConfig = join(homedir(), ".ssh", "config");
  await mkdir(dirname(userConfig), { recursive: true, mode: 0o700 });
  let userExisting = "";
  try {
    userExisting = await readFile(userConfig, "utf8");
  } catch {}
  const includeLine = `Include ${damConfig}`;
  if (!userExisting.includes(includeLine))
    await writeFile(
      userConfig,
      `# dam ssh (managed)\n${includeLine}\n${userExisting ? `\n${userExisting}` : ""}`,
      { mode: 0o600 },
    );
  return alias;
}
