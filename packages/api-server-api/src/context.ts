import type { AgentsService } from "./modules/agents/types.js";
import type { ApiKeysService, Scope } from "./modules/api-keys/types.js";
import type { ArtifactLibraryService } from "./modules/artifact-library/types.js";
import type {
  BudgetsService,
  UserBudgetsService,
} from "./modules/budgets/types.js";
import type { AttentionService } from "./modules/attention/types.js";
import type { ApprovalsService } from "./modules/approvals/types.js";
import type {
  SatellitesService,
  SatelliteWorkerOps,
} from "./modules/satellites/types.js";
import type { CaseStudiesService } from "./modules/case-studies/types.js";
import type { ChannelsService } from "./modules/channels/types.js";
import type { ChatFormPreferencesService } from "./modules/chat-forms/preferences.js";
import type {
  ConnectionsService,
  SecretRequestsService,
} from "./modules/connections/types.js";
import type { E2eService } from "./modules/e2e/types.js";
import type {
  FeatureModes,
  FeaturesService,
} from "./modules/features/types.js";
import type { EgressRulesService } from "./modules/egress-rules/types.js";
import type { EnvironmentsService } from "./modules/environments/types.js";
import type { LiveEventsService } from "./modules/events/types.js";
import type { ProviderStatusService } from "./modules/provider-status/types.js";
import type {
  InvocationsControlService,
  InvocationsQueryService,
} from "./modules/invocations/types.js";
import type { KbSharesService } from "./modules/kb-shares/types.js";
import type { Links } from "./modules/links/types.js";
import type { FilesService } from "./modules/files/router.js";
import type { GettingStartedService } from "./modules/getting-started/types.js";
import type { HarnessConfigService } from "./modules/harness-config/types.js";
import type { SchedulesService } from "./modules/schedules/types.js";
import type { SidebarOrderService } from "./modules/sidebar-order/types.js";
import type { SkillsService } from "./modules/skills/types.js";
import type {
  SpendCeilingsService,
  SpendService,
} from "./modules/spend/types.js";
import type { StarterKitsService } from "./modules/starter-kits/types.js";
import type { ReposService } from "./modules/repos/types.js";
import type { MetricsService } from "./modules/metrics/types.js";
import type { TelemetryService } from "./modules/telemetry/types.js";
import type {
  HarnessCatalog,
  TemplatesService,
} from "./modules/templates/types.js";
import type { TermsService } from "./modules/terms/types.js";
import type { UsageService } from "./modules/usage/types.js";

export interface UserIdentity {
  sub: string;
  preferredUsername: string;
  scopes: readonly Scope[];
  agentIds: readonly string[] | "*";
  keyId?: string;
  isOperator?: boolean;
}

export interface ApiContext {
  templates: TemplatesService;
  harnesses: HarnessCatalog;
  repos: ReposService;
  agents: AgentsService;
  schedules: SchedulesService;
  channels: ChannelsService;
  connections: ConnectionsService;
  secretRequests: SecretRequestsService;
  skills: SkillsService;
  approvals: ApprovalsService;
  attention: AttentionService;
  egressRules: EgressRulesService;
  invocationsQuery: InvocationsQueryService;
  invocationsControl: InvocationsControlService;
  environments: EnvironmentsService;
  starterKits: StarterKitsService;
  kbShares: KbSharesService;
  artifactLibrary: ArtifactLibraryService;
  caseStudies: CaseStudiesService;
  features: FeaturesService;
  chatFormPreferences: ChatFormPreferencesService;
  gettingStarted: GettingStartedService;
  sidebarOrder: SidebarOrderService;
  files: FilesService;
  harnessConfig: HarnessConfigService;
  links: Links;
  liveEvents: LiveEventsService;
  metrics: MetricsService;
  telemetry: TelemetryService;
  terms: TermsService;
  usage: UsageService;
  e2e: E2eService;
  apiKeys: ApiKeysService;
  satellites: SatellitesService;
  satelliteWorker: SatelliteWorkerOps;
  budgets: BudgetsService;
  userBudgets: UserBudgetsService;
  spend: SpendService;
  spendCeilings: SpendCeilingsService;
  providerStatus: ProviderStatusService;
  user: UserIdentity;
  e2eEnabled: boolean;
  featureModes: FeatureModes;
  telemetryBackend: boolean;
}
