export type { AppRouter } from "./router.js";
export type { ApiContext, UserIdentity } from "./context.js";

export { ChannelType, type EnvVar } from "./modules/shared.js";

export { liveEventSchema, type LiveEvent } from "./modules/events/schemas.js";
export type { LiveEventsService } from "./modules/events/types.js";

export { SPEC_VERSION } from "./modules/templates/types.js";
export { templateSpecSchema } from "./modules/templates/schemas.js";
export type {
  HarnessFamily,
  Template,
  TemplateSpec,
  TemplatesService,
  Resources,
} from "./modules/templates/types.js";

export { repoSchema } from "./modules/repos/schemas.js";
export type { Repo, ReposService } from "./modules/repos/types.js";

export {
  spawnInvocationRequestSchema,
  DEFAULT_INVOCATION_TTL_MS,
  MIN_INVOCATION_TTL_MS,
  MAX_INVOCATION_TTL_MS,
} from "./modules/invocations/schemas.js";
export type {
  SpawnInvocationRequest,
  SpawnInvocationResponse,
  InvocationView,
  InvocationsQueryService,
} from "./modules/invocations/types.js";

export type {
  HarnessConfigChange,
  HarnessConfigService,
  HarnessConfigSnapshot,
  HarnessConfigSnapshotPatch,
} from "./modules/harness-config/types.js";
export { harnessConfigSnapshotSchema } from "./modules/harness-config/schemas.js";

export type {
  Agent,
  WorkspaceFailure,
  WorkspaceMutationKind,
  AgentKind,
  AgentSpec,
  AgentState,
  AgentsService,
  AgentCreateInput,
  AgentUpdateInput,
  BackgroundWorkItemView,
  SessionBackgroundWork,
  TemplateUpdate,
  UpgradeAgentError,
  ConnectSlackResult,
  BindSlackChannelResult,
  BindTelegramChatResult,
  ListTelegramChatsResult,
  UnbindTelegramChatResult,
  SlackChannel,
  ChannelConfig,
} from "./modules/agents/types.js";
export {
  AGENT_ID_RE,
  agentCreateInputSchema,
  agentKindSchema,
} from "./modules/agents/schemas.js";
export { isProtectedAgentEnvName } from "./modules/agents/types.js";
export { toAgentView } from "./modules/agents/view.js";
export type {
  BudgetReserved,
  BudgetsService,
} from "./modules/budgets/types.js";
export type { AgentSpecCR } from "./crd-types.gen.js";
export type {
  EventReportInput,
  EventOutcome,
  HelloInput,
  HelloResult,
} from "agent-runtime-api";

export {
  scheduleSpecSchema,
  precheckSchema,
  PRECHECK_MAX_LENGTH,
} from "./modules/schedules/schemas.js";
export type {
  Schedule,
  ScheduleSpec,
  QuietWindow,
  ScheduleCreator,
  ScheduleCreateCronInput,
  ScheduleCreateRRuleInput,
  ScheduleUpdateRRuleInput,
  SchedulesService,
  PrecheckVerdict,
} from "./modules/schedules/types.js";
export type {
  ExperimentStatus,
  SpanStatus,
  Skeleton,
  TraceEvent,
  PlanRegisterInput,
  FinishInput,
  Experiment,
  ExperimentDriverSummary,
  ExperimentSandboxCreateInput,
  ExperimentSpan,
  TraceFeed,
  TraceFeedStage,
  TraceFeedInvocation,
  ScoreSeriesPoint,
  ExperimentsService,
} from "./modules/experiments/types.js";
export {
  planRegisterRequestSchema,
  appendEventsRequestSchema,
  finishRequestSchema,
  EXPERIMENT_SKILL_NAME,
  CUSTOM_DATA_MAX_BYTES,
  EXPERIMENT_FEED_MESSAGE_TYPE,
  EXPERIMENT_FOLDER_PREFIX,
  experimentFolderName,
} from "./modules/experiments/schemas.js";
export type {
  StarterKit,
  StarterKitApplyInput,
  ResolvedSkill,
  StarterKitApplyResult,
  StarterKitCatalogEntry,
  StarterKitConnectionRequirement,
  OnboardingStep,
  StarterKitResources,
  StarterKitSchedule,
  StarterKitScheduleOverride,
  StarterKitView,
  StarterKitsService,
  ResolvedStarterKit,
} from "./modules/starter-kits/types.js";
export {
  onboardingStepSchema,
  starterKitApplyInputSchema,
  starterKitCatalogSchema,
  starterKitScheduleOverrideSchema,
  starterKitCategorySchema,
  starterKitSchema,
} from "./modules/starter-kits/schemas.js";
export { requirementAccepts } from "./modules/starter-kits/types.js";
export { resolveKitSchedulePrecheck } from "./modules/starter-kits/types.js";
export type {
  KbShareCreateInput,
  KbShareDefaults,
  KbSharePublishState,
  KbShareRefreshInput,
  KbShareResolveInput,
  KbShareResolveResult,
  KbShareSetNameInput,
  KbShareStringResult,
  KbSharesService,
  KbShareView,
  KbShareWorkspaceListing,
} from "./modules/kb-shares/types.js";
export {
  KB_SHARE_STRING_PREFIX,
  parseKbShareString,
} from "./modules/kb-shares/schemas.js";
export type {
  ArtifactKind,
  ArtifactVisibility,
  ArtifactFolder,
  LibraryArtifact,
  ArtifactVersionInfo,
  ArtifactVersionAuthor,
  ArtifactWriteAttribution,
  ArtifactContent,
  ArtifactListFilter,
  ArtifactCreateInput,
  ArtifactUpdateInput,
  ArtifactSharingInput,
  FolderUpdateInput,
  ArtifactUploadTicket,
  ArtifactLibraryService,
  ArtifactTouch,
  ArtifactTouchService,
  ArtifactCallAgentApiInput,
  ArtifactCallAgentApiResult,
} from "./modules/artifact-library/types.js";
export {
  ARTIFACT_PROMPT_TYPE,
  ARTIFACT_PROMPT_MAX_LENGTH,
  artifactPromptSchema,
  ARTIFACT_REQUEST_TYPE,
  ARTIFACT_RESPONSE_TYPE,
  ARTIFACT_REQUEST_MAX_IN_FLIGHT,
  ARTIFACT_REQUEST_TIMEOUT_MS,
  artifactRequestEnvelopeSchema,
  artifactRequestMessageSchema,
  type ArtifactResponseMessage,
} from "./modules/artifact-library/prompt.js";
export {
  artifactKindSchema,
  artifactVisibilitySchema,
  artifactSharingInputSchema,
  viewerEmailSchema,
  ARTIFACT_TITLE_MAX_LENGTH,
  INLINE_CONTENT_MAX_BYTES,
  ARTIFACT_TOUCH_MARKER_VERSION,
  artifactTouchPayloadSchema,
  VIEWER_ALLOWLIST_MAX,
} from "./modules/artifact-library/schemas.js";
export {
  ARTIFACT_INTERNAL_LINK_PREFIX,
  ARTIFACT_RESTORE_WINDOW_DAYS,
  artifactInternalLink,
} from "./modules/artifact-library/types.js";
export type {
  FeatureId,
  FeatureFlags,
  FeaturesService,
} from "./modules/features/types.js";
export { featureIdSchema } from "./modules/features/schemas.js";
export { quietWindowSchema } from "./modules/schedules/schemas.js";
export {
  ALL_DAYS,
  buildRRule,
  detectPreset,
  detectTimezone,
  hasVisibleOccurrence,
  isInQuietHours,
  rruleToText,
} from "./modules/schedules/rrule.js";
export type { FrequencyPreset } from "./modules/schedules/rrule.js";

export type {
  ProviderPresetType,
  EnvMapping,
  BobModelPins,
} from "./modules/connections/providers.js";
export { ENV_NAME_RE, isValidEnvName } from "./modules/shared.js";
export {
  KB_AGGREGATE_MCP_SERVER,
  PLATFORM_OUTBOUND_MCP_SERVER,
  RESERVED_MCP_SERVER_NAMES,
} from "./modules/shared.js";
export {
  PROVIDERS,
  PROVIDER_PRESET_TYPES,
  ibmLitellmEnvMappings,
  openaiEnvMappings,
  bobEnvMappings,
  BOB_CHAT_MODES,
  normalizeBobChatMode,
  IBM_LITELLM_HOST,
  BOB_HOST,
  BOB_INFERENCE_PREFIX_REWRITE,
  PROVIDER_TEMPLATE_IDS,
  SHARED_KB_TEMPLATE_ID,
  providerTypeForTemplateId,
  templateIdForProvider,
} from "./modules/connections/providers.js";

export {
  connectionEgressPathPrefix,
  stripConnectionEgressPrefix,
  applyConnectionEgressAddressing,
  unaddressableRivalHost,
} from "./modules/connections/egress-addressing.js";

export type {
  CaseStudyStatus,
  CaseStudyContentSource,
  CaseStudySubmitInput,
  CaseStudyInspectionFilter,
  CaseStudyEditionSummary,
  CaseStudyEdition,
  CaseStudiesService,
} from "./modules/case-studies/types.js";
export {
  caseStudyStatusSchema,
  caseStudyContentSourceSchema,
  caseStudyContentSchema,
  caseStudySubmitInputSchema,
  caseStudyInspectionFilterSchema,
  toCaseStudyInspectionFilter,
  CASE_STUDY_CONTENT_MAX_CHARS,
} from "./modules/case-studies/schemas.js";

export {
  agentMetricsInputSchema,
  agentTelemetryInputSchema,
} from "./modules/metrics/schemas.js";
export {
  AGENT_TELEMETRY_MAX_DAYS,
  AGENT_TELEMETRY_MAX_LIMIT,
} from "./modules/metrics/constants.js";

export type {
  MetricsService,
  MetricsQuery,
  MetricsOverview,
  TokenSpendByModel,
  SpendByAgent,
  SpendByDay,
  SpendBySessionType,
  SpendCategory,
  SessionRuntime,
  CallContext,
} from "./modules/metrics/types.js";

export type {
  ClusterCaProbe,
  GitHubAppInstallationProbe,
  ConnectionsService,
  Connection,
  ConnectionStatus,
  ConnectionView,
  ConnectionTemplateView,
  TemplateInput as ConnectionTemplateInput,
  ConnectionCategory,
  AgentConnections,
  AuthConfig as ConnectionAuthConfig,
  AuthKind as ConnectionAuthKind,
} from "./modules/connections/types.js";
export { authConfig as connectionAuthConfigSchema } from "./modules/connections/types.js";
export { connectionNameSchema } from "./modules/connections/schemas.js";
export type { ConnectionCreateInput } from "./modules/connections/schemas.js";

export {
  SessionType,
  SessionMode,
  SESSION_CATEGORIES,
  sessionCategoryOf,
  sessionModeSchema,
  ambientThreadKey,
  isAmbientThreadKey,
  slackChannelIdFromThreadKey,
  slackThreadKey,
} from "./modules/sessions/types.js";
export type {
  AttentionDismissal,
  AttentionItem,
  AttentionList,
  AttentionService,
  DismissedEntry,
} from "./modules/attention/types.js";
export type { SessionCategory, SessionView } from "./modules/sessions/types.js";
export type { SessionDirectoryService } from "./modules/session-directory/types.js";

export {
  OP_INPUT,
  OP_OUTPUT,
  OP_RESIZE,
  OP_EXIT,
  encodeDataFrame,
  encodeResize,
  encodeExit,
  decodeFrame,
} from "./modules/terminal/protocol.js";

export type {
  LocalSkill,
  ScanFailure,
  ScanFailureCode,
  Skill,
  SkillCreateLocalInput,
  SkillCreateSourceInput,
  SkillDeleteLocalInput,
  SkillInstallInput,
  SkillLocalFiles,
  SkillPublishInput,
  SkillPublishRecord,
  SkillPublishResult,
  SkillReadLocalInput,
  SkillRef,
  SkillApplyBatchInput,
  SkillSet,
  SkillSetApplyResult,
  SkillSetEntry,
  SkillSetSkipReason,
  SkillSource,
  SkillsService,
  SkillsState,
  SkillUninstallInput,
} from "./modules/skills/types.js";
export {
  INVALID_GIT_URL_MESSAGE,
  localSkillSchema,
  MAX_SKILL_BATCH_ENTRIES,
  scanFailureSchema,
  skillCreateSourceFieldsSchema,
  skillCreateSourceInputSchema,
  skillKey,
  skillSetEntrySchema,
  skillSetNameSchema,
  skillSourcePathSchema,
} from "./modules/skills/schemas.js";
export type { PlatformFeatureId } from "./modules/skills/platform-skills.js";
export {
  platformSkillFeature,
  platformSkillsForFeature,
} from "./modules/skills/platform-skills.js";

export type { FilesService } from "./modules/files/router.js";

export type {
  ApprovalType,
  ApprovalStatus,
  ApprovalVerdict,
  ApprovalPayload,
  AcpPermissionOption,
  AcpPermissionOptionKind,
  ApprovalView,
  ApprovalsService,
  ApprovalListOptions,
  ApprovalActionOutcome,
} from "./modules/approvals/types.js";
export { describeApprovalPayload } from "./modules/approvals/format.js";
export { acpNativeRowId } from "./modules/approvals/format.js";

export type {
  RuleVerdict,
  EgressRuleSource,
  EgressPreset,
  EgressRuleView,
  EgressRuleCreateInput,
  EgressRuleUpdateInput,
  EgressRulesService,
} from "./modules/egress-rules/types.js";
export { egressRuleCreateInputSchema } from "./modules/egress-rules/schemas.js";
export {
  formatEgressRuleInline,
  formatEgressRuleSource,
} from "./modules/egress-rules/format.js";
export type {
  GatewayRestartImpact,
  PromotionRule,
} from "./modules/egress-rules/promotion.js";
export {
  gatewayRestartImpact,
  promotedHosts,
} from "./modules/egress-rules/promotion.js";

export {
  platformTurnEndedParamsSchema,
  buildPlatformTurnEndedNotification,
  platformPromptAcceptedParamsSchema,
  buildPlatformPromptAcceptedNotification,
  platformPromptStartedParamsSchema,
  buildPlatformPromptStartedNotification,
  platformRunStartsMetaSchema,
  platformRunStartedParamsSchema,
  buildPlatformRunStartedNotification,
  platformRunResultSchema,
  platformRunResultResponseSchema,
  platformClippedReplayMetaSchema,
  platformFrameMetaSchema,
  platformReplayTurnMetaSchema,
  promptBlockSchema,
  platformUndeliveredPromptSchema,
  platformUndeliveredMetaSchema,
  platformSupersededMetaSchema,
  capInlineImages,
  PROMPT_QUEUE_FULL_CODE,
  PROMPT_QUEUE_FULL_MESSAGE,
} from "./modules/acp/types.js";
export type {
  PlatformTurnEndedParams,
  PlatformPromptAcceptedParams,
  PlatformPromptStartedParams,
  PlatformRunStartedParams,
  PlatformRunResult,
  PlatformReplayTurnMeta,
  PlatformUndeliveredPrompt,
  PromptBlock,
} from "./modules/acp/types.js";

export { brandSchema } from "./modules/brand/types.js";
export type { Brand } from "./modules/brand/types.js";

export { linksSchema } from "./modules/links/types.js";

export { publicAgentResponseSchema } from "./modules/agents/public-agent.js";
export type {
  PublicAgentView,
  PublicAgentResponse,
} from "./modules/agents/public-agent.js";

export type {
  TermsCurrent,
  TermsDocument,
  StaleAcceptance,
  AcceptedAcceptance,
  TermsService,
} from "./modules/terms/types.js";
export { termsDocumentSchema } from "./modules/terms/schemas.js";
export { PRE_TERMS_PROCEDURES } from "./modules/terms/types.js";

export type { EntryPointChoice, UsageService } from "./modules/usage/types.js";

export { authConfigSchema } from "./modules/auth/types.js";
export type { AuthConfig } from "./modules/auth/types.js";

export type {
  E2eService,
  SlackFireCommandInput,
  SlackFireMentionInput,
  SlackFireMessageInput,
  SlackOutboundRecord,
} from "./modules/e2e/types.js";

export type { SecretRef } from "./modules/secret-store/types.js";

export type { HarnessRouter } from "./harness-router.js";
export type { HarnessContext } from "./harness-context.js";
export type { RuntimeDeliveryService } from "./modules/runtime/types.js";
export { contribution } from "agent-runtime-api";
export type {
  Contribution,
  ContributionKind,
  Event as RuntimeEvent,
  EventKind as RuntimeEventKind,
  ApplyStateInput,
  ApplyStateResult,
  DriverFailure,
} from "agent-runtime-api";

export {
  AGENT_SCOPES,
  ALL_SCOPES,
  SATELLITE_SCOPES,
  API_KEY_PREFIX,
  CREDENTIAL_SCOPES,
} from "./modules/api-keys/types.js";
export type {
  ApiKeyCreateInput,
  ApiKeyCreateResult,
  ApiKeyView,
  ApiKeysService,
  Scope,
} from "./modules/api-keys/types.js";
export { scopeSchema } from "./modules/api-keys/schemas.js";
export {
  contentHashSchema,
  type KbPublishCompleteReport,
  type KbPublishCompleteResult,
  type KbPublishGate,
  type KbPublishInventoryFile,
  type KbPublishRequestInput,
  type KbPublishRequestResult,
  type KbPublishWorkOrder,
} from "./modules/kb-publish/harness.js";

export { telemetryExportQuerySchema } from "./modules/telemetry/schemas.js";
export {
  TELEMETRY_MAX_SINCE_HOURS,
  TELEMETRY_DEFAULT_SINCE_HOURS,
  TELEMETRY_EXPORT_MAX_ROWS,
} from "./modules/telemetry/constants.js";
export type {
  TelemetryService,
  TelemetryTurnsQuery,
  TelemetryTurnQuery,
  TelemetryLogsQuery,
  TelemetryExportSignal,
  TurnSummary,
  TurnGrouping,
  TurnDetail,
  TelemetrySpan,
  TelemetryLog,
  LogAttachment,
  TelemetryTurnsResult,
  TelemetryTurnResult,
  TelemetryLogsResult,
} from "./modules/telemetry/types.js";

export {
  DEFAULT_MAX_CONCURRENT,
  INLINE_OUTPUT_LIMIT,
  MAX_JOB_OUTPUT_BYTES,
  formatJobRef,
  satelliteNameSchema,
  RESERVED_TOOL_NAMES,
  satelliteToolNameSchema,
  satelliteToolSchema,
  toolArgsSchema,
} from "./modules/satellites/schemas.js";
export type {
  ClaimInput,
  HeartbeatInput,
  JobOutcome,
  JobStarted,
  JobStatus,
  JobView,
  ReportInput,
  SatelliteManifest,
  SatelliteTool,
  SatelliteView,
  SatellitesService,
  WorkItem,
} from "./modules/satellites/types.js";
