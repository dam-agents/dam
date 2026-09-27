import type { AgentBackend, TemplateSpec } from "api-server-api";
import { match } from "ts-pattern";
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

// UNIT_BOUNDARY_DESCRIPTION: the backend is the one field a caller chooses independently of the image, and no template declares one — the same image boots either way. It arrives already resolved (resolveBackend), which never puts a template carrying runtimeClassName or nodeSelector on the vm backend, so both are copied as the template states them. A container is written as no backend at all, the CRD's own default.
export function assembleSpecFromTemplate(
  name: string,
  tmplSpec: TemplateSpec,
  opts: {
    description?: string;
    size?: { cpu?: string; memory?: string };
    backend: AgentBackend;
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
    backend: backendSpec(opts.backend),
    runtimeClassName: tmplSpec.runtimeClassName,
    nodeSelector: tmplSpec.nodeSelector,
  };
}

export function assembleSpecFromImage(
  name: string,
  opts: {
    image?: string;
    description?: string;
    size?: { cpu?: string; memory?: string };
    backend: AgentBackend;
    storage?: string;
  },
  defaultLimits: DefaultResourceLimits,
): Record<string, unknown> {
  return {
    name,
    image: opts.image,
    description: opts.description,
    resources: concreteResources(undefined, opts.size, defaultLimits),
    backend: backendSpec(opts.backend),
    storageSize: opts.storage,
  };
}

function backendSpec(backend: AgentBackend): { type: "vm" } | undefined {
  return match(backend)
    .with("container", () => undefined)
    .with("vm", () => ({ type: "vm" as const }))
    .exhaustive();
}
