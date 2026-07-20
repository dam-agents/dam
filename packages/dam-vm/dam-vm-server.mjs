#!/usr/bin/env node
// dam-vm-server — runs on the Incus VM host. Accepts WebSocket connections
// from the DAM api-server's harness relay (never from agents directly),
// speaking the same frame protocol as dam-run (OP_INPUT/OUTPUT/RESIZE/EXIT):
// it lazily creates the agent's Incus container and bridges the socket to
// `incus exec` under a PTY.
//
// Auth: mutual TLS. The api-server presents a client cert issued by the same
// private CA (openssl via `mise run dam-vm:issue-certs`, or a managed CA like
// IBM Cloud Secrets Manager) that signed this host's server cert; the TLS
// layer rejects any connection whose client cert the CA didn't sign, so only
// the DAM deployment can reach the relay — no application-level key.
// Inside that authenticated channel the relay sets one header:
//   x-dam-vm-agent  the agent's platform identity, already proven
//                   cryptographically by DAM's waypoint before the relay
//                   forwards it. Names the container, so one agent can never
//                   reach another's machine.
//
// One VPS serves many DAM clusters: the client-cert CN namespaces each
// cluster's containers (dam-<cluster>-<agentId>), so same-named agents in
// different clusters never collide. This is NOT cross-tenant isolation —
// containers are privileged+nesting (k3s needs it), so a container escape is
// host root and thus reaches every cluster's containers; a shared VPS is one
// trust domain. The CN namespace + per-cluster MAX_CONTAINERS just prevent
// accidental collisions and cross-cluster DoS. Issue one client cert per
// cluster (distinct canonical CN) from the shared CA.
//
// deps: ws @lydell/node-pty (installed by provision.sh)
// optional denylist: /etc/dam-vm/denied.json → ["<agentId>" | "<cluster>/<agentId>", ...]
// TLS material lives at /etc/dam-vm/{tls.crt,tls.key,client-ca.crt} (server
// leaf + key, and the CA used to verify client certs), bound on
// DAM_VM_LISTEN_HOST:DAM_VM_PORT (default 0.0.0.0:8090). Without a server cert
// it falls back to plain ws:// bound to 127.0.0.1 ONLY (for a local TLS proxy)
// — it is never served unauthenticated off-box.

import { WebSocketServer } from "ws";
import { spawn as ptySpawn } from "@lydell/node-pty";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";

const OP_INPUT = 0x00,
  OP_OUTPUT = 0x01,
  OP_RESIZE = 0x02,
  OP_EXIT = 0x03;

const LISTEN_HOST = process.env.DAM_VM_LISTEN_HOST || "0.0.0.0";
const LISTEN_PORT = process.env.DAM_VM_PORT
  ? Number(process.env.DAM_VM_PORT)
  : 8090;
const IMAGE = process.env.DAM_VM_IMAGE || "images:ubuntu/24.04";
const MAX_CONTAINERS = parseInt(process.env.DAM_VM_MAX_CONTAINERS, 10) || 50;
const IDLE_DELETE_MIN = parseInt(process.env.DAM_VM_IDLE_DELETE_MIN, 10) || 60;
// DAM agent ids are K8s resource names. Bounded so the composed container name
// `dam-<cluster>-<agentId>` stays under Incus's 63-char instance-name limit.
const AGENT_ID_RE = /^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$/;

// A DAM deployment ("cluster") is identified by the CN of its mTLS client
// cert, which namespaces its containers. The CN must ALREADY be a canonical
// cluster id (same shape `dam-vm:issue-certs` enforces) — we do NOT sanitize
// or truncate, because silently mapping two distinct CNs onto one namespace
// would let two clusters share VMs. A non-canonical CN is rejected. This
// bounds `dam-<cluster>-<agentId>` under Incus's 63-char name limit too.
const CLUSTER_ID_RE = /^[a-z0-9]([a-z0-9-]{0,14}[a-z0-9])?$/;
const clusterIdFromCert = (peerCert) => {
  const cn = peerCert?.subject?.CN || "";
  return CLUSTER_ID_RE.test(cn) ? cn : "";
};

let denied = [];
try {
  denied = JSON.parse(readFileSync("/etc/dam-vm/denied.json", "utf8"));
} catch {}

// `incus launch`/`start` stall indefinitely when their stdout is a plain pipe
// (the operation's progress renderer never finishes against a non-TTY pipe),
// so stdout is sent to /dev/null unless a caller needs to parse it (the JSON
// reads). stderr is always captured for error messages.
const incus = (args, { capture = false, timeoutMs = 120_000 } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn("incus", args, {
      stdio: ["ignore", capture ? "pipe" : "ignore", "pipe"],
      timeout: timeoutMs,
    });
    let out = "",
      err = "";
    child.stdout?.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code, signal) =>
      code === 0
        ? resolve(out)
        : reject(
            new Error(
              err.trim() || `incus ${args[0]} failed (${signal || code})`,
            ),
          ),
    );
  });

const exists = async (name) => {
  try {
    await incus(["info", name]);
    return true;
  } catch {
    return false;
  }
};

const touch = (name) =>
  incus([
    "config",
    "set",
    name,
    `user.last_active=${Math.floor(Date.now() / 1000)}`,
  ]);

// All managed containers share the `dam-` prefix (also guarantees the
// Incus-required leading letter); the cluster segment isolates deployments.
async function ensureContainer(clusterId, agentId) {
  const name = `dam-${clusterId}-${agentId}`;
  if (!(await exists(name))) {
    // Cap is per-cluster (prefix-scoped) so one deployment can't exhaust the
    // shared host and DoS the others.
    const count = JSON.parse(
      await incus(["list", `dam-${clusterId}-`, "--format", "json"], {
        capture: true,
      }),
    ).length;
    if (count >= MAX_CONTAINERS) throw new Error("container capacity reached");
    // A cold host pulls the ~2 GB base image on the first launch; give it far
    // more than the default per-command budget (provision.sh pre-pulls too).
    await incus(["launch", IMAGE, name], { timeoutMs: 600_000 });
    // give cloud-init/network a moment on first boot
    await new Promise((r) => setTimeout(r, 3000));
  } else {
    // e.g. host rebooted with the container down
    try {
      await incus(["start", name]);
    } catch {
      /* already running */
    }
  }
  await touch(name);
  return name;
}

// Idle reaper: containers are ephemeral — one with no live connection and a
// stale activity marker is deleted, filesystem and all; the next dam-vm call
// gets a fresh one. Naive full scan every 5 min; fine at MAX_CONTAINERS scale.
const active = new Map(); // container name → live connection count
setInterval(async () => {
  let list;
  try {
    list = JSON.parse(
      await incus(["list", "dam-", "--format", "json"], { capture: true }),
    );
  } catch {
    return;
  }
  const cutoff = Math.floor(Date.now() / 1000) - IDLE_DELETE_MIN * 60;
  for (const c of list) {
    if (active.get(c.name)) continue;
    const last = parseInt(c.config?.["user.last_active"], 10) || 0;
    if (last >= cutoff) continue;
    // The list snapshot is up to a scan-interval stale, so re-confirm — a
    // fresh connection or a touch() may have raced in — right before the
    // destructive delete, so we never nuke a live agent's filesystem.
    if (active.get(c.name)) continue;
    const fresh = parseInt(
      (
        await incus(["config", "get", c.name, "user.last_active"], {
          capture: true,
        }).catch(() => "")
      ).trim(),
      10,
    );
    if (fresh && fresh >= cutoff) continue;
    await incus(["delete", "-f", c.name]).catch(() => {});
  }
}, 5 * 60_000).unref();

// Serve mutual TLS: present the server leaf and require a client cert signed
// by the private CA (Secrets Manager, or any CA whose cert is at
// client-ca.crt). rejectUnauthorized makes the TLS layer drop clients without
// a CA-signed cert before the WebSocket layer sees them — that IS the auth.
// Falls back to plain HTTP only when no server cert is present (bind
// 127.0.0.1 behind a separate TLS proxy).
const TLS_CERT_FILE = process.env.DAM_VM_TLS_CERT_FILE || "/etc/dam-vm/tls.crt";
const TLS_KEY_FILE = process.env.DAM_VM_TLS_KEY_FILE || "/etc/dam-vm/tls.key";
const CLIENT_CA_FILE =
  process.env.DAM_VM_CLIENT_CA_FILE || "/etc/dam-vm/client-ca.crt";
const handler = (_, res) => {
  res.writeHead(404);
  res.end();
};
let server, scheme;
try {
  server = createHttpsServer(
    {
      cert: readFileSync(TLS_CERT_FILE),
      key: readFileSync(TLS_KEY_FILE),
      ca: readFileSync(CLIENT_CA_FILE),
      requestCert: true,
      rejectUnauthorized: true,
    },
    handler,
  );
  scheme = "wss(mTLS)";
} catch {
  server = createHttpServer(handler);
  scheme = "ws";
}
// Plain ws:// has no client-cert auth, so it must never be exposed off-box:
// force loopback regardless of DAM_VM_LISTEN_HOST (it's only for a local TLS
// proxy). mTLS binds wherever configured.
const bindHost = scheme === "ws" ? "127.0.0.1" : LISTEN_HOST;
const wss = new WebSocketServer({ server, path: "/run" });

wss.on("connection", async (ws, req) => {
  // The TLS layer already proved the client cert is CA-signed (rejectUnauthorized);
  // its CN names the calling DAM cluster and namespaces its containers. Plain
  // ws:// (no TLS, dev only) has no peer cert → single "local" namespace.
  const clusterId =
    scheme === "ws"
      ? "local"
      : clusterIdFromCert(req.socket.getPeerCertificate?.());
  if (!clusterId) return ws.close(4401, "client cert has no usable CN");
  const agentId = String(req.headers["x-dam-vm-agent"] || "");
  if (!AGENT_ID_RE.test(agentId)) return ws.close(4400, "bad agent id");
  // Denylist entries are `<agentId>` (all clusters) or `<clusterId>/<agentId>`.
  if (denied.includes(agentId) || denied.includes(`${clusterId}/${agentId}`))
    return ws.close(4403, "agent denied");

  const url = new URL(req.url, "http://localhost");
  let argv;
  try {
    argv = JSON.parse(
      Buffer.from(url.searchParams.get("argv") || "", "base64").toString(),
    );
    if (!Array.isArray(argv) || argv.some((a) => typeof a !== "string"))
      throw 0;
  } catch {
    return ws.close(4400, "bad argv");
  }
  if (argv.length === 0) argv = ["bash", "-l"];
  const cols = Math.min(500, parseInt(url.searchParams.get("cols"), 10) || 80);
  const rows = Math.min(300, parseInt(url.searchParams.get("rows"), 10) || 24);

  let name;
  try {
    name = await ensureContainer(clusterId, agentId);
  } catch (e) {
    return ws.close(4500, `provisioning failed: ${e.message}`.slice(0, 120));
  }
  if (ws.readyState !== ws.OPEN) return; // client gave up while provisioning
  active.set(name, (active.get(name) || 0) + 1);

  // argv goes to incus as an array — nothing is ever interpreted by a host shell
  const term = ptySpawn(
    "incus",
    [
      "exec",
      name,
      "--env",
      "TERM=xterm-256color",
      "--cwd",
      "/root",
      "--",
      ...argv,
    ],
    { name: "xterm-256color", cols, rows },
  );

  term.onData((data) => {
    if (ws.readyState !== ws.OPEN) return;
    const buf = Buffer.from(data);
    ws.send(Buffer.concat([Buffer.from([OP_OUTPUT]), buf]));
  });
  term.onExit(({ exitCode }) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(Buffer.from([OP_EXIT, exitCode & 0xff]));
      ws.close(1000);
    }
  });

  ws.on("message", (data) => {
    const buf = Buffer.from(data);
    if (buf.length === 0) return;
    if (buf[0] === OP_INPUT) term.write(buf.subarray(1).toString("binary"));
    else if (buf[0] === OP_RESIZE && buf.length >= 5)
      term.resize(
        Math.min(500, (buf[1] << 8) | buf[2]) || 80,
        Math.min(300, (buf[3] << 8) | buf[4]) || 24,
      );
  });
  ws.on("close", () => {
    try {
      term.kill();
    } catch {}
    const n = (active.get(name) || 1) - 1;
    n > 0 ? active.set(name, n) : active.delete(name);
    touch(name).catch(() => {}); // idle clock starts at disconnect
  });
});

server.listen(LISTEN_PORT, bindHost, () =>
  console.log(
    `dam-vm-server (${scheme}) on ${bindHost}:${server.address().port}, max ${MAX_CONTAINERS}/cluster`,
  ),
);
