import { exec, CommandError } from "./exec.js";

/**
 * The sandbox runtime: containerd with the gVisor (`runsc`) handler, driven
 * through nerdctl.
 *
 * nerdctl is the containerd project's own CLI, so image pull, registry auth
 * and snapshot handling come from containerd itself rather than from us.
 * Ceiling: it is a CLI, so there is no task event stream — a container that
 * dies is noticed on the next reconcile tick, not the instant it exits. The
 * upgrade path is a small Go helper exposing containerd's event API over a
 * socket; nothing above this port would change.
 */

export const RUNSC_RUNTIME = "io.containerd.runsc.v1";

export interface SandboxSpec {
  agentId: string;
  image: string;
  /** `always` | `missing` | `never`. */
  pullPolicy?: string;
  /** Docker config directory for a private registry, if the image needs one. */
  registryAuthPath?: string;
  netns: string;
  env: Record<string, string>;
  mounts: { source: string; target: string; readOnly?: boolean }[];
  limits?: { cpu?: string; memory?: string };
  labels?: Record<string, string>;
}

export interface SandboxState {
  running: boolean;
  /** Exit code of the last run, when it ended abnormally. */
  exitCode?: number;
  /** Why the runtime says it ended — OOMKilled, Error, Completed. */
  reason?: string;
  restarts: number;
}

export interface ContainerdPort {
  ensureRunning(spec: SandboxSpec): Promise<void>;
  stop(agentId: string): Promise<void>;
  remove(agentId: string): Promise<void>;
  inspect(agentId: string): Promise<SandboxState | null>;
  list(): Promise<string[]>;
}

const containerName = (agentId: string) => `dam-${agentId}`;

interface NerdctlInspect {
  State?: {
    Running?: boolean;
    ExitCode?: number;
    OOMKilled?: boolean;
    Error?: string;
  };
  RestartCount?: number;
  Config?: { Image?: string; Labels?: Record<string, string> };
}

export function createContainerdPort(opts: {
  /** cgroup memory headroom is enforced by the runtime, not by us. */
  namespace?: string;
}): ContainerdPort {
  const ns = opts.namespace ?? "dam";
  const nerdctl = (args: string[]) =>
    exec("nerdctl", ["--namespace", ns, ...args]);

  return {
    async ensureRunning(spec) {
      const state = await this.inspect(spec.agentId);
      if (state?.running) return;
      if (state) await this.remove(spec.agentId);

      const args = [
        "--namespace", ns,
        "run", "--detach",
        "--name", containerName(spec.agentId),
        "--runtime", RUNSC_RUNTIME,
        "--network", `ns:/var/run/netns/${spec.netns}`,
        "--restart", "no",
        "--read-only=false",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
      ];
      if (spec.pullPolicy) args.push("--pull", spec.pullPolicy);
      for (const [name, value] of Object.entries(spec.env)) {
        args.push("--env", `${name}=${value}`);
      }
      for (const m of spec.mounts) {
        args.push("--volume", `${m.source}:${m.target}${m.readOnly ? ":ro" : ""}`);
      }
      if (spec.limits?.cpu) args.push("--cpus", spec.limits.cpu);
      if (spec.limits?.memory) args.push("--memory", spec.limits.memory);
      for (const [k, v] of Object.entries(spec.labels ?? {})) {
        args.push("--label", `${k}=${v}`);
      }
      args.push(spec.image);

      // A private-registry pull reads the docker config from the environment,
      // so a credential is scoped to the one pull that needs it rather than
      // installed node-wide.
      await exec("nerdctl", args, {
        timeoutMs: 15 * 60_000,
        ...(spec.registryAuthPath
          ? { env: { DOCKER_CONFIG: spec.registryAuthPath } }
          : {}),
      });
    },

    async stop(agentId) {
      await nerdctl(["stop", containerName(agentId)]).catch(ignoreMissing);
    },

    async remove(agentId) {
      await nerdctl(["rm", "--force", containerName(agentId)]).catch(
        ignoreMissing,
      );
    },

    async inspect(agentId) {
      let out: string;
      try {
        out = await nerdctl(["inspect", containerName(agentId)]);
      } catch (err) {
        if (isMissing(err)) return null;
        throw err;
      }
      const [info] = JSON.parse(out) as NerdctlInspect[];
      if (!info) return null;
      const state = info.State ?? {};
      return {
        running: state.Running === true,
        ...(state.ExitCode !== undefined && state.ExitCode !== 0
          ? { exitCode: state.ExitCode }
          : {}),
        ...(state.OOMKilled
          ? { reason: "OutOfMemory" }
          : state.ExitCode
            ? { reason: "ContainerTerminated" }
            : {}),
        restarts: info.RestartCount ?? 0,
      };
    },

    async list() {
      const out = await nerdctl(["ps", "--all", "--format", "{{.Names}}"]);
      return out
        .split("\n")
        .filter((n) => n.startsWith("dam-"))
        .map((n) => n.slice("dam-".length));
    },
  };
}

const isMissing = (err: unknown) =>
  err instanceof CommandError && /no such|not found/i.test(err.stderr);

function ignoreMissing(err: unknown): void {
  if (!isMissing(err)) throw err;
}
