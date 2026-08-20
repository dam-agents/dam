import type { ExecService } from "./modules/exec/types.js";
import type { FilesService } from "./modules/files/types.js";
import type { SkillsService } from "./modules/skills/types.js";
import type { SshService } from "./modules/ssh/types.js";
import type { RuntimeChannelService } from "./modules/runtime/service.js";
import type { HarnessConfigService } from "./modules/harness-config/types.js";

export interface AgentRuntimeContext {
  exec: ExecService;
  files: FilesService;
  skills: SkillsService;
  ssh: SshService;
  runtime: RuntimeChannelService;
  harnessConfig: HarnessConfigService;
}
