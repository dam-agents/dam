import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { exec, CommandError } from "./exec.js";
import { parseQuantity } from "../../../core/quantity.js";
import type { Image, ImageStore } from "./image-store.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: The sandbox itself — a gVisor container, created
 * and started by calling runsc with a bundle we write. Nothing sits between
 * this and the kernel: a container runtime daemon would add a second lifecycle
 * to keep in step with the supervisor's, and its shim is the one thing that
 * could not join the per-agent network namespace at all.
 *
 * The rootfs is an overlay: the image's directory read-only underneath, a
 * per-agent upper on the node above it. Writes therefore outlive the sandbox
 * process, which is what lets a crashed sandbox be recreated rather than
 * rebuilt, and gVisor's own overlay is turned off so nothing shadows it. A
 * change of image is the one case where the upper is discarded: it records
 * writes against the layers underneath it, and keeping it over a different
 * image would make a rootfs that was never built.
 *
 * The bundle's config.json is also the record of what the running sandbox was
 * given. A sandbox whose desired spec no longer matches it — a new image
 * digest, a changed environment, a different mount — is replaced rather than
 * left alone, which is the only way a spec edit ever reaches the agent.
 *
 * Every runsc invocation for one sandbox must carry identical global flags —
 * they are part of how it finds its own state — so they live in one place.
 * create and start hand the sandbox their stdio, so they are spawned with the
 * agent's log file on both streams; a pipe would never see EOF and the call
 * would hang.
 *
 * The sandbox runs as the user its image names — the harnesses refuse to run
 * as root, and the agent's own directories are chowned to that user so it can
 * write them. The overlay's own directories are 0755 for the same reason:
 * overlayfs takes the merged root's mode from the upper, and that root is the
 * sandbox's "/", so a stricter mode leaves a non-root agent unable to traverse
 * its own filesystem at all. Nothing is exposed by it — the directory above is
 * already closed to everyone but the gateway user. A name is resolved against the image's /etc/passwd, not the
 * node's.
 *
 * The sandbox runs with Docker's default capability set, which is what images
 * are built to expect. Those are capabilities inside gVisor's own kernel, not
 * on the node: the boundary is the sentry, and an agent that cannot chown its
 * own files is broken for no gain in safety.
 */

export interface SandboxSpec {
  agentId: string;
  image: string;
  registryAuthPath?: string;
  netns: string;
  env: Record<string, string>;
  mounts: { source: string; target: string; readOnly?: boolean }[];
  stateDir: string;
  workingDir?: string;
  command?: string[];
  limits?: { cpu?: string; memory?: string };
}

export interface SandboxState {
  running: boolean;
  exitCode?: number;
  reason?: string;
  restarts: number;
}

export interface RunscPort {
  ensureRunning(spec: SandboxSpec): Promise<void>;
  stop(agentId: string, stateDir: string): Promise<void>;
  inspect(agentId: string): Promise<SandboxState | null>;
  list(): Promise<string[]>;
}

const RUNSC_FLAGS = ["--network=sandbox", "--overlay2=none"];
const containerId = (agentId: string) => `dam-${agentId}`;

interface RunscState {
  status?: string;
  id?: string;
}

export function createRunscPort(deps: {
  images: ImageStore;
  log: (message: string, fields?: Record<string, unknown>) => void;
}): RunscPort {
  const restarts = new Map<string, number>();

  const runsc = (args: string[], timeoutMs = 120_000) =>
    exec("runsc", [...RUNSC_FLAGS, ...args], { timeoutMs });

  async function state(agentId: string): Promise<RunscState | null> {
    const out = await runsc(["state", containerId(agentId)], 30_000).catch(
      (err: unknown) => {
        if (err instanceof CommandError) return null;
        throw err;
      },
    );
    return out === null ? null : (JSON.parse(out) as RunscState);
  }

  return {
    async ensureRunning(spec) {
      const image = await deps.images.ensure(spec.image, {
        ...(spec.registryAuthPath ? { authDir: spec.registryAuthPath } : {}),
      });
      const user = await resolveUser(image);
      const bundle = join(spec.stateDir, "bundle");
      const configPath = join(bundle, "config.json");
      const desired = JSON.stringify(
        buildOciSpec(spec, join(spec.stateDir, "merged"), image, user),
        null,
        2,
      );

      const applied = await readFile(configPath, "utf8").catch(() => "");

      const current = await state(spec.agentId);
      if (current?.status === "running" && applied === desired) return;
      if (current) {
        if (current.status !== "running") {
          restarts.set(spec.agentId, (restarts.get(spec.agentId) ?? 0) + 1);
        }
        await runsc(["delete", "-force", containerId(spec.agentId)]).catch(
          () => {},
        );
      }

      await mountOverlay(spec.stateDir, image.rootfs);
      for (const mount of spec.mounts) {
        if (mount.readOnly) continue;
        const owner = await exec("stat", ["-c", "%u:%g", mount.source]).catch(
          () => "",
        );
        if (owner.trim() !== `${user.uid}:${user.gid}`) {
          await exec("chown", ["-R", `${user.uid}:${user.gid}`, mount.source]);
        }
      }
      await mkdir(bundle, { recursive: true, mode: 0o750 });
      await writeFile(configPath, desired, { mode: 0o640 });

      const log = join(spec.stateDir, "runsc.log");
      await spawnDetached(
        ["create", `--bundle=${bundle}`, containerId(spec.agentId)],
        log,
      );
      await spawnDetached(["start", containerId(spec.agentId)], log);
    },

    async stop(agentId, stateDir) {
      await runsc(["kill", containerId(agentId), "SIGTERM"]).catch(() => {});
      await runsc(["delete", "-force", containerId(agentId)]).catch(() => {});
      restarts.delete(agentId);
      await exec("umount", [join(stateDir, "merged")]).catch(() => {});
      for (const sub of ["upper", "work", "merged", "bundle"]) {
        await rm(join(stateDir, sub), { recursive: true, force: true }).catch(
          () => {},
        );
      }
    },

    async inspect(agentId) {
      const current = await state(agentId);
      if (!current) return null;
      const running = current.status === "running";
      return {
        running,
        ...(running ? {} : { reason: reasonFor(current.status) }),
        restarts: restarts.get(agentId) ?? 0,
      };
    },

    async list() {
      const out = await runsc(["list", "--format=json"], 30_000).catch(
        () => "[]",
      );
      const rows =
        (JSON.parse(out || "null") as { id?: string }[] | null) ?? [];
      return rows.flatMap((r) =>
        r.id?.startsWith("dam-") ? [r.id.slice("dam-".length)] : [],
      );
    },
  };

  async function spawnDetached(args: string[], log: string): Promise<void> {
    const quoted = [...RUNSC_FLAGS, ...args]
      .map((a) => `'${a.replaceAll("'", `'\\''`)}'`)
      .join(" ");
    const before = await stat(log).then(
      (s) => s.size,
      () => 0,
    );
    try {
      await exec("bash", [
        "-c",
        `exec runsc ${quoted} >>'${log}' 2>&1 </dev/null`,
      ]);
    } catch (err) {
      const written = await readFile(log, "utf8").then(
        (t) => t.slice(before, before + 2000),
        () => "",
      );
      throw new Error(
        `runsc ${args.join(" ")} failed: ${written || (err as Error).message}`,
      );
    }
  }
}

async function mountOverlay(stateDir: string, rootfs: string): Promise<string> {
  const merged = join(stateDir, "merged");
  const options = await exec("findmnt", ["-n", "-o", "OPTIONS", merged]).catch(
    () => "",
  );
  if (!options.includes(`lowerdir=${rootfs}`)) {
    if (options) {
      await exec("umount", [merged]);
      for (const sub of ["upper", "work"]) {
        await rm(join(stateDir, sub), { recursive: true, force: true });
      }
    }
    for (const sub of ["upper", "work", "merged"]) {
      await mkdir(join(stateDir, sub), { recursive: true, mode: 0o755 });
    }
    await exec("mount", [
      "-t",
      "overlay",
      "overlay",
      "-o",
      `lowerdir=${rootfs},upperdir=${join(stateDir, "upper")},workdir=${join(stateDir, "work")}`,
      merged,
    ]);
  }
  await exec("chmod", ["0755", merged]);
  return merged;
}

const reasonFor = (status: string | undefined) =>
  status === "stopped" ? "ContainerTerminated" : (status ?? "SandboxNotReady");

const SANDBOX_CAPABILITIES = [
  "CAP_CHOWN",
  "CAP_DAC_OVERRIDE",
  "CAP_FOWNER",
  "CAP_FSETID",
  "CAP_KILL",
  "CAP_NET_BIND_SERVICE",
  "CAP_SETFCAP",
  "CAP_SETGID",
  "CAP_SETPCAP",
  "CAP_SETUID",
  "CAP_SYS_CHROOT",
  "CAP_MKNOD",
  "CAP_AUDIT_WRITE",
];

interface SandboxUser {
  uid: number;
  gid: number;
}

async function resolveUser(image: Image): Promise<SandboxUser> {
  const [name = "", group = ""] = image.config.user.split(":");
  const numeric = (v: string) => (/^\d+$/.test(v) ? Number(v) : null);
  const uid = numeric(name);
  if (uid !== null) return { uid, gid: numeric(group) ?? uid };
  if (!name) return { uid: 0, gid: 0 };

  const passwd = await readFile(join(image.rootfs, "etc/passwd"), "utf8").catch(
    () => "",
  );
  const row = passwd
    .split("\n")
    .map((l) => l.split(":"))
    .find((f) => f[0] === name);
  if (!row)
    throw new Error(
      `image user ${image.config.user} is not in its own /etc/passwd`,
    );
  return { uid: Number(row[2]), gid: numeric(group) ?? Number(row[3]) };
}

function buildOciSpec(
  spec: SandboxSpec,
  root: string,
  image: Image,
  user: SandboxUser,
): Record<string, unknown> {
  const env = new Map<string, string>();
  for (const entry of image.config.env) {
    const eq = entry.indexOf("=");
    if (eq > 0) env.set(entry.slice(0, eq), entry.slice(eq + 1));
  }
  for (const [name, value] of Object.entries(spec.env)) env.set(name, value);
  const command = spec.command?.length
    ? spec.command
    : [...image.config.entrypoint, ...image.config.cmd];
  return {
    ociVersion: "1.0.0",
    annotations: { "ai.agent-platform.image-rootfs": image.rootfs },
    process: {
      terminal: false,
      user,
      args: command,
      env: [...env].map(([k, v]) => `${k}=${v}`),
      cwd: spec.workingDir || image.config.workingDir || "/",
      capabilities: {
        bounding: SANDBOX_CAPABILITIES,
        effective: SANDBOX_CAPABILITIES,
        permitted: SANDBOX_CAPABILITIES,
      },
      rlimits: [{ type: "RLIMIT_NOFILE", hard: 65_536, soft: 65_536 }],
      noNewPrivileges: true,
    },
    root: { path: root, readonly: false },
    hostname: spec.agentId,
    mounts: [
      { destination: "/proc", type: "proc", source: "proc" },
      {
        destination: "/dev",
        type: "tmpfs",
        source: "tmpfs",
        options: ["nosuid", "strictatime", "mode=755", "size=65536k"],
      },
      {
        destination: "/dev/pts",
        type: "devpts",
        source: "devpts",
        options: [
          "nosuid",
          "noexec",
          "newinstance",
          "ptmxmode=0666",
          "mode=0620",
        ],
      },
      {
        destination: "/dev/shm",
        type: "tmpfs",
        source: "shm",
        options: ["nosuid", "noexec", "nodev", "mode=1777", "size=65536k"],
      },
      {
        destination: "/sys",
        type: "sysfs",
        source: "sysfs",
        options: ["nosuid", "noexec", "nodev", "ro"],
      },
      {
        destination: "/tmp",
        type: "tmpfs",
        source: "tmpfs",
        options: ["nosuid", "nodev"],
      },
      ...spec.mounts.map((m) => ({
        destination: m.target,
        type: "bind",
        source: m.source,
        options: ["rbind", m.readOnly ? "ro" : "rw"],
      })),
    ],
    linux: {
      namespaces: [
        { type: "pid" },
        { type: "ipc" },
        { type: "uts" },
        { type: "mount" },
        { type: "network", path: `/run/netns/${spec.netns}` },
      ],
      ...(spec.limits ? { resources: resourcesFor(spec.limits) } : {}),
    },
  };
}

function resourcesFor(limits: { cpu?: string; memory?: string }) {
  const memory = limits.memory ? parseQuantity(limits.memory) : null;
  const cpu = limits.cpu ? parseQuantity(limits.cpu) : null;
  return {
    ...(memory ? { memory: { limit: memory } } : {}),
    ...(cpu
      ? { cpu: { quota: Math.round(cpu * 100_000), period: 100_000 } }
      : {}),
  };
}
