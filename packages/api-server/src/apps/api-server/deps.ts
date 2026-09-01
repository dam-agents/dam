import type { CoreV1Api } from "@kubernetes/client-node";
import type { Hono, MiddlewareHandler } from "hono";
import type { Db } from "db";
import type { Redis } from "ioredis";
import type {
  E2eService,
  LiveEventsService,
  PodSessionsService,
  ReposService,
  TermsService,
  UserIdentity,
} from "api-server-api";
import type { PeriodicJobs } from "../../core/periodic-jobs.js";
import type { RedisBus } from "../../core/redis-bus.js";
import type { TtlStore } from "../../core/ttl-store.js";
import type {
  AgentsRepository,
  ContributionsProgressPort,
  KeycloakUserDirectory,
} from "../../modules/agents/index.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
import type { AgentStateCache } from "../../modules/agents/infrastructure/agent-state-cache.js";
import type { PublicAgentPageService } from "../../modules/agents/index.js";
import type {
  AgentCleanupHook,
  PresetSeeder,
} from "../../modules/agents/compose.js";
import type { composeApiKeysModule } from "../../modules/api-keys/index.js";
import type { ArtifactService } from "../../modules/artifacts/services/artifact-service.js";
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
import type { ConnectionsBootCompose } from "../../modules/connections/compose.js";
import type { RuntimeMutator } from "../../modules/runtime-delivery/index.js";
import type { SchedulesBoot } from "../../modules/schedules/index.js";
import type { SecretStoreRegistry } from "../../modules/secret-store/index.js";
import type { SkillSourceSeed } from "../../modules/skills/index.js";
import type { MetricsReader } from "../../modules/metrics/index.js";
import type { TemplatesRepository } from "../../modules/templates/infrastructure/templates-repository.js";
import type { IsAcceptedPort } from "../../modules/terms/index.js";
import type { Config } from "../../config.js";
import type {
  createAuth,
  startJwksWarmup,
  SurfaceAttribution,
} from "./admission/index.js";
import type { SessionPresence } from "./agent-proxies/index.js";

import type { ApiVariables } from "../../core/http-context.js";
export type { ApiVariables };

export interface ApiServerDeps {
  config: Config;
  periodicJobs: PeriodicJobs;
  sharedRedis: Redis;
  api: CoreV1Api;
  db: Db;
  channelManager: ChannelManager;
  identityLinkService: IdentityLinkService;
  pendingSlackOAuthFlows: TtlStore<SlackOAuthPending>;
  pendingTelegramOAuthFlows: TtlStore<TelegramOAuthPending>;
  telegramBindFlows?: TelegramBindFlowStore;
  slackBindFlows: SlackBindFlowStore;
  seedSources: SkillSourceSeed[];
  redisBus: RedisBus;
  approvalsRelay: ApprovalsRelayService;
  wrapperFrameSender: WrapperFrameSender;
  presetSeeder: PresetSeeder;
  trustedHosts: readonly string[];
  agentCleanupHooks: readonly AgentCleanupHook[];
  secretStores: SecretStoreRegistry;
  runtimeMutator: RuntimeMutator;
  contributionsProgress: ContributionsProgressPort;
  getAgentCapabilities: (agentId: string) => Promise<unknown>;
  schedulesBoot: SchedulesBoot;
  mountUsageRoutes: (app: Hono<{ Variables: ApiVariables }>) => void;
  listRegisteredAgentIds: (rawSub: string) => Promise<string[]>;
  metricsReader: MetricsReader | null;
  terms: TermsService;
  isTermsAccepted: IsAcceptedPort;
  e2e: E2eService;
  artifacts: ArtifactService;
  liveEvents: LiveEventsService;
  podSessions: PodSessionsService;

  k8sClient: K8sClient;
  agentStateCache: AgentStateCache;
  agentsRepo: AgentsRepository;
  connectionsBoot: ConnectionsBootCompose;
  templatesRepo: TemplatesRepository;
  reposService: ReposService;
  userDirectory: KeycloakUserDirectory;
  apiKeysModule: ReturnType<typeof composeApiKeysModule>;
  auth: ReturnType<typeof createAuth>;
  jwksWarmup: ReturnType<typeof startJwksWarmup>;
  surfaceAttribution: SurfaceAttribution;
  slackOauthCallbackUrl: string;
  shareHostGate: MiddlewareHandler;
  publicAgentPageService: PublicAgentPageService;
  sessionPresence: SessionPresence;
}
