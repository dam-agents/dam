import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SshPaths } from "./ssh-keys.js";

export const REMOTE_WORK_DIR = "/home/agent/work";
const REMOTE_USER = "agent";

export function editorLaunchArgs(
  mode: "code" | "zed",
  alias: string,
): string[] {
  switch (mode) {
    case "code":
      return ["--remote", `ssh-remote+${alias}`, REMOTE_WORK_DIR];
    case "zed":
      return [`ssh://${REMOTE_USER}@${alias}${REMOTE_WORK_DIR}`];
  }
}

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function proxyCommandString(agentRef: string, serverFlag?: string): string {
  const node = shQuote(process.execPath);
  const script = shQuote(process.argv[1] ? resolve(process.argv[1]) : "");
  const damArgs = [
    "ssh",
    "_proxy",
    agentRef,
    ...(serverFlag ? ["--server", serverFlag] : []),
  ]
    .map(shQuote)
    .join(" ");
  return [
    `set -- ${damArgs}`,
    `if [ -x ${node} ] && [ -f ${script} ]; then exec ${node} ${script} "$@"`,
    `elif command -v node >/dev/null 2>&1 && [ -f ${script} ]; then exec node ${script} "$@"`,
    `elif command -v dam >/dev/null 2>&1; then exec dam "$@"`,
    `else for s in zsh bash; do command -v "$s" >/dev/null 2>&1 || continue; ` +
      `d=$("$s" -ic 'command -v dam' </dev/null 2>/dev/null | tail -n1); ` +
      `[ -n "$d" ] && [ -x "$d" ] && exec "$d" "$@"; done; ` +
      `echo 'dam ssh _proxy: dam not found (resolved node+script, node/dam on PATH, or via zsh/bash)' >&2; exit 127`,
    `fi`,
  ].join("; ");
}

function sshConfigValue(v: string): string {
  return /\s/.test(v) ? `"${v}"` : v;
}

function sanitizeHost(agentRef: string): string {
  return agentRef.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
}

function sshHostOptions(paths: SshPaths): [string, string][] {
  return [
    ["User", REMOTE_USER],
    ["IdentitiesOnly", "yes"],
    ["IdentityFile", paths.privateKey],
    ["UserKnownHostsFile", "/dev/null"],
    ["StrictHostKeyChecking", "no"],
    ["LogLevel", "ERROR"],
    ["PreferredAuthentications", "publickey"],
  ];
}

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

function damConfigPath(env: NodeJS.ProcessEnv): string {
  const xdg = env.XDG_CONFIG_HOME;
  return join(
    xdg && xdg.length > 0 ? xdg : join(homedir(), ".config"),
    "dam",
    "ssh_config",
  );
}

const managedBlockRe = () =>
  /# >>> dam ssh: (\S+) \(managed\) >>>[\s\S]*?# <<< dam ssh: \1 \(managed\) <<</g;

function dropManagedBlocks(
  content: string,
  remove: (alias: string) => boolean,
): { body: string; removed: string[] } {
  const removed: string[] = [];
  const stripped = content.replace(managedBlockRe(), (full, alias: string) => {
    if (!remove(alias)) return full;
    removed.push(alias);
    return "";
  });
  const body = stripped
    .replace(/^\s*\n/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
  return { body, removed };
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
    ...sshHostOptions(opts.paths).map(
      ([k, v]) => `  ${k} ${sshConfigValue(v)}`,
    ),
    `  ProxyCommand ${proxyCommandString(opts.agentRef, opts.serverFlag)}`,
    end,
  ].join("\n");

  const damConfig = damConfigPath(env);
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

  const userConfig = join(homedir(), ".ssh", "config");
  await mkdir(dirname(userConfig), { recursive: true, mode: 0o700 });
  let userExisting = "";
  try {
    userExisting = await readFile(userConfig, "utf8");
  } catch {}
  const includeLine = `Include ${sshConfigValue(damConfig)}`;
  if (!userExisting.includes(damConfig))
    await writeFile(
      userConfig,
      `# dam ssh (managed)\n${includeLine}\n${userExisting ? `\n${userExisting}` : ""}`,
      { mode: 0o600 },
    );
  return alias;
}

export async function pruneManagedHosts(opts: {
  keep: Set<string>;
  env?: NodeJS.ProcessEnv;
}): Promise<string[]> {
  const env = opts.env ?? process.env;
  const damConfig = damConfigPath(env);
  let existing = "";
  try {
    existing = await readFile(damConfig, "utf8");
  } catch {
    return [];
  }
  const { body, removed } = dropManagedBlocks(
    existing,
    (alias) => !opts.keep.has(alias),
  );
  if (removed.length)
    await writeFile(damConfig, body ? `${body}\n` : "", { mode: 0o600 });
  return removed;
}

export async function clearManagedHosts(
  opts: { env?: NodeJS.ProcessEnv } = {},
): Promise<number> {
  const env = opts.env ?? process.env;
  const damConfig = damConfigPath(env);
  let existing = "";
  try {
    existing = await readFile(damConfig, "utf8");
  } catch {
    return 0;
  }
  const { body, removed } = dropManagedBlocks(existing, () => true);
  if (body) {
    await writeFile(damConfig, `${body}\n`, { mode: 0o600 });
  } else {
    await rm(damConfig, { force: true });
    await removeDamInclude(damConfig);
  }
  return removed.length;
}

async function removeDamInclude(damConfig: string): Promise<void> {
  const userConfig = join(homedir(), ".ssh", "config");
  let content = "";
  try {
    content = await readFile(userConfig, "utf8");
  } catch {
    return;
  }
  const includeLine = `Include ${sshConfigValue(damConfig)}`;
  const lines = content.split("\n");
  const kept = lines.filter(
    (l, i) =>
      l !== includeLine &&
      !(l === "# dam ssh (managed)" && lines[i + 1] === includeLine),
  );
  const next = kept
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n{3,}/g, "\n\n");
  await writeFile(userConfig, next, { mode: 0o600 });
}
