export type { AppRouter } from "./router.js";
export type { ApiContext, UserIdentity } from "./context.js";

export { ChannelType, envVarSchema, type EnvVar } from "./modules/shared.js";

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

export type {
  HarnessConfigChange,
  HarnessConfigStatus,
  HarnessConfigService,
} from "./modules/harness-config/types.js";
export {
  agentConfigOptionsSchema,
  harnessConfigApplyInputSchema,
} from "./modules/harness-config/schemas.js";

export type {
  Agent,
  AgentSpec,
  AgentState,
  AgentsService,
  AgentCreateInput,
  AgentUpdateInput,
  ConnectSlackError,
  ConnectSlackResult,
  Channel,
  SlackChannel,
  TelegramChannel,
  ChannelConfig,
} from "./modules/agents/types.js";
export {
  agentConnectSlackInputSchema,
  agentConnectTelegramInputSchema,
  agentCreateInputSchema,
  agentDeleteInputSchema,
  agentDisconnectSlackInputSchema,
  agentDisconnectTelegramInputSchema,
  agentGetInputSchema,
  agentRestartInputSchema,
  agentUpdateInputSchema,
  agentWakeInputSchema,
} from "./modules/agents/schemas.js";
export {
  PROTECTED_AGENT_ENV_NAMES,
  isProtectedAgentEnvName,
} from "./modules/agents/types.js";
export type { AgentSpecCR, ForkSpecCR, RunSpecCR } from "./crd-types.gen.js";

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
  ArmStatus,
  Experiment,
  ExperimentArm,
  ExperimentRun,
  ExperimentArmWithRuns,
  ExperimentWithRuns,
  ExperimentListItem,
  ActiveArm,
  ExperimentCreateInput,
  ExperimentAddArmInput,
  ExperimentRecordRunInput,
  ExperimentFinishArmInput,
  ExperimentsService,
} from "./modules/experiments/types.js";
export {
  armVariationSchema,
  experimentAddArmInputSchema,
  experimentCreateInputSchema,
  experimentIdInputSchema,
} from "./modules/experiments/schemas.js";
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
  MetricsOverview,
  TokenSpendByModel,
  SessionRuntime,
  CallContext,
} from "./modules/metrics/types.js";

export type {
  AgentAppConnections,
  AppConnectionStatus,
  AppConnectionView,
  ClusterCaProbe,
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
  Skill,
  SkillCreateSourceInput,
  SkillInstallInput,
  SkillPublishInput,
  SkillPublishRecord,
  SkillPublishResult,
  SkillRef,
  SkillSource,
  SkillsService,
  SkillsState,
  SkillUninstallInput,
} from "./modules/skills/types.js";
export {
  localSkillSchema,
  skillCreateSourceInputSchema,
  skillDeleteSourceInputSchema,
  skillInstallInputSchema,
  skillListInputSchema,
  skillListLocalInputSchema,
  skillListSourcesInputSchema,
  skillPublishInputSchema,
  skillPublishRecordSchema,
  skillPublishResultSchema,
  skillRefSchema,
  skillRefreshSourceInputSchema,
  skillSchema,
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
  egressRuleListForAgentInputSchema,
  egressRuleRevokeInputSchema,
  egressRuleUpdateInputSchema,
  ruleVerdictSchema,
} from "./modules/egress-rules/schemas.js";
export {
  formatEgressRuleInline,
  formatEgressRuleSource,
} from "./modules/egress-rules/format.js";

// ACP platform/* synthetic notifications
export {
  platformTurnEndedNotificationSchema,
  platformTurnEndedParamsSchema,
  buildPlatformTurnEndedNotification,
} from "./modules/acp/types.js";
export type {
  PlatformTurnEndedNotification,
  PlatformTurnEndedParams,
} from "./modules/acp/types.js";

// Brand
export { brandSchema } from "./modules/brand/types.js";
export type { Brand } from "./modules/brand/types.js";

// Terms
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

// Auth config
export { authConfigSchema } from "./modules/auth/types.js";
export type { AuthConfig } from "./modules/auth/types.js";

// E2E
export type {
  E2eService,
  SlackFireCommandInput,
  SlackFireCommandResult,
  SlackFireMentionInput,
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

// API keys
export {
  AGENT_SCOPES,
  ALL_SCOPES,
  API_KEY_PREFIX,
  CREDENTIAL_SCOPES,
} from "./modules/api-keys/types.js";
// auth-procedures.ts (readAgentProcedure, operateAgentsProcedure,
// manageAgentsProcedure, …, checkAgentBinding) is deliberately NOT re-exported
// here. It calls `initTRPC.create()` at module load via `t.procedure.use(...)`,
// which pulls @trpc/server into any consumer. Browser bundles must not load it;
// routers in this package import it directly via `../../auth-procedures.js`.
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
