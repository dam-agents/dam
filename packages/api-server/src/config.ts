import { brandSchema, linksSchema } from "api-server-api";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };
import { durationToMinutesStrict } from "./duration.js";

function isValidAppSlug(s: string): boolean {
  return s.length >= 1 && s.length <= 39 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
}

const adminAppSlugSchema = z
  .string()
  .nullable()
  .default(null)
  .transform((v) => (v == null || v === "" ? null : v))
  .refine((v) => v == null || isValidAppSlug(v), {
    message:
      "Admin-default GitHub App slug must be 1–39 lowercase letters, digits, and single hyphens — no leading, trailing, or consecutive hyphens.",
  });

const positiveQuantitySchema = z
  .string()
  .regex(
    /^(([0-9]+(\.[0-9]*)?)|(\.[0-9]+))(([KMGTPE]i)|[mkMGTPE])?$/,
    "must be a Kubernetes quantity, e.g. '1', '500m', '2Gi'",
  )
  .refine((v) => parseFloat(v) > 0, {
    message: "must be a positive quantity",
  });

const configSchema = z.object({
  serverVersion: z.string().min(1),
  appVersion: z.string().min(1),
  namespace: z.string().default("platform-agents"),
  releaseName: z.string().min(1, "PLATFORM_RELEASE_NAME must be set"),
  logLevel: z.enum(["error", "warn", "info", "debug"]).default("info"),
  port: z.coerce.number().default(4000),
  harnessServerPort: z.coerce.number().default(4001),
  harnessServerUrl: z.string().url(),
  extAuthzPort: z.coerce.number().default(4002),
  databaseUrl: z.string(),
  databaseCaCertPath: z.string().optional(),
  migrationsPath: z.string().default("./packages/db/drizzle"),
  clickhouseUrl: z.string().optional(),
  clickhouseUser: z.string().default("default"),
  clickhousePassword: z.string().default(""),
  clickhouseDatabase: z.string().default("default"),
  slackBotToken: z.string().nullable().default(null),
  slackAppToken: z.string().nullable().default(null),
  slackOauthCallbackUrl: z.string().nullable().default(null),
  telegramBotToken: z.string().nullable().default(null),
  telegramBotUsername: z.string().nullable().default(null),
  e2eEnabled: z.coerce.boolean().default(false),
  virtualizationEnabled: z.coerce.boolean().default(false),
  activityTrackingEnabled: z.coerce.boolean().default(false),
  activityHmacKey: z.string().min(1, "ACTIVITY_HMAC_KEY must be set"),
  apiKeyHmacKey: z.string().min(1, "API_KEY_HMAC_KEY must be set"),
  uiBaseUrl: z.url().default("http://localhost:4444"),
  keycloakUrl: z.url().default("http://platform-keycloak:8080"),
  keycloakExternalUrl: z.url().default("http://keycloak.localhost:4444"),
  keycloakRealm: z.string().default("platform"),
  keycloakClientId: z.string().default("platform-ui"),
  keycloakCliClientId: z.string().default("platform-cli"),
  keycloakApiAudience: z.string().default("platform-api"),
  keycloakApiClientId: z.string().default("platform-api"),
  keycloakApiClientSecret: z.string().default(""),
  keycloakRequiredRole: z.string().optional(),
  keycloakInspectorRole: z.string().optional(),
  agentIdleTimeoutMinutes: z.number().int().min(0),
  agentDefaultCpuLimit: positiveQuantitySchema.default("1"),
  agentDefaultMemoryLimit: positiveQuantitySchema.default("1Gi"),
  defaultUserCpuBudget: positiveQuantitySchema.default("4"),
  defaultUserMemoryBudget: positiveQuantitySchema.default("8Gi"),
  skillSourcesSeed: z.string().default(""),
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
  acpTurnCeilingSeconds: z.coerce.number().int().positive().default(3600),
  minClientCliVersion: z.string().optional(),
  trustedHostsPath: z.string().default(""),
  agentTemplatesPath: z.string().default(""),
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
  objectStorageEndpoint: z.url().optional(),
  objectStorageAgentEndpoint: z.url().optional(),
  objectStoragePublicEndpoint: z.url().optional(),
  objectStorageRegion: z.string().min(1).default("us-east-1"),
  objectStorageBucket: z.string().min(1).default("platform-artifacts"),
  objectStorageAccessKeyId: z.string().nullable().default(null),
  objectStorageSecretAccessKey: z.string().nullable().default(null),
  objectStorageForcePathStyle: z.stringbool().default(true),
  shareBaseUrl: z.url({ error: "SHARE_BASE_URL must be a valid URL" }),
  experimentInactivitySeconds: z.coerce.number().int().positive().default(900),
  brand: brandSchema,
  links: linksSchema,
  terms: z.object({
    version: z.string().min(1, "terms.version must be set"),
    text: z.string().min(1, "terms.text must be set"),
  }),
});

export type Config = z.infer<typeof configSchema>;

const validatedConfigSchema = configSchema
  .refine((c) => c.acpTurnCeilingSeconds >= c.approvalHoldSeconds, {
    message:
      "acpTurnCeilingSeconds must be >= approvalHoldSeconds so a turn blocked on an egress approval does not die before the hold resolves",
    path: ["acpTurnCeilingSeconds"],
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
  );

export function loadConfig(): Config {
  return validatedConfigSchema.parse({
    serverVersion: pkg.version,
    appVersion: process.env.PLATFORM_APP_VERSION ?? "0.0.0",
    namespace: process.env.NAMESPACE,
    releaseName: process.env.PLATFORM_RELEASE_NAME,
    logLevel: process.env.LOG_LEVEL,
    port: process.env.PORT,
    harnessServerPort: process.env.MCP_PORT,
    harnessServerUrl: process.env.PLATFORM_HARNESS_SERVER_URL,
    extAuthzPort: process.env.EXT_AUTHZ_PORT,
    databaseUrl: process.env.DATABASE_URL,
    databaseCaCertPath: process.env.DATABASE_CA_CERT_PATH,
    migrationsPath: process.env.MIGRATIONS_PATH,
    clickhouseUrl: process.env.CLICKHOUSE_URL,
    clickhouseUser: process.env.CLICKHOUSE_USER,
    clickhousePassword: process.env.CLICKHOUSE_PASSWORD,
    clickhouseDatabase: process.env.CLICKHOUSE_DATABASE,
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    slackOauthCallbackUrl: process.env.SLACK_OAUTH_CALLBACK_URL,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN,
    telegramBotUsername: process.env.TELEGRAM_BOT_USERNAME,
    e2eEnabled: process.env.E2E_ENABLED,
    virtualizationEnabled: process.env.VIRTUALIZATION_ENABLED,
    activityTrackingEnabled: process.env.ACTIVITY_TRACKING_ENABLED,
    activityHmacKey: process.env.ACTIVITY_HMAC_KEY,
    apiKeyHmacKey: process.env.API_KEY_HMAC_KEY,
    uiBaseUrl: process.env.UI_BASE_URL,
    keycloakUrl: process.env.KEYCLOAK_URL,
    keycloakExternalUrl: process.env.KEYCLOAK_EXTERNAL_URL,
    keycloakRealm: process.env.KEYCLOAK_REALM,
    keycloakClientId: process.env.KEYCLOAK_CLIENT_ID,
    keycloakCliClientId: process.env.KEYCLOAK_CLI_CLIENT_ID,
    keycloakApiAudience: process.env.KEYCLOAK_API_AUDIENCE,
    keycloakApiClientId: process.env.KEYCLOAK_API_CLIENT_ID,
    keycloakApiClientSecret: process.env.KEYCLOAK_API_CLIENT_SECRET,
    keycloakRequiredRole: process.env.KEYCLOAK_REQUIRED_ROLE,
    keycloakInspectorRole: process.env.KEYCLOAK_INSPECTOR_ROLE,
    agentIdleTimeoutMinutes: durationToMinutesStrict(
      process.env.AGENT_IDLE_TIMEOUT ?? "1h",
    ),
    agentDefaultCpuLimit: process.env.AGENT_DEFAULT_CPU_LIMIT,
    agentDefaultMemoryLimit: process.env.AGENT_DEFAULT_MEMORY_LIMIT,
    defaultUserCpuBudget: process.env.DEFAULT_USER_CPU_BUDGET,
    defaultUserMemoryBudget: process.env.DEFAULT_USER_MEMORY_BUDGET,
    skillSourcesSeed: process.env.SKILL_SOURCES_SEED,
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
    acpTurnCeilingSeconds: process.env.ACP_TURN_CEILING_SECONDS,
    minClientCliVersion: process.env.MIN_CLIENT_CLI_VERSION,
    trustedHostsPath: process.env.TRUSTED_HOSTS_PATH,
    agentTemplatesPath: process.env.AGENT_TEMPLATES_PATH,
    gitReposPath: process.env.GIT_REPOS_PATH,
    maxImportBundleBytes: process.env.MAX_IMPORT_BUNDLE_BYTES,
    maxArtifactBytes: process.env.MAX_ARTIFACT_BYTES,
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
    experimentInactivitySeconds: process.env.EXPERIMENT_INACTIVITY_SECONDS,
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
      computeRequest:
        process.env.LINKS_COMPUTE_REQUEST ||
        "https://ibm.enterprise.slack.com/archives/C0B3F03NB24",
    },
    terms: {
      version: process.env.TERMS_VERSION,
      text: process.env.TERMS_TEXT,
    },
  });
}
