import type { ContainerEngine, ProcessContainer } from "agent-runtime-api";
import { match, P } from "ts-pattern";

const SHORT_ID_LENGTH = 12;

function programName(arg: string): string {
  return arg.slice(arg.lastIndexOf("/") + 1);
}

function flagValue(args: readonly string[], flag: string): string | null {
  for (const [at, arg] of args.entries()) {
    const name = arg.replace(/^--?/, "");
    if (name === arg) continue;
    if (name === flag) return args[at + 1] ?? null;
    if (name.startsWith(`${flag}=`)) return name.slice(flag.length + 1);
  }
  return null;
}

function engineOf(command: string, namespace: string | null): ContainerEngine {
  if (namespace === "moby") return "docker";
  return command.includes("/k3s/") ? "k3s" : "containerd";
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: Recognizes a container or a container runtime
 * daemon from a command line alone, so the Processes panel can name it
 * without asking the runtime. Docker and k3s run every container under a
 * containerd shim (`containerd-shim-runc-v2 -namespace <ns> -id <id>`): the
 * `moby` namespace is Docker's, and a k3s shim runs from and talks to paths
 * under `/k3s/`. The id is cut to the 12 characters `docker ps` and `crictl`
 * accept. The daemons are `dockerd`, `containerd` and `k3s server` or
 * `k3s agent`.
 */
export function containerOf(command: string): ProcessContainer | null {
  const args = command.split(" ").filter((arg) => arg !== "");
  const program = programName(args[0] ?? "");
  return match(program)
    .with(P.string.startsWith("containerd-shim"), () => {
      const id = flagValue(args, "id");
      if (id === null || id === "") return null;
      return {
        role: "container" as const,
        engine: engineOf(command, flagValue(args, "namespace")),
        id: id.slice(0, SHORT_ID_LENGTH),
      };
    })
    .with("dockerd", () => ({
      role: "runtime" as const,
      engine: "docker" as const,
    }))
    .with("containerd", () => ({
      role: "runtime" as const,
      engine: engineOf(command, null),
    }))
    .with("k3s", () =>
      args[1] === "server" || args[1] === "agent"
        ? { role: "runtime" as const, engine: "k3s" as const }
        : null,
    )
    .otherwise(() => null);
}
