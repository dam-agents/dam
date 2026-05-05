import type { FilesService } from "./modules/files/types.js";
import type { SkillsService } from "./modules/skills/types.js";

export interface AgentRuntimeContext {
  files: FilesService;
  skills: SkillsService;
}
