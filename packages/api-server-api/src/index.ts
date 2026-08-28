export type { AppRouter } from "./router.js";
export type { ApiContext, UserIdentity } from "./context.js";

export { ChannelType, envVarSchema, type EnvVar } from "./modules/shared.js";

export { liveEventSchema, type LiveEvent } from "./modules/events/schemas.js";
export type { LiveEventsService } from "./modules/events/types.js";

export { SPEC_VERSION } from "./modules/templates/types.js";
export {
  mountSchema,
  resourcesSchema,
  skillSourceSeedSchema,
  templateSpecSchema,
} from "./modules/templates/schemas.js";
export type {
  Template,
  TemplateSpec,
  TemplatesService,
  Mount,
  Resources,
  SkillSourceSeed,
} from "./modules/templates/types.js";
export { templateGetInputSchema } from "./modules/templates/schemas.js";

export { repoSchema } from "./modules/repos/schemas.js";
export type { Repo, RepoView, ReposService } from "./modules/repos/types.js";

export {
  spawnInvocationRequestSchema,
  spawnInvocationResponseSchema,
  invocationViewSchema,
  DEFAULT_INVOCATION_TTL_MS,
  MIN_INVOCATION_TTL_MS,
  MAX_INVOCATION_TTL_MS,
} from "./modules/invocations/schemas.js";
export type {
  SpawnInvocationRequest,
  SpawnInvocationResponse,
  InvocationView,
  InvocationStatus,
  InvocationTarget,
  InvocationsQueryService,
} from "./modules/invocations/types.js";

export type {
  HarnessConfigChange,
  HarnessConfigStatus,
  HarnessConfigService,
  HarnessConfigSnapshot,
  HarnessConfigSnapshotPatch,
  HarnessConfigSnapshotResult,
} from "./modules/harness-config/types.js";
export {
  agentConfigOptionsSchema,
  harnessConfigApplyInputSchema,
  harnessConfigSnapshotSchema,
} from "./modules/harness-config/schemas.js";

export type {
  Agent,
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
  UpgradeAgentResult,
  ConnectSlackError,
  ConnectSlackResult,
  BindSlackChannelError,
  BindSlackChannelResult,
  BindTelegramChatError,
  BindTelegramChatResult,
  ListTelegramChatsError,
  TelegramChatView,
  ListTelegramChatsResult,
  UnbindTelegramChatError,
  UnbindTelegramChatResult,
  Channel,
  SlackChannel,
  ChannelConfig,
} from "./modules/agents/types.js";
export {
  agentBackgroundWorkInputSchema,
  agentBindSlackChannelInputSchema,
  agentBindTelegramChatInputSchema,
  agentListTelegramChatsInputSchema,
  agentUnbindTelegramChatInputSchema,
  agentConnectSlackInputSchema,
  agentCreateInputSchema,
  agentKindSchema,
  agentDeleteInputSchema,
  agentDisconnectSlackInputSchema,
  agentGetInputSchema,
  agentRestartInputSchema,
  agentUpdateInputSchema,
  agentPauseInputSchema,
  agentStopInputSchema,
  agentUpgradeInputSchema,
  agentWakeInputSchema,
} from "./modules/agents/schemas.js";
export {
  PROTECTED_AGENT_ENV_NAMES,
  isProtectedAgentEnvName,
} from "./modules/agents/types.js";
export type {
  BudgetReserved,
  BudgetsService,
} from "./modules/budgets/types.js";
export type { AgentSpecCR } from "./crd-types.gen.js";

export {
  scheduleSpecSchema,
  scheduleStatusSchema,
  scheduleResetSessionInputSchema,
} from "./modules/schedules/schemas.js";
export type {
  Schedule,
  ScheduleSpec,
  ScheduleSpecCron,
  ScheduleSpecRRule,
  ScheduleStatus,
  QuietWindow,
  ScheduleCreator,
  ScheduleCreateCronInput,
  ScheduleCreateRRuleInput,
  ScheduleUpdateRRuleInput,
  SchedulesService,
} from "./modules/schedules/types.js";
export type {
  ExperimentStatus,
  SpanStatus,
  Skeleton,
  TraceEvent,
  PlanRegisterInput,
  FinishInput,
  AppendEventsInput,
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
  skeletonSchema,
  traceEventSchema,
  planRegisterRequestSchema,
  planRegisterResponseSchema,
  appendEventsRequestSchema,
  appendEventsResponseSchema,
  finishRequestSchema,
  experimentIdInputSchema,
  experimentSandboxCreateInputSchema,
  EXPERIMENT_SKILL_NAME,
  SCRIPT_CONTENT_MAX_BYTES,
  DASHBOARD_CONTENT_MAX_BYTES,
  CUSTOM_DATA_MAX_BYTES,
  EXPERIMENT_FEED_MESSAGE_TYPE,
  EXPERIMENT_FOLDER_PREFIX,
  experimentFolderName,
} from "./modules/experiments/schemas.js";
export type {
  KnowledgeBaseCreateInput,
  KnowledgeBaseTemplateId,
  KnowledgeBasesService,
} from "./modules/knowledge-bases/types.js";
export {
  knowledgeBaseCreateInputSchema,
  knowledgeBaseTemplateIdSchema,
} from "./modules/knowledge-bases/schemas.js";
export type {
  ArtifactKind,
  ArtifactVisibility,
  ArtifactFolder,
  LibraryArtifact,
  ArtifactVersionInfo,
  ArtifactContent,
  ArtifactListFilter,
  ArtifactCreateInput,
  ArtifactUpdateInput,
  ArtifactSharingInput,
  FolderUpdateInput,
  ArtifactUploadTicket,
  ArtifactLibraryService,
  ArtifactRequest,
  ArtifactRequestCreateInput,
  ArtifactRequestFailureReason,
  ArtifactRequestReceipt,
  ArtifactRequestState,
  ArtifactRequestTrigger,
  ArtifactRequestsService,
  ArtifactRequestProgress,
  ArtifactBridgeReply,
  PageArtifactRequest,
} from "./modules/artifact-library/types.js";
export {
  artifactKindSchema,
  artifactVisibilitySchema,
  ARTIFACT_TITLE_MAX_LENGTH,
  ARTIFACT_BRIEF_MAX_BYTES,
  ARTIFACT_BRIEF_TOO_BIG_MESSAGE,
  briefFitsCap,
  INLINE_CONTENT_MAX_BYTES,
  ARTIFACT_REQUEST_ACTION_MAX_LENGTH,
  ARTIFACT_REQUEST_PAYLOAD_MAX_BYTES,
  artifactRequestFailureReasonSchema,
  artifactRequestRefusalSchema,
  artifactRequestStateSchema,
  artifactRequestTriggerSchema,
  artifactRequestProgressSchema,
  pageArtifactRequestSchema,
  ARTIFACT_BRIDGE_CONNECT_TYPE,
  ARTIFACT_BRIDGE_REQUEST_TYPE,
  ARTIFACT_BRIDGE_STATE_TYPE,
  ARTIFACT_BRIDGE_ANSWER_TYPE,
  ARTIFACT_BRIDGE_FAILED_TYPE,
  ARTIFACT_BRIDGE_REF_MAX_LENGTH,
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
export {
  quietWindowSchema,
  scheduleCreateCronInputSchema,
  scheduleCreateRRuleInputSchema,
  scheduleDeleteInputSchema,
  scheduleGetInputSchema,
  scheduleListInputSchema,
  scheduleToggleInputSchema,
  scheduleUpdateRRuleInputSchema,
} from "./modules/schedules/schemas.js";
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
  ProviderPreset,
  ProviderPresetMode,
  ProviderPresetType,
  EnvMapping,
  InjectionConfig,
  BobModelPins,
} from "./modules/connections/providers.js";
export { ENV_NAME_RE, isValidEnvName } from "./modules/shared.js";
export {
  DEFAULT_ENV_PLACEHOLDER,
  PROVIDERS,
  PROVIDER_PRESET_TYPES,
  isProviderPresetType,
  ibmLitellmEnvMappings,
  openaiEnvMappings,
  bobEnvMappings,
  bobPinsFromEnvMappings,
  BOB_CHAT_MODES,
  normalizeBobChatMode,
  IBM_LITELLM_HOST,
  BOB_HOST,
  PROVIDER_TEMPLATE_IDS,
  providerTypeForTemplateId,
  templateIdForProvider,
} from "./modules/connections/providers.js";

export type { ChannelsService } from "./modules/channels/types.js";

export type {
  MetricsService,
  MetricsQuery,
  MetricsSpendQuery,
  MetricsSpendBreakdownQuery,
  MetricsOverview,
  SpendBreakdown,
  TokenSpendByModel,
  SpendByAgent,
  SpendByDay,
  SessionRuntime,
  CallContext,
} from "./modules/metrics/types.js";

export type {
  AgentAppConnections,
  AppConnectionStatus,
  AppConnectionView,
  ClusterCaProbe,
  GitHubAppInstallationProbe,
  ConnectionsService,
  Connection,
  ConnectionStatus,
  ConnectionView,
  ConnectionTemplateView,
  TemplateInput as ConnectionTemplateInput,
  TemplateInputState as ConnectionTemplateInputState,
  ConnectionCategory,
  AgentConnections,
  AuthConfig as ConnectionAuthConfig,
  AuthKind as ConnectionAuthKind,
} from "./modules/connections/types.js";
export {
  authConfig as connectionAuthConfigSchema,
  authKind as connectionAuthKindSchema,
  connection as connectionWireSchema,
  connectionView as connectionViewSchema,
  connectionTemplateView as connectionTemplateViewSchema,
  connectionStatus as connectionStatusSchema,
  connectionCategory as connectionCategorySchema,
} from "./modules/connections/types.js";
export {
  connectionCreateInputSchema,
  connectionDiscoverMcpInputSchema,
  connectionProbeClusterCaInputSchema,
  connectionGetAgentConnectionsInputSchema,
  connectionNameSchema,
  connectionSetAgentConnectionsInputSchema,
  connectionUpdateInputSchema,
} from "./modules/connections/schemas.js";
export type {
  ConnectionCreateInput,
  ConnectionUpdateInput,
} from "./modules/connections/schemas.js";

export {
  SessionType,
  SessionMode,
  sessionModeSchema,
  AMBIENT_THREAD_KEY_PREFIX,
  ambientThreadKey,
  isAmbientThreadKey,
  slackThreadKey,
} from "./modules/sessions/types.js";
export type { SessionView } from "./modules/sessions/types.js";

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
export type { TerminalFrame } from "./modules/terminal/protocol.js";

export {
  FileFragmentSchema,
  FileSpecSchema,
  MergeModeSchema,
  PodFilesEventSchema,
  EventKindSchema,
} from "./modules/pod-files/types.js";
export type {
  FileFragment,
  FileSpec,
  MergeMode,
  PodFilesEvent,
  EventKind,
} from "./modules/pod-files/types.js";

export type {
  LocalSkill,
  ScanFailure,
  ScanFailureCode,
  Skill,
  SkillCreateLocalInput,
  SkillCreateSourceInput,
  SkillDeleteLocalInput,
  SkillInstallInput,
  SkillListResult,
  SkillLocalFiles,
  SkillOrigin,
  SkillPublishInput,
  SkillPublishRecord,
  SkillPublishResult,
  SkillReadLocalInput,
  SkillRef,
  SkillApplyBatchInput,
  SkillSet,
  SkillSetApplyInput,
  SkillSetApplyResult,
  SkillSetCreateInput,
  SkillSetDeleteInput,
  SkillSetEntry,
  SkillSetSkipReason,
  SkillSource,
  SkillsService,
  SkillsState,
  SkillUninstallInput,
} from "./modules/skills/types.js";
export {
  localSkillSchema,
  MAX_SKILL_BATCH_ENTRIES,
  scanFailureSchema,
  skillCreateSourceInputSchema,
  skillDeleteSourceInputSchema,
  skillInstallInputSchema,
  skillKey,
  skillListInputSchema,
  skillListLocalInputSchema,
  skillListResultSchema,
  skillListSourcesInputSchema,
  skillPublishInputSchema,
  skillPublishRecordSchema,
  skillPublishResultSchema,
  skillRefSchema,
  skillRefreshSourceInputSchema,
  skillSchema,
  skillApplyBatchInputSchema,
  skillSetApplyInputSchema,
  skillSetApplyResultSchema,
  skillSetCreateInputSchema,
  skillSetDeleteInputSchema,
  skillSetEntrySchema,
  skillSetNameSchema,
  skillSetSchema,
  skillSetSkipReasonSchema,
  skillSourcePathSchema,
  skillSourceSchema,
  skillStateInputSchema,
  skillStateOutputSchema,
  skillUninstallInputSchema,
} from "./modules/skills/schemas.js";

export type {
  FilesService,
  UploadFileInput,
  UploadFileResult,
} from "./modules/files/router.js";

export type {
  ApprovalType,
  ApprovalStatus,
  ApprovalVerdict,
  ApprovalPayload,
  ExtAuthzPayload,
  AcpNativePayload,
  AcpPermissionOption,
  AcpPermissionOptionKind,
  ApprovalView,
  ApprovalsService,
  ApprovalListOptions,
  ApprovalActionOutcome,
} from "./modules/approvals/types.js";
export {
  approvalActionOutcomeSchema,
  approvalActionRuleSchema,
  approvalApproveHostInputSchema,
  approvalApproveOnceInputSchema,
  approvalApprovePermanentInputSchema,
  approvalDenyForeverInputSchema,
  approvalDismissInputSchema,
  approvalListForInstanceInputSchema,
  approvalListForOwnerInputSchema,
  approvalListOptionsSchema,
  approvalStatusSchema,
} from "./modules/approvals/schemas.js";
export { describeApprovalPayload } from "./modules/approvals/format.js";

export type {
  RuleVerdict,
  EgressRuleSource,
  EgressPreset,
  EgressRuleView,
  EgressRuleCreateInput,
  EgressRuleUpdateInput,
  EgressRulesService,
} from "./modules/egress-rules/types.js";
export {
  egressPresetSchema,
  egressRuleApplyPresetInputSchema,
  egressRuleCreateInputSchema,
  egressRuleCurrentPresetInputSchema,
  egressRuleGetInputSchema,
  egressRuleListForAgentInputSchema,
  egressRuleRevokeInputSchema,
  egressRuleUpdateInputSchema,
  ruleVerdictSchema,
} from "./modules/egress-rules/schemas.js";
export {
  formatEgressRuleInline,
  formatEgressRuleSource,
} from "./modules/egress-rules/format.js";
export type {
  GatewayRestartImpact,
  GatewayRestartImpactInput,
  PromotionRule,
} from "./modules/egress-rules/promotion.js";
export {
  gatewayRestartImpact,
  needsL7Promotion,
  promotedHosts,
} from "./modules/egress-rules/promotion.js";

export {
  platformTurnEndedNotificationSchema,
  platformTurnEndedParamsSchema,
  buildPlatformTurnEndedNotification,
  platformPromptAcceptedNotificationSchema,
  platformPromptAcceptedParamsSchema,
  buildPlatformPromptAcceptedNotification,
  platformPromptStartedNotificationSchema,
  platformPromptStartedParamsSchema,
  buildPlatformPromptStartedNotification,
  platformClippedReplayMetaSchema,
  PROMPT_QUEUE_FULL_CODE,
  PROMPT_QUEUE_FULL_MESSAGE,
} from "./modules/acp/types.js";
export type {
  PlatformTurnEndedNotification,
  PlatformTurnEndedParams,
  PlatformPromptAcceptedNotification,
  PlatformPromptAcceptedParams,
  PlatformPromptStartedNotification,
  PlatformPromptStartedParams,
  PlatformClippedReplayMeta,
} from "./modules/acp/types.js";

export { brandSchema } from "./modules/brand/types.js";
export type { Brand } from "./modules/brand/types.js";

export { linksSchema } from "./modules/links/types.js";
export type { Links } from "./modules/links/types.js";

export {
  publicAgentViewSchema,
  publicAgentResponseSchema,
} from "./modules/agents/public-agent.js";
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
export {
  staleAcceptanceSchema,
  termsAcceptInputSchema,
  termsCurrentSchema,
  termsDocumentSchema,
  termsLatestAcceptanceSchema,
} from "./modules/terms/schemas.js";
export { PRE_TERMS_PROCEDURES } from "./modules/terms/pre-terms-procedures.js";

export type { EntryPointChoice, UsageService } from "./modules/usage/types.js";
export {
  entryPointChoiceSchema,
  entryPointChosenInputSchema,
} from "./modules/usage/schemas.js";

export { authConfigSchema } from "./modules/auth/types.js";
export type { AuthConfig } from "./modules/auth/types.js";

export type {
  E2eService,
  SlackFireCommandInput,
  SlackFireCommandResult,
  SlackFireMentionInput,
  SlackFireMessageInput,
  SlackOutboundRecord,
  SlackReadOutboundResult,
} from "./modules/e2e/types.js";
export {
  e2eAgentIdInputSchema,
  e2eSetScriptInputSchema,
} from "./modules/e2e/schemas.js";

export { secretRef } from "./modules/secret-store/types.js";
export type { SecretRef } from "./modules/secret-store/types.js";

export type { HarnessRouter } from "./harness-router.js";
export type { HarnessContext } from "./harness-context.js";
export { helloInput, helloResult } from "./modules/runtime/types.js";
export type {
  HelloInput,
  HelloResult,
  RuntimeDeliveryService,
} from "./modules/runtime/types.js";
export {
  contribution,
  contributionKind,
  event as runtimeEvent,
  eventKind as runtimeEventKind,
  capabilities,
  mergeMode as contributionMergeMode,
  fileFormat,
  applyStateInput,
  applyStateResult,
  driverFailure,
  stateSlice,
} from "agent-runtime-api";
export type {
  Contribution,
  ContributionKind,
  Event as RuntimeEvent,
  EventKind as RuntimeEventKind,
  Capabilities,
  MergeMode as ContributionMergeMode,
  FileFormat,
  ApplyStateInput,
  ApplyStateResult,
  DriverFailure,
  StateSlice,
} from "agent-runtime-api";

export {
  AGENT_SCOPES,
  ALL_SCOPES,
  API_KEY_PREFIX,
  CREDENTIAL_SCOPES,
} from "./modules/api-keys/types.js";
export type {
  AgentBinding,
  ApiKeyCreateInput,
  ApiKeyCreateResult,
  ApiKeyRevokeInput,
  ApiKeyView,
  ApiKeysService,
  Scope,
} from "./modules/api-keys/types.js";
export {
  agentBindingSchema,
  apiKeyCreateInputSchema,
  apiKeyRevokeInputSchema,
  scopeSchema,
} from "./modules/api-keys/schemas.js";
