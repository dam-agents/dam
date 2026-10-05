import type { AgentSpec, TemplateSpec, TemplateUpdate } from "api-server-api";
import { isVmBackend } from "./runtime-migration.js";

// UNIT_BOUNDARY_DESCRIPTION: whether an Agent is offered its template's newer image. A template that declares the vm backend ships a bare image whose tools only a microVM mounts, so a container agent is not offered it: it would no longer boot. Once it migrates to the vm backend, the same upgrade is offered.
export function templateImageUpdate(
  agent: AgentSpec,
  template: TemplateSpec,
): TemplateUpdate | undefined {
  if (!agent.image || agent.image === template.image) return undefined;
  if (template.backend === "vm" && !isVmBackend(agent)) return undefined;
  return { fromImage: agent.image, toImage: template.image };
}
