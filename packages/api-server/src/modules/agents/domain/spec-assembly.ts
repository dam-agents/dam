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

// UNIT_BOUNDARY_DESCRIPTION: the backend is a field a caller chooses independently of the image, unless the template declares the vm backend: its bare image gets its tools from a volume only a microVM mounts, so that template is a vm agent whatever the caller asked, and the create refusal for a microVM on an install without virtualization stays the gate. The template's harness is written to the spec, because one image serves every harness and the machine reads which one to run from it. runtimeClassName selects a container runtime and nodeSelector places a pod; the CRD rejects both on the vm backend, so neither survives the choice.
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
  const vm = opts.vm || tmplSpec.backend === "vm";
  return {
    name,
    image: tmplSpec.image,
    harness: tmplSpec.harness,
    description: opts.description ?? tmplSpec.description,
    mounts: tmplSpec.mounts,
    env: tmplSpec.env,
    resources: concreteResources(tmplSpec.resources, opts.size, defaultLimits),
    imagePullPolicy: tmplSpec.imagePullPolicy,
    imagePullSecretRef: tmplSpec.imagePullSecretRef,
    hibernationTimeout: tmplSpec.hibernationTimeout,
    storageSize: opts.storage ?? tmplSpec.storageSize,
    storageClass: tmplSpec.storageClass,
    backend: vm ? { type: "vm" } : undefined,
    runtimeClassName: vm ? undefined : tmplSpec.runtimeClassName,
    nodeSelector: vm ? undefined : tmplSpec.nodeSelector,
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
