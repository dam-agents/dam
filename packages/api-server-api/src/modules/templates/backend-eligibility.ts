import type { TemplateSpec } from "./types.js";

const AGENT_HOME = "/home/agent";
const MACHINE_RESOURCES = new Set(["cpu", "memory", "ephemeral-storage"]);

// UNIT_BOUNDARY_DESCRIPTION: the one answer to "can an agent from this template run on the vm Backend", shared by the create that refuses it and the template view that tells the form. A Template does not choose a Backend — the same image boots either way — but some of what it declares exists only for a pod: runtimeClassName picks a container runtime, nodeSelector places a pod, a resource other than cpu and memory asks the kubelet for a device, and a persisted mount outside HOME is a path a machine throws away at every stop. The CRD or the controller refuses each of these on a machine, so an install that prefers microVMs must give such a template a container instead. `requiresContainer` covers what the spec cannot show. The result is a reason a user can read, or undefined when a machine can run it.
export function containerOnlyReason(
  spec: Pick<
    TemplateSpec,
    | "requiresContainer"
    | "runtimeClassName"
    | "nodeSelector"
    | "resources"
    | "mounts"
  >,
): string | undefined {
  if (spec.requiresContainer) return "its template runs only as a container";
  if (spec.runtimeClassName)
    return `its template selects the container runtime "${spec.runtimeClassName}"`;
  if (spec.nodeSelector && Object.keys(spec.nodeSelector).length > 0)
    return "its template places its pod on selected nodes";
  const device = [
    ...Object.keys(spec.resources?.limits ?? {}),
    ...Object.keys(spec.resources?.requests ?? {}),
  ].find((name) => !MACHINE_RESOURCES.has(name));
  if (device) return `its template requests the device resource ${device}`;
  const outsideHome = spec.mounts?.find(
    (m) =>
      m.persist &&
      m.path !== AGENT_HOME &&
      !m.path.startsWith(`${AGENT_HOME}/`),
  );
  if (outsideHome)
    return `its template persists ${outsideHome.path}, and a machine keeps only ${AGENT_HOME}`;
  return undefined;
}
