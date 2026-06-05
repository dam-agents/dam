import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SshPaths } from "./ssh-keys.js";

export const REMOTE_WORK_DIR = "/home/agent/work";

/** JetBrains Gateway connect link for the managed host `alias`. Gateway resolves
 *  the alias through the user's OpenSSH config (the `Include`d managed block), so
 *  it inherits the same ProxyCommand and identity as the `ssh`/editor modes. The
 *  remote IDE (e.g. PyCharm) is chosen in Gateway itself — we don't pin one. */
export function gatewayConnectUrl(alias: string): string {
  const params = new URLSearchParams({
    type: "ssh",
    host: alias,
    user: "agent",
    port: "22",
    projectPath: REMOTE_WORK_DIR,
  });
  return `jetbrains-gateway://connect#${params.toString()}`;
}

function proxyCommandString(agentRef: string, serverFlag?: string): string {
  const script = process.argv[1];
  const parts = [
    ...(script
      ? [process.execPath, ...process.execArgv, resolve(script)]
      : ["dam"]),
    "ssh",
    "_proxy",
    agentRef,
    ...(serverFlag ? ["--server", serverFlag] : []),
  ];
  return parts.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(" ");
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
  const xdg = env.XDG_CONFIG_HOME;
  const damConfig = join(
    xdg && xdg.length > 0 ? xdg : join(homedir(), ".config"),
    "dam",
    "ssh_config",
  );
  await mkdir(dirname(damConfig), { recursive: true });
  let damExisting = "";
  try {
    damExisting = await readFile(damConfig, "utf8");
  } catch {}
  const re = new RegExp(
    `\\n*${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n*`,
    "g",
  );
  const stripped = damExisting.replace(re, "\n").replace(/^\n+/, "").trimEnd();
  const body = stripped ? `${stripped}\n\n${block}\n` : `${block}\n`;
  await writeFile(damConfig, body, { mode: 0o600 });

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
