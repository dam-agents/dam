import type { TemplateSpec } from "api-server-api";
import { durationToMinutes } from "../../../duration.js";

export function resolveEffectiveHibernationTimeoutMin(
  override: string | undefined,
  globalIdleTimeoutMin: number,
): number {
  return override != null ? durationToMinutes(override) : globalIdleTimeoutMin;
}

export interface DefaultResourceLimits {
  cpu: string;
  memory: string;
}

export function concreteResources(
  resources:
    | {
        requests?: Record<string, string>;
        limits?: Record<string, string>;
      }
    | undefined,
  size: { cpu?: string; memory?: string } | undefined,
  defaults: DefaultResourceLimits,
): { limits: Record<string, string>; requests?: Record<string, string> } {
  const limits = {
    ...resources?.limits,
    cpu: size?.cpu ?? resources?.limits?.cpu ?? defaults.cpu,
    memory: size?.memory ?? resources?.limits?.memory ?? defaults.memory,
  };
  return resources?.requests
    ? { limits, requests: resources.requests }
    : { limits };
}

// UNIT_BOUNDARY_DESCRIPTION: a machine has one disk, so the mounts a template declares become a list of paths on it rather than a volume each. Only the paths are carried over: the disk's size stays the Agent's own storageSize, which the controller already reads, so the number is not written down twice and cannot drift between them. A non-persisted mount has nothing to carry — a machine discards its whole root at every stop, so a path with no place on the disk is already empty on the next boot. A template with no mounts at all leaves the block off entirely, which is what tells the controller to fall back to the chart's default mounts instead of reading it as "persist nothing".
export function vmDiskFromMounts(
  mounts: TemplateSpec["mounts"],
): { disk: { persist: string[] } } | undefined {
  if (!mounts?.length) return undefined;
  return {
    disk: { persist: mounts.filter((m) => m.persist).map((m) => m.path) },
  };
}

// UNIT_BOUNDARY_DESCRIPTION: the backend is the one field a caller chooses independently of the image, and no template declares one — the same image boots either way. runtimeClassName selects a container runtime and nodeSelector places a pod; the CRD rejects both on the vm backend, so neither survives the choice.
export function assembleSpecFromTemplate(
  name: string,
  tmplSpec: TemplateSpec,
  opts: {
    description?: string;
    size?: { cpu?: string; memory?: string };
    vm?: boolean;
    storage?: string;
  },
  defaultLimits: DefaultResourceLimits,
): Record<string, unknown> {
  return {
    name,
    image: tmplSpec.image,
    description: opts.description ?? tmplSpec.description,
    mounts: tmplSpec.mounts,
    env: tmplSpec.env,
    resources: concreteResources(tmplSpec.resources, opts.size, defaultLimits),
    imagePullPolicy: tmplSpec.imagePullPolicy,
    imagePullSecretRef: tmplSpec.imagePullSecretRef,
    hibernationTimeout: tmplSpec.hibernationTimeout,
    storageSize: opts.storage ?? tmplSpec.storageSize,
    storageClass: tmplSpec.storageClass,
    backend: opts.vm
      ? { type: "vm", vm: vmDiskFromMounts(tmplSpec.mounts) }
      : undefined,
    runtimeClassName: opts.vm ? undefined : tmplSpec.runtimeClassName,
    nodeSelector: opts.vm ? undefined : tmplSpec.nodeSelector,
  };
}

export function assembleSpecFromImage(
  name: string,
  opts: {
    image?: string;
    description?: string;
    size?: { cpu?: string; memory?: string };
    vm?: boolean;
    storage?: string;
  },
  defaultLimits: DefaultResourceLimits,
): Record<string, unknown> {
  return {
    name,
    image: opts.image,
    description: opts.description,
    resources: concreteResources(undefined, opts.size, defaultLimits),
    backend: opts.vm ? { type: "vm" } : undefined,
    storageSize: opts.storage,
  };
}
