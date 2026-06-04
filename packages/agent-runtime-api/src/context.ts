import type { FilesService } from "./modules/files/types.js";
import type { SkillsService } from "./modules/skills/types.js";
import type { RuntimeChannelService } from "./modules/runtime/service.js";

export interface AgentRuntimeContext {
  files: FilesService;
  skills: SkillsService;
  runtime: RuntimeChannelService;
}
