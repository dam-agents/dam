import type { EgressPreset, TemplateSpec } from "api-server-api";
import { SPEC_VERSION } from "api-server-api";
import { defaultTemplateSpec } from "./defaults.js";

const DEFAULT_PRESET: EgressPreset = "trusted";

export function assembleSpecFromTemplate(
  name: string,
  tmplSpec: TemplateSpec,
  opts: { description?: string; egressPreset?: EgressPreset },
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
    egressPreset: opts.egressPreset ?? DEFAULT_PRESET,
  };
}

export function assembleSpecFromImage(
  name: string,
  opts: { image?: string; description?: string; egressPreset?: EgressPreset },
  agentHome: string,
): Record<string, unknown> {
  return {
    name,
    version: SPEC_VERSION,
    image: opts.image,
    description: opts.description,
    ...defaultTemplateSpec(agentHome),
    egressPreset: opts.egressPreset ?? DEFAULT_PRESET,
  };
}
