import type { AgentsService } from "./modules/agents/types.js";
import type { ApprovalsService } from "./modules/approvals/types.js";
import type { ChannelsService } from "./modules/channels/types.js";
import type { ConnectionsService } from "./modules/connections/types.js";
import type { E2eService } from "./modules/e2e/types.js";
import type { EgressRulesService } from "./modules/egress-rules/types.js";
import type { FilesService } from "./modules/files/router.js";
import type { SchedulesService } from "./modules/schedules/types.js";
import type { SecretsService } from "./modules/secrets/types.js";
import type { SkillsService } from "./modules/skills/types.js";
import type { ReposService } from "./modules/repos/types.js";
import type { TemplatesService } from "./modules/templates/types.js";
import type { TermsService } from "./modules/terms/types.js";

export interface UserIdentity {
  sub: string;
  preferredUsername: string;
}

export interface ApiContext {
  templates: TemplatesService;
  repos: ReposService;
  agents: AgentsService;
  schedules: SchedulesService;
  secrets: SecretsService;
  channels: ChannelsService;
  connections: ConnectionsService;
  skills: SkillsService;
  approvals: ApprovalsService;
  egressRules: EgressRulesService;
  files: FilesService;
  terms: TermsService;
  e2e: E2eService;
  user: UserIdentity;
  e2eEnabled: boolean;
}
