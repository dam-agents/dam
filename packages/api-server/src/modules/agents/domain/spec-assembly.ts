import type { TemplateSpec } from "api-server-api";
import { SPEC_VERSION } from "api-server-api";
import { defaultTemplateSpec } from "./defaults.js";

export function assembleSpecFromTemplate(
  name: string,
  tmplSpec: TemplateSpec,
  opts: { description?: string },
): Record<string, unknown> {
  return {
    name,
    version: SPEC_VERSION,
    image: tmplSpec.image,
    description: opts.description ?? tmplSpec.description,
    mounts: tmplSpec.mounts,
    init: tmplSpec.init,
    env: tmplSpec.env,
    resources: tmplSpec.resources,
    securityContext: tmplSpec.securityContext,
    // Without this, the template's skillPaths is dropped and the
    // skills-service falls back to the hardcoded /home/agent/.agents/skills
    // default — so `defaultTemplate` (claude-code) installs end up in the
    // wrong dir for the harness to find.
    skillPaths: tmplSpec.skillPaths,
  };
}

export function assembleSpecFromImage(
  name: string,
  opts: { image?: string; description?: string },
  agentHome: string,
): Record<string, unknown> {
  return {
    name,
    version: SPEC_VERSION,
    image: opts.image,
    description: opts.description,
    ...defaultTemplateSpec(agentHome),
  };
}
