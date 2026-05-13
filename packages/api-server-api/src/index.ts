export type { AppRouter } from "./router.js";
export type { ApiContext, UserIdentity } from "./context.js";

export { ChannelType, type EnvVar } from "./modules/shared.js";

export { SPEC_VERSION } from "./modules/templates/types.js";
export type {
  Template,
  TemplateSpec,
  TemplatesService,
  Mount,
  Resources,
  SkillSourceSeed,
} from "./modules/templates/types.js";

export type {
  Agent,
  AgentSpec,
  AgentsService,
  CreateAgentInput,
  UpdateAgentInput,
} from "./modules/agents/types.js";
export {
  PROTECTED_AGENT_ENV_NAMES,
  isProtectedAgentEnvName,
} from "./modules/agents/types.js";

export type {
  Instance,
  InstanceState,
  Channel,
  SlackChannel,
  TelegramChannel,
  ChannelConfig,
  CreateInstanceInput,
  UpdateInstanceInput,
  InstancesService,
} from "./modules/instances/types.js";

export type {
  Schedule,
  ScheduleSpec,
  ScheduleSpecCron,
  ScheduleSpecRRule,
  ScheduleStatus,
  QuietWindow,
  ScheduleCreator,
  CreateCronScheduleInput,
  CreateRRuleScheduleInput,
  UpdateRRuleScheduleInput,
  SchedulesService,
} from "./modules/schedules/types.js";

export type {
  SecretType,
  ProviderPreset,
  ProviderPresetMode,
  ProviderPresetType,
  SecretView,
  CreateSecretInput,
  UpdateSecretInput,
  AgentAccess,
  SecretsService,
  EnvMapping,
  InjectionConfig,
  IbmLitellmModelPins,
} from "./modules/secrets/types.js";
export {
  DEFAULT_ENV_PLACEHOLDER,
  DEFAULT_INJECTION_CONFIG,
  ENV_NAME_RE,
  isValidEnvName,
  PROVIDERS,
  PROVIDER_PRESET_TYPES,
  QUERY_PARAM_RE,
  isProviderPresetType,
  IBM_LITELLM_DEFAULT_MODEL_PINS,
  ibmLitellmEnvMappings,
  ibmLitellmPinsFromEnvMappings,
} from "./modules/secrets/types.js";
export { updateSecretInputSchema } from "./modules/secrets/schemas.js";

export type { ChannelsService } from "./modules/channels/types.js";

export type {
  AgentAppConnections,
  AppConnectionStatus,
  AppConnectionView,
  ConnectionsService,
} from "./modules/connections/types.js";

export { SessionType, SessionMode } from "./modules/sessions/types.js";
export type {
  SessionView,
  SessionsService as SessionsApiService,
} from "./modules/sessions/types.js";

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
  TerminalFrame,
} from "./modules/terminal/protocol.js";

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
  Skill,
  SkillRef,
  SkillSource,
  SkillsService,
  SkillsState,
  SkillPublishRecord,
  CreateSkillSourceInput,
  InstallSkillInput,
  UninstallSkillInput,
  LocalSkill,
  PublishSkillInput,
  PublishSkillResult,
} from "./modules/skills/types.js";

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
} from "./modules/approvals/types.js";

export type {
  RuleVerdict,
  EgressRuleSource,
  EgressPreset,
  EgressRuleView,
  CreateEgressRuleInput,
  UpdateEgressRuleInput,
  EgressRulesService,
} from "./modules/egress-rules/types.js";
