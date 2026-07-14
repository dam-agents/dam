import type { TemplateSpec } from "api-server-api";
import { durationToMinutes } from "../../../duration.js";

// Effective idle timeout in minutes: a per-agent override (Go duration on the spec) wins, else the global default. 0 = never hibernate.
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

/** The agent's Size (#1900): the user's slider choice wins per dimension,
 *  else the template's limits, else the chart default. Reserved is read
 *  straight off `spec.resources.limits`, so every created agent carries
 *  concrete limits. Requests are never stamped — the controller derives them
 *  at render — except a template-set `requests`, which passes through as an
 *  operator escape hatch. */
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
    // `??` not `||`: a cleared ("") description stays empty; only an omitted
    // (undefined) one falls back to the template's default.
    description: opts.description ?? tmplSpec.description,
    mounts: tmplSpec.mounts,
    init: tmplSpec.init,
    env: tmplSpec.env,
    resources: concreteResources(tmplSpec.resources, opts.size, defaultLimits),
    imagePullPolicy: tmplSpec.imagePullPolicy,
    imagePullSecretRef: tmplSpec.imagePullSecretRef,
    // Template-seeded hibernation default ("0s" = never). The create flow
    // overwrites this when the user passes an explicit hibernationTimeoutMin,
    // so the template only supplies the default when the user doesn't choose.
    hibernationTimeout: tmplSpec.hibernationTimeout,
    storageSize: tmplSpec.storageSize,
    runtimeClassName: tmplSpec.runtimeClassName,
    nodeSelector: tmplSpec.nodeSelector,
  };
}

// Bare-image agents (no template) ship a minimal spec — just enough for
// the controller to identify the image. Everything else (mounts, env,
// security context) falls through to the chart's `controller.agent.base` /
// `templateDefaults` at reconcile time — except the size (limits), which is
// stamped concretely so Reserved (#1900) never re-derives it.
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
