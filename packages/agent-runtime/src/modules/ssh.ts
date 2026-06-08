import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WebSocket as WsWebSocket } from "ws";
import type { SshService } from "agent-runtime-api";
import { err, ok } from "agent-runtime-api";
import { readRuntimeEnv } from "../core/runtime-env.js";

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

// sshd resets the environment before the login shell, so the agent's pod env
// (proxy routing, credential sentinels, PATH) would otherwise vanish inside an
// SSH session — breaking egress (which is proxy-only) and every credentialed
// tool. We replay it through ~/.ssh/environment, rebuilt per connection
// (refreshSshEnvironment) so each session tracks env injected since boot.
// These keys are dropped: the connecting client owns the terminal, sshd/login
// set the identity vars for the target user, and the rest is local
// shell/tooling bookkeeping that would be wrong in a fresh shell.
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

/** Render ~/.ssh/environment (one `NAME=value` per line) from a process env.
 *  The file format takes each value literally to end-of-line — no quoting — so
 *  values with spaces are fine, but a newline would forge a second line; those
 *  are skipped. Non-identifier names (which sshd ignores anyway) are dropped. */
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

// Rebuild ~/.ssh/environment from the *current* merged env, called right before
// each session's sshd spawns. Env injection is hot — connection/credential
// changes land in the runtime-channel env file (core/runtime-env) without a pod
// restart — so a once-at-boot snapshot would feed every later SSH session stale
// proxy routing and credentials. sshd -i reads ~/.ssh/environment at session
// start and we spawn it synchronously after this write, so the refresh is
// picked up by exactly the connection that triggered it.
//
// Synchronous (writeFileSync) + atomic rename, mirroring the runtime-env
// reader: keeping the spawn path free of an `await` avoids dropping the SSH
// client's opening bytes (the message handler is attached synchronously in
// spawnSshd), and the rename means a concurrent session never reads a torn file.
export function refreshSshEnvironment(
  homeDir: string,
  log: (msg: string) => void,
): void {
  // Runtime-channel env first; pod env (process.env) wins on collision — the
  // same precedence the terminal PTY spawn uses, so an SSH login shell and a
  // terminal shell resolve to an identical environment.
  const merged: NodeJS.ProcessEnv = {
    ...readRuntimeEnv(homeDir),
    ...process.env,
  };
  const body = buildSshEnvironmentFile(merged, log);
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
    // Apply ~/.ssh/environment (written below) to every session. Safe here
    // because the SSH user IS the single pod user (uid 65532): no privilege
    // boundary for the usual LD_PRELOAD concern to cross — the same reasoning
    // that lets StrictModes off above.
    "PermitUserEnvironment yes",
    "X11Forwarding no",
    "AllowTcpForwarding yes",
    ...(sftpServer ? [`Subsystem sftp ${sftpServer}`] : []),
  ];
  await writeFile(configPath, lines.join("\n") + "\n", { mode: 0o600 });

  if (!sftpServer) log("sftp-server not found; scp/sftp will be unavailable");

  // ~/.ssh/environment is (re)written per connection in refreshSshEnvironment,
  // not here: env injection is hot, so a boot-time snapshot would go stale the
  // moment a connection or credential changes without a pod restart. The host
  // key, config, and sftp lookup above are boot-stable, so they stay.
  return { sshdPath: SSHD_PATH, configPath, homeDir };
}

export function spawnSshd(
  ws: WsWebSocket,
  prepared: PreparedSshd,
  log: (msg: string) => void,
): void {
  // Refresh the session env before spawning so this connection picks up any env
  // injected since boot (see refreshSshEnvironment). sshd reads the file below.
  refreshSshEnvironment(prepared.homeDir, log);
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
