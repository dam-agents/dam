import type { AgentsService } from "./modules/agents/types.js";
import type { ApiKeysService, Scope } from "./modules/api-keys/types.js";
import type { ArtifactLibraryService } from "./modules/artifact-library/types.js";
import type { BudgetsService } from "./modules/budgets/types.js";
import type { ApprovalsService } from "./modules/approvals/types.js";
import type { CaseStudiesService } from "./modules/case-studies/types.js";
import type { ChannelsService } from "./modules/channels/types.js";
import type { ConnectionsService } from "./modules/connections/types.js";
import type { E2eService } from "./modules/e2e/types.js";
import type { FeaturesService } from "./modules/features/types.js";
import type { EgressRulesService } from "./modules/egress-rules/types.js";
import type {
  LiveEventsService,
  PodSessionsService,
} from "./modules/events/types.js";
import type { ExperimentsService } from "./modules/experiments/types.js";
import type { InvocationsQueryService } from "./modules/invocations/types.js";
import type { KbSharesService } from "./modules/kb-shares/types.js";
import type { KnowledgeBasesService } from "./modules/knowledge-bases/types.js";
import type { Links } from "./modules/links/types.js";
import type { FilesService } from "./modules/files/router.js";
import type { HarnessConfigService } from "./modules/harness-config/types.js";
import type { SchedulesService } from "./modules/schedules/types.js";
import type { SkillsService } from "./modules/skills/types.js";
import type { ReposService } from "./modules/repos/types.js";
import type { MetricsService } from "./modules/metrics/types.js";
import type { TemplatesService } from "./modules/templates/types.js";
import type { TermsService } from "./modules/terms/types.js";
import type { UsageService } from "./modules/usage/types.js";

export interface UserIdentity {
  sub: string;
  preferredUsername: string;
  scopes: readonly Scope[];
  agentIds: readonly string[] | "*";
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
  invocationsQuery: InvocationsQueryService;
  knowledgeBases: KnowledgeBasesService;
  kbShares: KbSharesService;
  artifactLibrary: ArtifactLibraryService;
  caseStudies: CaseStudiesService;
  features: FeaturesService;
  files: FilesService;
  harnessConfig: HarnessConfigService;
  links: Links;
  liveEvents: LiveEventsService;
  podSessions: PodSessionsService;
  metrics: MetricsService;
  terms: TermsService;
  usage: UsageService;
  e2e: E2eService;
  apiKeys: ApiKeysService;
  budgets: BudgetsService;
  user: UserIdentity;
  e2eEnabled: boolean;
}
