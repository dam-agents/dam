import type { AgentsService } from "./modules/agents/types.js";
import type { ApiKeysService, Scope } from "./modules/api-keys/types.js";
import type { ApprovalsService } from "./modules/approvals/types.js";
import type { ChannelsService } from "./modules/channels/types.js";
import type { ConnectionsService } from "./modules/connections/types.js";
import type { E2eService } from "./modules/e2e/types.js";
import type { EgressRulesService } from "./modules/egress-rules/types.js";
import type { ExperimentsService } from "./modules/experiments/types.js";
import type { FilesService } from "./modules/files/router.js";
import type { SchedulesService } from "./modules/schedules/types.js";
import type { SkillsService } from "./modules/skills/types.js";
import type { ReposService } from "./modules/repos/types.js";
import type { TemplatesService } from "./modules/templates/types.js";
import type { TermsService } from "./modules/terms/types.js";

export interface UserIdentity {
  sub: string;
  preferredUsername: string;
  /** Effective scopes granted to this principal for the current request.
   *  Keycloak-authenticated users carry all scopes; API-key principals
   *  carry the scopes recorded on the key intersected with the owner's
   *  current effective permissions. */
  scopes: readonly Scope[];
  /** Agent allowlist. `"*"` means every agent owned by `sub`. */
  agentIds: readonly string[] | "*";
  /** Set when the principal was authenticated via an API key. Procedures
   *  that manage API keys themselves MUST reject when this is set. */
  keyId?: string;
}

export interface ApiContext {
  templates: TemplatesService;
  repos: ReposService;
  agents: AgentsService;
  schedules: SchedulesService;
  channels: ChannelsService;
  connections: ConnectionsService;
  skills: SkillsService;
  approvals: ApprovalsService;
  egressRules: EgressRulesService;
  experiments: ExperimentsService;
  files: FilesService;
  terms: TermsService;
  e2e: E2eService;
  apiKeys: ApiKeysService;
  user: UserIdentity;
  e2eEnabled: boolean;
}
