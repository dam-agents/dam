import type { AgentsService } from "./modules/agents/types.js";
import type {
  AgentPermission,
  AgentTarget,
} from "./modules/agents/permissions.js";
import type { ApiKeysService, Scope } from "./modules/api-keys/types.js";
import type { ArtifactLibraryService } from "./modules/artifact-library/types.js";
import type {
  BudgetsService,
  UserBudgetsService,
} from "./modules/budgets/types.js";
import type { AttentionService } from "./modules/attention/types.js";
import type { CostReviewsService } from "./modules/cost-reviews/types.js";
import type {
  AgentChangeApprovals,
  ApprovalsService,
} from "./modules/approvals/types.js";
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
import type { AssistantsService } from "./modules/assistants/types.js";
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
import type { ProfilesService } from "./modules/profiles/types.js";
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
  /*
   * UNIT_BOUNDARY_DESCRIPTION: the assistant Agent whose own token this
   * principal acts with — the owner's identity, minus credentials:manage, and
   * with every change waiting for the owner's approval. Never a person: the
   * gates that need one (API keys, the Terms, verdicts) refuse it.
   */
  onBehalfAgentId?: string;
  isOperator?: boolean;
  email?: string;
  emailVerified?: boolean;
  actingEditor?: string;
  actingEditorEmail?: string;
}

export type AgentActing =
  | { ok: true; ctx: ApiContext }
  | { ok: false; error: "Forbidden"; message?: string };

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
  /*
   * UNIT_BOUNDARY_DESCRIPTION: where an assistant's token files a change it may
   * not make itself; the owner's verdict on Home then runs it.
   */
  agentChanges: AgentChangeApprovals;
  attention: AttentionService;
  costReviews: CostReviewsService;
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
  profiles: ProfilesService;
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
  assistants: AssistantsService;
  /* UNIT_BOUNDARY_DESCRIPTION: gives this person their assistant if the install offers one and they have accepted the Terms of Use. Called when a transport attaches, and again after a first acceptance or after the experimental switch is turned on, because neither of those re-creates the context. */
  provisionAssistant: () => Promise<void>;
  /* UNIT_BOUNDARY_DESCRIPTION: deletes this person's assistant and its data, the way any Agent delete does, when they switch the feature off for themselves; the record is forgotten so opting back in starts fresh. A person with none is a no-op. */
  removeAssistant: () => Promise<void>;
  e2eEnabled: boolean;
  featureModes: FeatureModes;
  telemetryBackend: boolean;
  actOnAgent: (
    target: AgentTarget,
    permission: AgentPermission,
    call: { path: string; mutation: boolean },
  ) => Promise<AgentActing>;
}
