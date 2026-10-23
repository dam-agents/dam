import {
  type FeatureId,
  type FeatureMode,
  brandSchema,
  featureIdSchema,
  featureModeSchema,
  harnessCatalogConfigSchema,
  linksSchema,
  PROVIDER_TEMPLATE_IDS,
  signUpsSchema,
  spendCeilingUsdTextSchema,
} from "api-server-api";
import { DEFAULT_DB_POOL_MAX } from "db";
import { z } from "zod";
import { getLogger } from "./core/logger.js";
import { durationToMinutesStrict, goDurationMs } from "./duration.js";

const DEFAULT_DELIVERY_CONCURRENCY = 256;

const adminAppSlugSchema = z
  .string()
  .nullable()
  .default(null)
  .transform((v) => (v == null || v === "" ? null : v))
  .refine(
    (v) => v == null || (v.length <= 39 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)),
    {
      message:
        "Admin-default GitHub App slug must be 1–39 lowercase letters, digits, and single hyphens — no leading, trailing, or consecutive hyphens.",
    },
  );

const positiveQuantitySchema = z
  .string()
  .regex(
    /^(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))(([KMGTPE]i)|[mkMGTPE])?$/,
    "must be a Kubernetes quantity, e.g. '1', '500m', '2Gi'",
  )
  .refine((v) => parseFloat(v) > 0, {
    message: "must be a positive quantity",
  });

// UNIT_BOUNDARY_DESCRIPTION: the chart's per-feature mode, with every feature it does not name read as the chart's default mode. An id the api-server no longer knows is ignored rather than refused, so values that still name a graduated feature keep the install starting.
const featureModesSchema = z
  .object({
    named: z
      .string()
      .default("{}")
      .transform((raw, ctx) => {
        try {
          return JSON.parse(raw) as unknown;
        } catch {
          ctx.addIssue({ code: "custom", message: "must be a JSON object" });
          return z.NEVER;
        }
      })
      .pipe(z.record(z.string(), featureModeSchema)),
    fallback: featureModeSchema.default("experimental"),
  })
  .transform(
    ({ named, fallback }) =>
      Object.fromEntries(
        featureIdSchema.options.map((id) => [id, named[id] ?? fallback]),
      ) as Record<FeatureId, FeatureMode>,
  );

// UNIT_BOUNDARY_DESCRIPTION: the chart's harness catalog. Without one (a dev run outside the chart) the default image's harness is Claude Code with nothing else on offer.
const harnessesSchema = z
  .string()
  .default('{"default":"claude-code","catalog":{}}')
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a JSON object" });
      return z.NEVER;
    }
  })
  .pipe(harnessCatalogConfigSchema);

const dollarsSchema = z.number().finite().nonnegative();

const dollarTokenPricesShape = {
  input: dollarsSchema.optional(),
  output: dollarsSchema.optional(),
  cacheRead: dollarsSchema.optional(),
  cacheWrite5m: dollarsSchema.optional(),
  cacheWrite1h: dollarsSchema.optional(),
};

const dollarTierPricesSchema = z.strictObject({
  ...dollarTokenPricesShape,
  aboveThreshold: z.strictObject(dollarTokenPricesShape).optional(),
});

// UNIT_BOUNDARY_DESCRIPTION: the chart's operator prices for model calls, in dollars per million tokens and per web search. They win over every other price, and the chart ships IBM LiteLLM's own prices, which no public price list has.
const spendPriceOverridesSchema = z
  .string()
  .default("[]")
  .transform((raw, ctx) => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      ctx.addIssue({ code: "custom", message: "must be a JSON array" });
      return z.NEVER;
    }
  })
  .pipe(
    z
      .array(
        z.strictObject({
          provider: z.string().refine((id) => PROVIDER_TEMPLATE_IDS.has(id), {
            message: "must be a provider template id",
          }),
          model: z.string().min(1),
          ...dollarTokenPricesShape,
          input: dollarsSchema,
          output: dollarsSchema,
          webSearch: dollarsSchema.optional(),
          threshold: z
            .strictObject({
              promptTokens: z.number().int().positive(),
              ...dollarTokenPricesShape,
            })
            .optional(),
          flex: dollarTierPricesSchema.optional(),
          priority: dollarTierPricesSchema.optional(),
          factors: z.record(z.string(), z.number().positive()).optional(),
        }),
      )
      .superRefine((rows, ctx) => {
        const seen = new Set<string>();
        for (const [index, row] of rows.entries()) {
          const key = `${row.provider} ${row.model}`;
          if (seen.has(key)) {
            ctx.addIssue({
              code: "custom",
              path: [index, "model"],
              message: `${row.model} is priced twice for ${row.provider}`,
            });
          }
          seen.add(key);
        }
      }),
  );

// UNIT_BOUNDARY_DESCRIPTION: the key the deployment offers CurveBender to its users, sent by the gateway on every CurveBender call. An empty key means the deployment offers no shared CurveBender, so no template exists and every user keeps their own key.
const curveBenderDeploymentSchema = z
  .object({ apiKey: z.string().default("") })
  .transform(({ apiKey }) => (apiKey === "" ? null : { apiKey }));
// UNIT_BOUNDARY_DESCRIPTION: the install's second address set, reached through the Environment Link by the agent that installed it: its app, Keycloak, share and content URLs, all four or none. None is an install with its public addresses alone.
const backchannelSchema = z
  .object({
    uiBaseUrl: z.url().optional(),
    keycloakExternalUrl: z.url().optional(),
    shareBaseUrl: z.url().optional(),
    contentBaseUrl: z.url().optional(),
  })
  .transform((b, ctx) => {
    const set = Object.values(b).filter((u) => u !== undefined).length;
    if (set === 0) return null;
    if (set < 4) {
      ctx.addIssue({
        code: "custom",
        message:
          "BACKCHANNEL_UI_BASE_URL, BACKCHANNEL_KEYCLOAK_URL, BACKCHANNEL_SHARE_BASE_URL and BACKCHANNEL_CONTENT_BASE_URL must be set together",
      });
      return z.NEVER;
    }
    return b as Required<typeof b>;
  });
const configSchema = z.object({
  appVersion: z.string().min(1),
  namespace: z.string().default("platform-agents"),
  releaseName: z.string().min(1, "PLATFORM_RELEASE_NAME must be set"),
  agentStore: z.enum(["crd", "postgres"]).default("crd"),
  agentStorePreviewReport: z.coerce.boolean().default(false),
  logLevel: z.enum(["error", "warn", "info", "debug"]).default("info"),
  port: z.coerce.number().default(4000),
  harnessServerPort: z.coerce.number().default(4001),
  harnessServerUrl: z.string().url(),
  extAuthzPort: z.coerce.number().default(4002),
  databaseUrl: z.string(),
  databaseCaCertPath: z.string().optional(),
  databasePoolMax: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_DB_POOL_MAX),
  runtimeDeliveryConcurrency: z.coerce
    .number()
    .int()
    .positive()
    .default(DEFAULT_DELIVERY_CONCURRENCY),
  migrationsPath: z.string().default("./packages/db/drizzle"),
  clickhouseUrl: z.string().optional(),
  clickhouseUser: z.string().default("default"),
  clickhousePassword: z.string().default(""),
  clickhouseDatabase: z.string().default("default"),
  slackBotToken: z.string().nullable().default(null),
  slackAppToken: z.string().nullable().default(null),
  slackOauthCallbackUrl: z.string().nullable().default(null),
  slackInstallCallbackUrl: z.string().nullable().default(null),
  slackEnterpriseId: z.string().default(""),
  slackClientId: z.string().nullable().default(null),
  slackClientSecret: z.string().nullable().default(null),
  slackTokenRotation: z.coerce.boolean().default(false),
  telegramBotToken: z.string().nullable().default(null),
  imgbbApiKey: z.string().nullable().default(null),
  telegramBotUsername: z.string().nullable().default(null),
  e2eEnabled: z.coerce.boolean().default(false),
  // UNIT_BOUNDARY_DESCRIPTION: the pool each owner's VM runner is created at, as the chart sizes it, read before any runner exists to ask. The storage is the claim every machine disk shares; a memory the install does not set leaves the runner sized by the owner's UserBudget alone, whose own absence refuses nothing.
  vmPoolStorage: z.string().default("100Gi"),
  vmPoolMemory: z.string().default(""),
  featureModes: featureModesSchema,
  curveBenderDeployment: curveBenderDeploymentSchema,
  activityTrackingEnabled: z.coerce.boolean().default(false),
  activityHmacKey: z.string().min(1, "ACTIVITY_HMAC_KEY must be set"),
  apiKeyHmacKey: z.string().min(1, "API_KEY_HMAC_KEY must be set"),
  uiBaseUrl: z.url().default("http://localhost:4444"),
  keycloakUrl: z.url().default("http://platform-keycloak:8080"),
  keycloakExternalUrl: z.url().default("http://keycloak.localhost:4444"),
  keycloakRealm: z.string().default("platform"),
  keycloakClientId: z.string().default("platform-ui"),
  keycloakCliClientId: z.string().default("platform-cli"),
  keycloakShareClientId: z.string().default("platform-share"),
  keycloakApiAudience: z.string().default("platform-api"),
  keycloakApiClientId: z.string().default("platform-api"),
  keycloakApiClientSecret: z.string().default(""),
  keycloakRequiredRole: z.string().optional(),
  keycloakInspectorRole: z.string().optional(),
  keycloakSlackInstallerRole: z.string().optional(),
  keycloakOperatorRole: z.string().optional(),
  agentHome: z.string().default("/home/agent"),
  agentWorkDir: z.string().default("/home/agent/work"),
  agentIdleTimeoutMinutes: z.number().int().min(0),
  outageAlertDelayMinutes: z.number().int().min(0),
  agentDefaultCpuLimit: positiveQuantitySchema.default("1"),
  agentDefaultMemoryLimit: positiveQuantitySchema.default("1Gi"),
  agentDefaultStorageSize: positiveQuantitySchema.default("10Gi"),
  defaultUserCpuBudget: positiveQuantitySchema.default("4"),
  defaultUserMemoryBudget: positiveQuantitySchema.default("8Gi"),
  skillSourcesSeed: z.string().default(""),
  caseStudiesRetentionDays: z.coerce.number().int().positive().default(365),
  caseStudiesTombstoneGraceDays: z.coerce.number().int().positive().default(30),
  defaultGithubClientId: z.string().nullable().default(null),
  defaultGithubClientSecret: z.string().nullable().default(null),
  defaultGithubAppSlug: adminAppSlugSchema,
  defaultGithubEnterpriseHost: z.string().nullable().default(null),
  defaultGithubEnterpriseClientId: z.string().nullable().default(null),
  defaultGithubEnterpriseClientSecret: z.string().nullable().default(null),
  defaultGithubEnterpriseAppSlug: adminAppSlugSchema,
  defaultSlackClientId: z.string().nullable().default(null),
  defaultSlackClientSecret: z.string().nullable().default(null),
  redisUrl: z.string().nullable().default(null),
  redisPassword: z.string().nullable().default(null),
  approvalHoldSeconds: z.coerce.number().int().positive().default(1800),
  acpTurnStallProbeSeconds: z.coerce.number().int().positive().default(1800),
  onceScheduleAgentMaxOpen: z.coerce.number().int().positive().default(20),
  onceScheduleAgentMaxPerHour: z.coerce.number().int().positive().default(30),
  environmentsUrl: z
    .string()
    .refine((u) => u.includes("{host}"), "must name {host}")
    .nullable()
    .default(null),
  environmentsMaxPerAgent: z.coerce.number().int().positive().default(5),
  environmentExpiryMaxDays: z.coerce.number().int().positive().default(30),
  minClientCliVersion: z.string().optional(),
  recommendedClientCliVersion: z.string().optional(),
  trustedHostsPath: z.string().default(""),
  agentTemplatesPath: z.string().default(""),
  agentSkillPath: z.string().default("./skills/dam/SKILL.md"),
  harnesses: harnessesSchema,
  spendPriceOverrides: spendPriceOverridesSchema,
  spendDefaultUserCeilingMicros: spendCeilingUsdTextSchema
    .nullable()
    .default(null),
  starterKitsCatalogs: z.string().default(""),
  githubEnterpriseHost: z.string().default(""),
  githubEnterpriseToken: z.string().default(""),
  gitReposPath: z.string().default(""),
  maxImportBundleBytes: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024 * 1024),
  maxArtifactBytes: z.coerce
    .number()
    .int()
    .positive()
    .default(50 * 1024 * 1024),
  satelliteMaxConcurrentCeiling: z.coerce.number().int().positive().default(64),
  satelliteWaitDeadlineMs: z.coerce.number().int().positive().default(240_000),
  objectStorageEndpoint: z.url().optional(),
  objectStorageAgentEndpoint: z.url().optional(),
  objectStoragePublicEndpoint: z.url().optional(),
  objectStorageRegion: z.string().min(1).default("us-east-1"),
  objectStorageBucket: z.string().min(1).default("platform-artifacts"),
  objectStorageAccessKeyId: z.string().nullable().default(null),
  objectStorageSecretAccessKey: z.string().nullable().default(null),
  objectStorageForcePathStyle: z.stringbool().default(true),
  shareBaseUrl: z.url({ error: "SHARE_BASE_URL must be a valid URL" }),
  contentBaseUrl: z.url({ error: "CONTENT_BASE_URL must be a valid URL" }),
  backchannel: backchannelSchema,
  kbSharePerFileMaxBytes: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024),
  kbShareTotalMaxBytes: z.coerce
    .number()
    .int()
    .positive()
    .default(200 * 1024 * 1024),
  kbShareMaxFiles: z.coerce.number().int().positive().default(5000),
  kbShareGrepDeadlineMs: z.coerce.number().int().positive().default(2000),
  kbShareMaxConnectionsPerOwner: z.coerce.number().int().positive().default(20),
  brand: brandSchema,
  links: linksSchema,
  terms: z.object({
    version: z.string().min(1, "terms.version must be set"),
    text: z.string().min(1, "terms.text must be set"),
  }),
  signUps: signUpsSchema.default("open"),
});

export type Config = z.infer<typeof configSchema>;

const validatedConfigSchema = configSchema
  .transform((c) => {
    const stall = Math.max(c.acpTurnStallProbeSeconds, c.approvalHoldSeconds);
    if (stall !== c.acpTurnStallProbeSeconds) {
      getLogger().warn(
        { configured: c.acpTurnStallProbeSeconds, raisedTo: stall },
        "ACP_TURN_STALL_PROBE_SECONDS is below APPROVAL_HOLD_SECONDS and was raised to it, so a turn blocked on an approval is never probed before the hold resolves",
      );
    }
    return { ...c, acpTurnStallProbeSeconds: stall };
  })
  .refine(
    (c) =>
      (c.objectStorageAccessKeyId == null) ===
      (c.objectStorageSecretAccessKey == null),
    {
      message:
        "OBJECT_STORAGE_ACCESS_KEY_ID and OBJECT_STORAGE_SECRET_ACCESS_KEY must be set together (or both left unset for the SDK default provider chain)",
      path: ["objectStorageAccessKeyId"],
    },
  )
  .refine(
    (c) =>
      new URL(c.contentBaseUrl).hostname.toLowerCase() !==
      new URL(c.shareBaseUrl).hostname.toLowerCase(),
    {
      message:
        "CONTENT_BASE_URL must be a different host than SHARE_BASE_URL: the browser isolates artifact code from the share host by origin",
      path: ["contentBaseUrl"],
    },
  );

// UNIT_BOUNDARY_DESCRIPTION: the install facts every agents module needs, read from the config in one place. Each composition root passes this whole, and the module requires it, so no root can build an agents module without the install's default mounts or disk default.
export function agentsInstallSettings(config: Config) {
  return {
    defaultHarness: config.harnesses.default,
    telemetry: Object.values(config.harnesses.catalog).some(
      (h) => h.telemetryEnv.length > 0,
    ),
    agentDefaultStorageSize: config.agentDefaultStorageSize,
  };
}

const RELEASE_VERSION = /^\d+\.\d+\.\d+(-rc\d+)?$/;

function recommendedClientCliVersion(appVersion: string): string | undefined {
  return RELEASE_VERSION.test(appVersion) ? appVersion : undefined;
}

export function loadConfig(): Config {
  const appVersion = process.env.PLATFORM_APP_VERSION ?? "0.0.0";
  return validatedConfigSchema.parse({
    appVersion,
    namespace: process.env.NAMESPACE,
    releaseName: process.env.PLATFORM_RELEASE_NAME,
    agentStore: process.env.PLATFORM_AGENT_STORE,
    agentStorePreviewReport: process.env.AGENT_STORE_PREVIEW_REPORT,
    logLevel: process.env.LOG_LEVEL,
    port: process.env.PORT,
    harnessServerPort: process.env.MCP_PORT,
    harnessServerUrl: process.env.PLATFORM_HARNESS_SERVER_URL,
    extAuthzPort: process.env.EXT_AUTHZ_PORT,
    databaseUrl: process.env.DATABASE_URL,
    databaseCaCertPath: process.env.DATABASE_CA_CERT_PATH,
    databasePoolMax: process.env.DATABASE_POOL_MAX,
    runtimeDeliveryConcurrency: process.env.RUNTIME_DELIVERY_CONCURRENCY,
    migrationsPath: process.env.MIGRATIONS_PATH,
    clickhouseUrl: process.env.CLICKHOUSE_URL,
    clickhouseUser: process.env.CLICKHOUSE_USER,
    clickhousePassword: process.env.CLICKHOUSE_PASSWORD,
    clickhouseDatabase: process.env.CLICKHOUSE_DATABASE,
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    slackOauthCallbackUrl: process.env.SLACK_OAUTH_CALLBACK_URL,
    slackInstallCallbackUrl: process.env.SLACK_INSTALL_CALLBACK_URL,
    slackEnterpriseId: process.env.SLACK_ENTERPRISE_ID,
    slackClientId: process.env.SLACK_CLIENT_ID,
    slackClientSecret: process.env.SLACK_CLIENT_SECRET,
    slackTokenRotation: process.env.SLACK_TOKEN_ROTATION,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    imgbbApiKey: process.env.IMGBB_API_KEY,
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME,
    e2eEnabled: process.env.E2E_ENABLED,
    vmPoolStorage: process.env.VM_POOL_STORAGE,
    vmPoolMemory: process.env.VM_POOL_MEMORY,
    featureModes: {
      named: process.env.FEATURE_MODES,
      fallback: process.env.FEATURE_DEFAULT_MODE,
    },
    curveBenderDeployment: {
      apiKey: process.env.CURVE_BENDER_DEPLOYMENT_API_KEY,
    },
    activityTrackingEnabled: process.env.ACTIVITY_TRACKING_ENABLED,
    activityHmacKey: process.env.ACTIVITY_HMAC_KEY,
    apiKeyHmacKey: process.env.API_KEY_HMAC_KEY,
    uiBaseUrl: process.env.UI_BASE_URL,
    keycloakUrl: process.env.KEYCLOAK_URL,
    keycloakExternalUrl: process.env.KEYCLOAK_EXTERNAL_URL,
    keycloakRealm: process.env.KEYCLOAK_REALM,
    keycloakClientId: process.env.KEYCLOAK_CLIENT_ID,
    keycloakCliClientId: process.env.KEYCLOAK_CLI_CLIENT_ID,
    keycloakShareClientId: process.env.KEYCLOAK_SHARE_CLIENT_ID,
    keycloakApiAudience: process.env.KEYCLOAK_API_AUDIENCE,
    keycloakApiClientId: process.env.KEYCLOAK_API_CLIENT_ID,
    keycloakApiClientSecret: process.env.KEYCLOAK_API_CLIENT_SECRET,
    keycloakRequiredRole: process.env.KEYCLOAK_REQUIRED_ROLE,
    keycloakInspectorRole: process.env.KEYCLOAK_INSPECTOR_ROLE,
    keycloakSlackInstallerRole: process.env.KEYCLOAK_SLACK_INSTALLER_ROLE,
    keycloakOperatorRole: process.env.KEYCLOAK_OPERATOR_ROLE,
    agentHome: process.env.AGENT_HOME,
    agentWorkDir: process.env.AGENT_WORK_DIR,
    agentIdleTimeoutMinutes: durationToMinutesStrict(
      process.env.AGENT_IDLE_TIMEOUT ?? "5m",
    ),
    outageAlertDelayMinutes: durationToMinutesStrict(
      process.env.OUTAGE_ALERT_DELAY ?? "15m",
    ),
    agentDefaultCpuLimit: process.env.AGENT_DEFAULT_CPU_LIMIT,
    agentDefaultMemoryLimit: process.env.AGENT_DEFAULT_MEMORY_LIMIT,
    agentDefaultStorageSize: process.env.AGENT_DEFAULT_STORAGE_SIZE,
    defaultUserCpuBudget: process.env.DEFAULT_USER_CPU_BUDGET,
    defaultUserMemoryBudget: process.env.DEFAULT_USER_MEMORY_BUDGET,
    skillSourcesSeed: process.env.SKILL_SOURCES_SEED,
    caseStudiesRetentionDays: process.env.CASE_STUDIES_RETENTION_DAYS,
    caseStudiesTombstoneGraceDays:
      process.env.CASE_STUDIES_TOMBSTONE_GRACE_DAYS,
    defaultGithubClientId: process.env.PLATFORM_DEFAULT_GITHUB_CLIENT_ID,
    defaultGithubClientSecret:
      process.env.PLATFORM_DEFAULT_GITHUB_CLIENT_SECRET,
    defaultGithubAppSlug: process.env.PLATFORM_DEFAULT_GITHUB_APP_SLUG,
    defaultGithubEnterpriseHost: process.env.PLATFORM_DEFAULT_GHE_HOST,
    defaultGithubEnterpriseClientId: process.env.PLATFORM_DEFAULT_GHE_CLIENT_ID,
    defaultGithubEnterpriseClientSecret:
      process.env.PLATFORM_DEFAULT_GHE_CLIENT_SECRET,
    defaultGithubEnterpriseAppSlug: process.env.PLATFORM_DEFAULT_GHE_APP_SLUG,
    defaultSlackClientId: process.env.PLATFORM_DEFAULT_SLACK_CLIENT_ID,
    defaultSlackClientSecret: process.env.PLATFORM_DEFAULT_SLACK_CLIENT_SECRET,
    redisUrl: process.env.REDIS_URL,
    redisPassword: process.env.REDIS_PASSWORD,
    approvalHoldSeconds: process.env.APPROVAL_HOLD_SECONDS,
    acpTurnStallProbeSeconds: process.env.ACP_TURN_STALL_PROBE_SECONDS,
    onceScheduleAgentMaxOpen: process.env.ONCE_SCHEDULE_AGENT_MAX_OPEN,
    onceScheduleAgentMaxPerHour: process.env.ONCE_SCHEDULE_AGENT_MAX_PER_HOUR,
    environmentsUrl: process.env.ENVIRONMENTS_URL || null,
    environmentsMaxPerAgent: process.env.ENVIRONMENTS_MAX_PER_AGENT,
    environmentExpiryMaxDays: process.env.ENVIRONMENT_EXPIRY_MAX_DAYS,
    minClientCliVersion: process.env.MIN_CLIENT_CLI_VERSION,
    recommendedClientCliVersion: recommendedClientCliVersion(appVersion),
    trustedHostsPath: process.env.TRUSTED_HOSTS_PATH,
    agentTemplatesPath: process.env.AGENT_TEMPLATES_PATH,
    agentSkillPath: process.env.AGENT_SKILL_PATH,
    harnesses: process.env.HARNESSES,
    spendPriceOverrides: process.env.SPEND_PRICE_OVERRIDES,
    spendDefaultUserCeilingMicros: process.env.SPEND_DEFAULT_USER_CEILING_USD,
    starterKitsCatalogs: process.env.STARTER_KITS_CATALOGS,
    githubEnterpriseHost: process.env.GITHUB_ENTERPRISE_HOST,
    githubEnterpriseToken: process.env.GITHUB_ENTERPRISE_TOKEN,
    gitReposPath: process.env.GIT_REPOS_PATH,
    maxImportBundleBytes: process.env.MAX_IMPORT_BUNDLE_BYTES,
    maxArtifactBytes: process.env.MAX_ARTIFACT_BYTES,
    satelliteMaxConcurrentCeiling: process.env.SATELLITE_MAX_CONCURRENT_CEILING,
    satelliteWaitDeadlineMs: process.env.SATELLITE_WAIT_DEADLINE_MS,
    objectStorageEndpoint: process.env.OBJECT_STORAGE_ENDPOINT,
    objectStorageAgentEndpoint:
      process.env.OBJECT_STORAGE_AGENT_ENDPOINT ??
      process.env.OBJECT_STORAGE_ENDPOINT,
    objectStoragePublicEndpoint: process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT,
    objectStorageRegion: process.env.OBJECT_STORAGE_REGION,
    objectStorageBucket: process.env.OBJECT_STORAGE_BUCKET,
    objectStorageAccessKeyId: process.env.OBJECT_STORAGE_ACCESS_KEY_ID,
    objectStorageSecretAccessKey: process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY,
    objectStorageForcePathStyle: process.env.OBJECT_STORAGE_FORCE_PATH_STYLE,
    shareBaseUrl: process.env.SHARE_BASE_URL,
    contentBaseUrl: process.env.CONTENT_BASE_URL,
    backchannel: {
      uiBaseUrl: process.env.BACKCHANNEL_UI_BASE_URL || undefined,
      keycloakExternalUrl: process.env.BACKCHANNEL_KEYCLOAK_URL || undefined,
      shareBaseUrl: process.env.BACKCHANNEL_SHARE_BASE_URL || undefined,
      contentBaseUrl: process.env.BACKCHANNEL_CONTENT_BASE_URL || undefined,
    },
    kbSharePerFileMaxBytes: process.env.KB_SHARE_PER_FILE_MAX_BYTES,
    kbShareTotalMaxBytes: process.env.KB_SHARE_TOTAL_MAX_BYTES,
    kbShareMaxFiles: process.env.KB_SHARE_MAX_FILES,
    kbShareGrepDeadlineMs: process.env.KB_SHARE_GREP_DEADLINE_MS,
    kbShareMaxConnectionsPerOwner:
      process.env.KB_SHARE_MAX_CONNECTIONS_PER_OWNER,
    brand: {
      name: process.env.BRAND_NAME ?? "Platform",
      short: process.env.BRAND_SHORT ?? "platform",
      title: process.env.BRAND_TITLE ?? "",
      vendor: process.env.BRAND_VENDOR ?? "",
      theme: {
        light: {
          accent: process.env.BRAND_THEME_LIGHT_ACCENT ?? "#0F62FE",
          accentHover: process.env.BRAND_THEME_LIGHT_ACCENT_HOVER ?? "#0353E9",
          accentLight: process.env.BRAND_THEME_LIGHT_ACCENT_LIGHT ?? "#edf5ff",
        },
        dark: {
          accent: process.env.BRAND_THEME_DARK_ACCENT ?? "#4589FF",
          accentHover: process.env.BRAND_THEME_DARK_ACCENT_HOVER ?? "#78A9FF",
          accentLight: process.env.BRAND_THEME_DARK_ACCENT_LIGHT ?? "#0f1f3a",
        },
      },
    },
    links: {
      computeRequest: process.env.LINKS_COMPUTE_REQUEST || null,
      slackInstallRequest: process.env.LINKS_SLACK_INSTALL_REQUEST || null,
    },
    terms: {
      version: process.env.TERMS_VERSION,
      text: process.env.TERMS_TEXT,
    },
    signUps: process.env.SIGN_UPS || undefined,
  });
}
