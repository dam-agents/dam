import type { FilesService } from "./modules/files/types.js";
import type { SkillsService } from "./modules/skills/types.js";

export interface AgentAuth {
  agentCaller: true;
}

export interface AgentRuntimeContext {
  auth: AgentAuth | null;
  files: FilesService;
  skills: SkillsService;
}
