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
export { agentSpecSchema } from "./modules/agents/schemas.js";

export {
  scheduleSpecSchema,
  scheduleStatusSchema,
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

export type {
  SecretType,
  ProviderPreset,
  ProviderPresetMode,
  ProviderPresetType,
  SecretView,
  SecretCreateInput,
  SecretCreateGithubPatInput,
  CreateGithubPatOutput,
  SecretUpdateGithubPatInput,
  UpdateGithubPatOutput,
  SecretUpdateInput,
  AgentAccess,
  SecretsService,
  EnvMapping,
  InjectionConfig,
  IbmLitellmModelPins,
  BobModelPins,
} from "./modules/secrets/types.js";
export {
  secretCreateGithubPatInputSchema,
  secretCreateInputSchema,
  secretDeleteInputSchema,
  secretGetAgentAccessInputSchema,
  secretListGrantedAgentsInputSchema,
  secretSetAgentAccessInputSchema,
  secretTestAnthropicInputSchema,
  secretUpdateGithubPatInputSchema,
  secretUpdateInputSchema,
} from "./modules/secrets/schemas.js";
export { ENV_NAME_RE } from "./modules/shared.js";
export {
  DEFAULT_ENV_PLACEHOLDER,
  DEFAULT_INJECTION_CONFIG,
  isValidEnvName,
  PROVIDERS,
  PROVIDER_PRESET_TYPES,
  QUERY_PARAM_RE,
  isProviderPresetType,
  IBM_LITELLM_DEFAULT_MODEL_PINS,
  ibmLitellmEnvMappings,
  ibmLitellmPinsFromEnvMappings,
  bobEnvMappings,
  bobPinsFromEnvMappings,
  BOB_CHAT_MODES,
} from "./modules/secrets/types.js";
export { hostPatternSchema } from "./modules/secrets/schemas.js";

export type { ChannelsService } from "./modules/channels/types.js";

export type {
  AgentAppConnections,
  AppConnectionStatus,
  AppConnectionView,
  ConnectionsService,
} from "./modules/connections/types.js";
export {
  connectionGetAgentConnectionsInputSchema,
  connectionSetAgentConnectionsInputSchema,
} from "./modules/connections/schemas.js";

export {
  SessionType,
  SessionMode,
  sessionModeSchema,
} from "./modules/sessions/types.js";
export type {
  SessionView,
  SessionResolution,
  TerminalStrategy,
  SessionsService as SessionsApiService,
} from "./modules/sessions/types.js";
export {
  sessionCreateInputSchema,
  sessionDeleteInputSchema,
  sessionListByScheduleIdInputSchema,
  sessionListInputSchema,
  sessionResetByScheduleIdInputSchema,
  sessionResolveTerminalInputSchema,
  sessionSetModeInputSchema,
  terminalStrategySchema,
} from "./modules/sessions/schemas.js";

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
} from "./modules/approvals/types.js";
export {
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

// ACP platform/* synthetic notifications
export {
  platformTurnEndedNotificationSchema,
  platformTurnEndedParamsSchema,
  platformSessionModeChangedNotificationSchema,
  platformSessionModeChangedParamsSchema,
  buildPlatformTurnEndedNotification,
  buildPlatformSessionModeChangedNotification,
} from "./modules/acp/types.js";
export type {
  PlatformTurnEndedNotification,
  PlatformTurnEndedParams,
  PlatformSessionModeChangedNotification,
  PlatformSessionModeChangedParams,
} from "./modules/acp/types.js";

// Brand
export { brandSchema } from "./modules/brand/types.js";
export type { Brand } from "./modules/brand/types.js";

// Auth config
export { authConfigSchema } from "./modules/auth/types.js";
export type { AuthConfig } from "./modules/auth/types.js";
