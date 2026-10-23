import type { CoreV1Api } from "@kubernetes/client-node";
import type { EnvironmentGate } from "../../modules/environments/index.js";
import type { EnvironmentsServiceImpl } from "../../modules/environments/index.js";
import type { Hono, MiddlewareHandler } from "hono";
import type { Db } from "db";
import type { SatellitesComposition } from "../../modules/satellites/index.js";
import type {
  E2eService,
  HarnessCatalog,
  LiveEventsService,
  ProviderStatusService,
  ReposService,
  TermsService,
} from "api-server-api";
import type { FirePair } from "../../modules/harness-config/index.js";
import type { RedisBus } from "../../core/redis-bus.js";
import type { SpendSystem } from "../../modules/spend/index.js";
import type { UserBudgetsForOperator } from "../../modules/budgets/index.js";
import type { OutageAlertNotices } from "../../modules/outage-alerts/index.js";
import type { TtlStore } from "../../core/ttl-store.js";
import type {
  AgentCleanupHook,
  AgentsRepository,
  ContributionsProgressPort,
  OnboardingChecklistReader,
  PresetSeeder,
} from "../../modules/agents/index.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import type { AgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
import type { PublicAgentPageService } from "../../modules/agents/index.js";
import type { composeApiKeysModule } from "../../modules/api-keys/index.js";
import type { ArtifactService } from "../../modules/artifacts/services/artifact-service.js";
import type { DelegationFramesPort } from "../../modules/invocations/index.js";
import type { ArtifactLibraryFor } from "../../modules/artifact-library/index.js";
import type {
  ApprovalsRelayService,
  WrapperFrameSender,
} from "../../modules/approvals/compose.js";
import type { ChannelManager } from "../../modules/channels/services/channel-manager.js";
import type { IdentityLinkService } from "../../modules/channels/services/identity-link-service.js";
import type { SlackOAuthPending } from "../../modules/channels/infrastructure/slack.js";
import type {
  TelegramBindFlowStore,
  TelegramOAuthPending,
} from "../../modules/channels/infrastructure/telegram-flows.js";
import type { SlackBindFlowStore } from "../../modules/channels/infrastructure/slack-flows.js";
import type { SlackInstallPending } from "../../modules/channels/infrastructure/slack-install-routes.js";
import type { SlackInstallService } from "../../modules/channels/services/slack-install-service.js";
import type { ConnectionsBootCompose } from "../../modules/connections/compose.js";
import type {
  OutboxRepo,
  RuntimeMutator,
} from "../../modules/runtime-delivery/index.js";
import type { SchedulesBoot } from "../../modules/schedules/index.js";
import type { SecretStore } from "../../modules/secret-store/index.js";
import type { SkillSourceSeed } from "../../modules/skills/index.js";
import type { MetricsReader } from "../../modules/metrics/index.js";
import type { TelemetryReader } from "../../modules/telemetry/index.js";
import type { SessionDirectory } from "../../modules/session-directory/index.js";
import type { TemplatesRepository } from "../../modules/templates/infrastructure/templates-repository.js";
import type {
  KitUpstream,
  LinkedKits,
  StarterKitsRepository,
} from "../../modules/starter-kits/index.js";
import type { IsAcceptedPort } from "../../modules/terms/index.js";
import type { Config } from "../../config.js";
import type { createAuth, SurfaceAttribution } from "./admission/auth.js";
import type { startJwksWarmup } from "./admission/jwks-warmup.js";
import type { SessionPresence } from "./agent-proxies/session-presence.js";

import type { ApiVariables } from "../../core/http-context.js";
import type { AddressSets } from "../../core/address-sets.js";
import type { GettingStartedModule } from "../../modules/getting-started/index.js";
import type { SidebarOrderModule } from "../../modules/sidebar-order/index.js";
export type { ApiVariables };

export interface ApiServerDeps {
  config: Config;
  api: CoreV1Api;
  db: Db;
  channelManager: ChannelManager;
  identityLinkService: IdentityLinkService;
  pendingSlackOAuthFlows: TtlStore<SlackOAuthPending>;
  pendingTelegramOAuthFlows: TtlStore<TelegramOAuthPending>;
  pendingSlackInstalls: TtlStore<SlackInstallPending>;
  slackInstalls: SlackInstallService;
  resolveSlackWorkspace: (
    slackChannelId: string,
  ) => Promise<
    | { kind: "resolved"; teamId: string }
    | { kind: "unknown" }
    | { kind: "unreachable" }
    | { kind: "none" }
  >;
  slackInstallCallbackUrl: string;
  telegramBindFlows?: TelegramBindFlowStore;
  slackBindFlows: SlackBindFlowStore;
  seedSources: SkillSourceSeed[];
  redisBus: RedisBus;
  spendForOwner: SpendSystem["forOwner"];
  spendCeilingsForOperator: SpendSystem["ceilingsForOperator"];
  userBudgetsForOperator: UserBudgetsForOperator;
  providerStatus: ProviderStatusService;
  outageAlerts: OutageAlertNotices;
  approvalsRelay: ApprovalsRelayService;
  wrapperFrameSender: WrapperFrameSender;
  presetSeeder: PresetSeeder;
  trustedHosts: readonly string[];
  agentCleanupHooks: readonly AgentCleanupHook[];
  environmentsFor: (owner: string) => EnvironmentsServiceImpl;
  secretStore: SecretStore;
  runtimeMutator: RuntimeMutator;
  outboxRepo: OutboxRepo;
  contributionsProgress: ContributionsProgressPort;
  onboardingChecklists: OnboardingChecklistReader;
  getAgentCapabilities: (agentId: string) => Promise<unknown>;
  schedulesBoot: SchedulesBoot;
  mountTelemetryRoutes: (app: Hono<{ Variables: ApiVariables }>) => void;
  mountUsageRoutes: (app: Hono<{ Variables: ApiVariables }>) => void;
  mountCaseStudiesRoutes: (app: Hono<{ Variables: ApiVariables }>) => void;
  listRegisteredAgentIds: (rawSub: string) => Promise<string[]>;
  metricsReader: MetricsReader | null;
  telemetryReader: TelemetryReader | null;
  sessionDirectory: SessionDirectory;
  terms: TermsService;
  isTermsAccepted: IsAcceptedPort;
  e2e: E2eService;
  artifacts: ArtifactService;
  delegationFrames: DelegationFramesPort;
  liveEvents: LiveEventsService;

  k8sClient: K8sClient;
  agentStateCache: AgentStateCache;
  agentsRepo: AgentsRepository;
  connectionsBoot: ConnectionsBootCompose;
  templatesRepo: TemplatesRepository;
  harnessCatalog: HarnessCatalog;
  firePair: FirePair;
  starterKitsRepo: StarterKitsRepository;
  kitUpstream: KitUpstream;
  linkedKits: LinkedKits;
  reposService: ReposService;
  apiKeysModule: ReturnType<typeof composeApiKeysModule>;
  satellitesBoot: SatellitesComposition;
  auth: ReturnType<typeof createAuth>;
  jwksWarmup: ReturnType<typeof startJwksWarmup>;
  surfaceAttribution: SurfaceAttribution;
  slackOauthCallbackUrl: string;
  addresses: AddressSets;
  shareHostGate: MiddlewareHandler;
  environmentGate: EnvironmentGate;
  publicAgentPageService: PublicAgentPageService;
  gettingStarted: GettingStartedModule;
  sidebarOrder: SidebarOrderModule;
  sessionPresence: SessionPresence;
  wakeAgent: (agentId: string) => Promise<void>;
  artifactLibraryFor: ArtifactLibraryFor;
}
