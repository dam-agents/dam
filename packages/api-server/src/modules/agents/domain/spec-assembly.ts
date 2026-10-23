import type { TemplateSpec } from "api-server-api";
import { goDurationToMinutes } from "../../../duration.js";

// UNIT_BOUNDARY_DESCRIPTION: the idle window an Agent hibernates after, in minutes: its own override, else the chart-wide default. The controller reads the override as a Go duration, so this does too: a positive duration under a minute projects to one rather than to zero, which the platform reads as never-hibernate, and a value the controller cannot read inherits the default. A machine is not offered the setting, so one that carries an override anyway — a Template or starter kit seed — honours it.
export function resolveEffectiveHibernationTimeoutMin(
  override: string | undefined,
  idleTimeoutMinutes: number,
): number {
  if (override != null) {
    const own = goDurationToMinutes(override);
    if (own != null) return own;
  }
  return idleTimeoutMinutes;
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

// UNIT_BOUNDARY_DESCRIPTION: the spec an Agent's machine is built from. Every Agent runs on its owner's runner, so the backend is written as the machine it is, and the template's size, class and mounts are what size that machine's disk. The template's harness is written to the spec, because one image serves every harness and the controller sets PLATFORM_HARNESS from it.
export function assembleSpecFromTemplate(
  name: string,
  tmplSpec: TemplateSpec,
  opts: {
    description?: string;
    size?: { cpu?: string; memory?: string };
    storage?: string;
  },
  defaultLimits: DefaultResourceLimits,
): Record<string, unknown> {
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
    backend: { type: "vm" },
  };
}

export function assembleSpecFromImage(
  name: string,
  opts: {
    image?: string;
    description?: string;
    size?: { cpu?: string; memory?: string };
    storage?: string;
  },
  defaultLimits: DefaultResourceLimits,
): Record<string, unknown> {
  return {
    name,
    image: opts.image,
    description: opts.description,
    resources: concreteResources(undefined, opts.size, defaultLimits),
    backend: { type: "vm" },
    storageSize: opts.storage,
  };
}
