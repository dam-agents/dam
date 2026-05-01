import type { AgentsService } from "./modules/agents/types.js";
import type { ChannelsService } from "./modules/channels/types.js";
import type { ConnectionsService } from "./modules/connections/types.js";
import type { InstancesService } from "./modules/instances/types.js";
import type { SchedulesService } from "./modules/schedules/types.js";
import type { SecretsService } from "./modules/secrets/types.js";
import type { SessionsService } from "./modules/sessions/types.js";
import type { SkillsService } from "./modules/skills/types.js";
import type { TemplatesService } from "./modules/templates/types.js";

export interface UserIdentity {
  sub: string;
  preferredUsername: string;
}

export interface ApiContext {
  templates: TemplatesService;
  agents: AgentsService;
  instances: InstancesService;
  schedules: SchedulesService;
  sessions: SessionsService;
  secrets: SecretsService;
  channels: ChannelsService;
  connections: ConnectionsService;
  skills: SkillsService;
  user: UserIdentity;
}
