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

export function assembleSpecFromTemplate(
  name: string,
  tmplSpec: TemplateSpec,
  opts: { description?: string; size?: { cpu?: string; memory?: string } },
  defaultLimits: DefaultResourceLimits,
): Record<string, unknown> {
  return {
    name,
    image: tmplSpec.image,
    description: opts.description ?? tmplSpec.description,
    mounts: tmplSpec.mounts,
    init: tmplSpec.init,
    env: tmplSpec.env,
    resources: concreteResources(tmplSpec.resources, opts.size, defaultLimits),
    imagePullPolicy: tmplSpec.imagePullPolicy,
    imagePullSecretRef: tmplSpec.imagePullSecretRef,
    hibernationTimeout: tmplSpec.hibernationTimeout,
    storageSize: tmplSpec.storageSize,
    backend: tmplSpec.backend,
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
  },
  defaultLimits: DefaultResourceLimits,
): Record<string, unknown> {
  return {
    name,
    image: opts.image,
    description: opts.description,
    resources: concreteResources(undefined, opts.size, defaultLimits),
  };
}
