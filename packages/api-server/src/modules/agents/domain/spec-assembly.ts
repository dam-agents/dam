import type { TemplateSpec } from "api-server-api";
import { durationToMinutes } from "../../../duration.js";

// Effective idle timeout in minutes: a per-agent override (Go duration on the spec) wins, else the global default. 0 = never hibernate.
export function resolveEffectiveHibernationTimeoutMin(
  override: string | undefined,
  globalIdleTimeoutMin: number,
): number {
  return override != null ? durationToMinutes(override) : globalIdleTimeoutMin;
}

export function assembleSpecFromTemplate(
  name: string,
  tmplSpec: TemplateSpec,
  opts: { description?: string },
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
    resources: tmplSpec.resources,
    imagePullPolicy: tmplSpec.imagePullPolicy,
    imagePullSecretRef: tmplSpec.imagePullSecretRef,
    storageSize: tmplSpec.storageSize,
  };
}

// Bare-image agents (no template) ship a minimal spec — just enough for
// the controller to identify the image. Everything else (mounts, env,
// resources, security context) falls through to the chart's
// `controller.agent.base` / `templateDefaults` at reconcile time.
export function assembleSpecFromImage(
  name: string,
  opts: { image?: string; description?: string },
): Record<string, unknown> {
  return {
    name,
    image: opts.image,
    description: opts.description,
  };
}
