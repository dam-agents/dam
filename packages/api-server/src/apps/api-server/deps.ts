import type { CoreV1Api } from "@kubernetes/client-node";
import type { Hono, MiddlewareHandler } from "hono";
import type { Db } from "db";
import type { Redis } from "ioredis";
import type {
  E2eService,
  ReposService,
  TermsService,
  UserIdentity,
} from "api-server-api";
import type { PeriodicJobs } from "../../core/periodic-jobs.js";
import type { RedisBus } from "../../core/redis-bus.js";
import type { TtlStore } from "../../core/ttl-store.js";
import type {
  AgentsRepository,
  ContributionsSettledPort,
  KeycloakUserDirectory,
} from "../../modules/agents/index.js";
import type { K8sClient } from "../../modules/agents/infrastructure/k8s.js";
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

/** The single assembled dependency object the api-server app runs on. Built
 *  once by `bootstrap()` (the sole composition root) and consumed by
 *  `startApiServerApp`; every field is a live singleton, never a raw handle
 *  the app rebuilds. */
export interface ApiServerDeps {
  config: Config;
  /** Shared BullMQ periodic-job scheduler (one execution per period across
   *  replicas). */
  periodicJobs: PeriodicJobs;
  /** Dedicated Redis client for cross-replica shared state (session
   *  presence, OAuth/bind handoff stores). */
  sharedRedis: Redis;
  api: CoreV1Api;
  db: Db;
  channelManager: ChannelManager;
  identityLinkService: IdentityLinkService;
  pendingSlackOAuthFlows: TtlStore<SlackOAuthPending>;
  pendingTelegramOAuthFlows: TtlStore<TelegramOAuthPending>;
  /** Present when Telegram is enabled; backs the chat→agent bind handoff. */
  telegramBindFlows?: TelegramBindFlowStore;
  /** Backs the Slack in-chat bind handoff (OAuth callback → agent picker). */
  slackBindFlows: SlackBindFlowStore;
  seedSources: SkillSourceSeed[];
  redisBus: RedisBus;
  approvalsRelay: ApprovalsRelayService;
  wrapperFrameSender: WrapperFrameSender;
  presetSeeder: PresetSeeder;
  trustedHosts: readonly string[];
  /** Hooks fired after a successful agent K8s delete; each clears its
   *  module's per-agent durable state. */
  agentCleanupHooks: readonly AgentCleanupHook[];
  secretStores: SecretStoreRegistry;
  runtimeMutator: RuntimeMutator;
  contributionsSettled: ContributionsSettledPort;
  /** Reads an agent's advertised runtime capabilities (owned by runtime-delivery). */
  getAgentCapabilities: (agentId: string) => Promise<unknown>;
  schedulesBoot: SchedulesBoot;
  mountUsageRoutes: (
    app: Hono<{ Variables: { user: UserIdentity; roles: string[] } }>,
  ) => void;
  /** Agent ids ever registered to an owner (Postgres registry, soft-deleted
   *  included) — keeps deleted agents' spend attributable. */
  listRegisteredAgentIds: (rawSub: string) => Promise<string[]>;
  /** ClickHouse-backed agent-metrics reader; `null` when the telemetry
   *  backend is disabled (the metrics API then fails closed). */
  metricsReader: MetricsReader | null;
  terms: TermsService;
  isTermsAccepted: IsAcceptedPort;
  e2e: E2eService;
  /** Owner-agnostic; consumers owner-scope each read themselves. */
  artifacts: ArtifactService;

  // ── App singletons (built in bootstrap, consumed across the app) ──
  k8sClient: K8sClient;
  agentsRepo: AgentsRepository;
  connectionsBoot: ConnectionsBootCompose;
  templatesRepo: TemplatesRepository;
  reposService: ReposService;
  userDirectory: KeycloakUserDirectory;
  apiKeysModule: ReturnType<typeof composeApiKeysModule>;
  auth: ReturnType<typeof createAuth>;
  jwksWarmup: ReturnType<typeof startJwksWarmup>;
  /** azp→surface mapping constants for the UserAuthenticated emission sites. */
  surfaceAttribution: SurfaceAttribution;
  slackOauthCallbackUrl: string;
  /** Hono middleware: routes the share host to the viewer app, before auth. */
  shareHostGate: MiddlewareHandler;
  sessionPresence: SessionPresence;
}
