import type { TemplateSpec } from "api-server-api";
import { SPEC_VERSION } from "api-server-api";

export function assembleSpecFromTemplate(
  name: string,
  tmplSpec: TemplateSpec,
  opts: { description?: string },
): Record<string, unknown> {
  return {
    name,
    version: SPEC_VERSION,
    image: tmplSpec.image,
    // `??` not `||`: a cleared ("") description stays empty; only an omitted
    // (undefined) one falls back to the template's default.
    description: opts.description ?? tmplSpec.description,
    mounts: tmplSpec.mounts,
    init: tmplSpec.init,
    env: tmplSpec.env,
    resources: tmplSpec.resources,
    imagePullPolicy: tmplSpec.imagePullPolicy,
    storageSize: tmplSpec.storageSize,
    // skillPaths is required for the harness's skills-service to find the
    // installed skills directory; the chart sets it per template.
    skillPaths: tmplSpec.skillPaths,
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
    version: SPEC_VERSION,
    image: opts.image,
    description: opts.description,
  };
}
