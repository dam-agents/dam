import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WebSocket as WsWebSocket } from "ws";
import type { SshService } from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";
import { mergedSpawnEnv, type RuntimeEnvReader } from "../core/runtime-env.js";

const SSHD_PATH = process.env.SSHD_PATH || "/usr/sbin/sshd";
const SFTP_SERVER_CANDIDATES = [
  process.env.SFTP_SERVER_PATH,
  "/usr/libexec/openssh/sftp-server",
  "/usr/lib/openssh/sftp-server",
  "/usr/lib/ssh/sftp-server",
].filter((p): p is string => Boolean(p));

export interface PreparedSshd {
  sshdPath: string;
  configPath: string;
  homeDir: string;
}

const ENV_EXCLUDE_EXACT = new Set([
  "TERM",
  "COLORTERM",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "MAIL",
  "PWD",
  "OLDPWD",
  "SHLVL",
  "_",
  "HARNESS_SESSION_ID",
]);
const ENV_EXCLUDE_PREFIX = ["npm_config_", "npm_lifecycle_", "SSH_"];

export function buildSshEnvironmentFile(
  env: NodeJS.ProcessEnv,
  warn?: (msg: string) => void,
): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    if (ENV_EXCLUDE_EXACT.has(k)) continue;
    if (ENV_EXCLUDE_PREFIX.some((p) => k.startsWith(p))) continue;
    if (/[\r\n\0]/.test(v)) {
      warn?.(`skipping env ${k} (value spans multiple lines)`);
      continue;
    }
    lines.push(`${k}=${v}`);
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

export function refreshSshEnvironment(
  envReader: RuntimeEnvReader,
  homeDir: string,
  log: (msg: string) => void,
): void {
  const body = buildSshEnvironmentFile(mergedSpawnEnv(envReader), log);
  const sshDir = join(homeDir, ".ssh");
  const target = join(sshDir, "environment");
  try {
    mkdirSync(sshDir, { recursive: true, mode: 0o700 });
    const tmp = `${target}.tmp`;
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, target);
  } catch (e) {
    log(`failed to refresh ~/.ssh/environment: ${(e as Error).message}`);
  }
}

export async function prepareSshd(
  homeDir: string,
  log: (msg: string) => void,
): Promise<PreparedSshd | null> {
  if (!existsSync(SSHD_PATH)) {
    log(`sshd not found at ${SSHD_PATH}; SSH access disabled`);
    return null;
  }

  const sshDir = join(homeDir, ".ssh");
  await mkdir(sshDir, { recursive: true, mode: 0o700 });
  await chmod(sshDir, 0o700).catch(() => {});

  const hostKey = join(sshDir, "dam_ssh_host_ed25519_key");
  if (!existsSync(hostKey)) {
    const r = spawnSync(
      "ssh-keygen",
      ["-t", "ed25519", "-f", hostKey, "-N", "", "-q", "-C", "dam-agent-host"],
      { stdio: "pipe" },
    );
    if (r.status !== 0) {
      log(`ssh-keygen failed: ${r.stderr?.toString() ?? r.status}`);
      return null;
    }
  }

  const sftpServer = SFTP_SERVER_CANDIDATES.find((p) => existsSync(p));
  const authorizedKeys = join(sshDir, "authorized_keys");
  const configPath = join(sshDir, "dam_sshd_config");
  const lines = [
    `HostKey ${hostKey}`,
    `AuthorizedKeysFile ${authorizedKeys}`,
    "PubkeyAuthentication yes",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "StrictModes no",
    "PrintMotd no",
    "PermitUserEnvironment yes",
    "X11Forwarding no",
    "AllowTcpForwarding yes",
    ...(sftpServer ? [`Subsystem sftp ${sftpServer}`] : []),
  ];
  await writeFile(configPath, lines.join("\n") + "\n", { mode: 0o600 });

  if (!sftpServer) log("sftp-server not found; scp/sftp will be unavailable");

  return { sshdPath: SSHD_PATH, configPath, homeDir };
}

export function spawnSshd(
  ws: WsWebSocket,
  prepared: PreparedSshd,
  envReader: RuntimeEnvReader,
  log: (msg: string) => void,
): void {
  refreshSshEnvironment(envReader, prepared.homeDir, log);
  ws.binaryType = "nodebuffer";
  const child = spawn(
    prepared.sshdPath,
    ["-i", "-e", "-f", prepared.configPath],
    {
      stdio: ["pipe", "pipe", "pipe"],
    },
  );

  ws.on("message", (data: Buffer) => {
    if (child.stdin.writable) child.stdin.write(data);
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (ws.readyState === 1) ws.send(chunk, { binary: true });
  });
  child.stderr.on("data", (chunk: Buffer) => {
    const msg = chunk.toString().trimEnd();
    if (msg) log(msg);
  });

  const closeWs = () => {
    try {
      ws.close();
    } catch {}
  };
  const onStreamError = (where: string) => (e: Error) => {
    log(`sshd ${where} error: ${e.message}`);
    closeWs();
  };
  child.stdin.on("error", onStreamError("stdin"));
  child.stdout.on("error", onStreamError("stdout"));
  child.stderr.on("error", onStreamError("stderr"));
  child.on("exit", (code) => {
    log(`sshd exited ${code ?? "?"}`);
    closeWs();
  });
  child.on("error", (e) => {
    log(`sshd spawn error: ${e.message}`);
    closeWs();
  });

  const killChild = () => {
    try {
      child.kill("SIGKILL");
    } catch {}
  };
  ws.on("close", killChild);
  ws.on("error", killChild);
}

const PUBKEY_RE = /^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-\S+|sk-\S+)\s+\S+/;
const keyBody = (line: string) =>
  line.trim().split(/\s+/).slice(0, 2).join(" ");

export function createSshService(homeDir: string): SshService {
  const sshDir = join(homeDir, ".ssh");
  const authorizedKeys = join(sshDir, "authorized_keys");
  return {
    async authorizeKey(publicKey) {
      const key = publicKey.trim();
      if (/[\r\n]/.test(key) || !PUBKEY_RE.test(key))
        return err({ kind: "Invalid", reason: "not an OpenSSH public key" });

      await mkdir(sshDir, { recursive: true, mode: 0o700 });
      await chmod(sshDir, 0o700).catch(() => {});

      let existing = "";
      try {
        existing = await readFile(authorizedKeys, "utf8");
      } catch {}
      const body = keyBody(key);
      const present = existing
        .split("\n")
        .some((l) => l.trim() && keyBody(l) === body);
      if (!present) {
        const sep = existing && !existing.endsWith("\n") ? "\n" : "";
        await writeFile(authorizedKeys, existing + sep + key + "\n", {
          mode: 0o600,
        });
      }
      await chmod(authorizedKeys, 0o600).catch(() => {});
      return ok({ ok: true });
    },
  };
}
