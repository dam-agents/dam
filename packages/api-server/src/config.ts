import { brandSchema } from "api-server-api";
import { z } from "zod";
import pkg from "../package.json" with { type: "json" };

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

const configSchema = z.object({
  /** Build-time semver from this package's package.json — not env-driven.
   *  Bundled into `dist/index.js` by tsup at build time; in dev (tsx) it
   *  resolves at module import. Surfaced on `GET /api/version`. */
  serverVersion: z.string().min(1),
  appVersion: z.string().min(1),
  namespace: z.string().default("platform-agents"),
  /** Helm release name. Required at startup — used to parse
   *  instance ID out of the per-instance ext-authz Service hostname
   *  (`<release>-extauthz-<id>`) the gateway pod's Envoy was configured
   *  to dial. A wrong/missing value produces an `expectedPrefix` that
   *  fails to match any real Service hostname, so every credentialed
   *  request would fail closed with no obvious cause — fail-fast at
   *  startup is the diagnosable shape. */
  releaseName: z.string().min(1, "PLATFORM_RELEASE_NAME must be set"),
  /** Minimum severity emitted by the structured logger (`src/core/logger.ts`).
   *  Governs the security audit trail "as usual" — it is logged at common
   *  levels (deny/fail → warn, allow/success → info), so a default of `info`
   *  keeps the trail on; raising the level reduces it. No separate audit
   *  toggle. */
  logLevel: z.enum(["error", "warn", "info", "debug"]).default("info"),
  port: z.coerce.number().default(4000),
  harnessServerPort: z.coerce.number().default(4001),
  harnessServerUrl: z.string().url(),
  /** gRPC ext_authz listener — serves both Envoy's HTTP filter (L7,
   *  TLS-terminated chains) and network filter (L4, catch-all). */
  extAuthzPort: z.coerce.number().default(4002),
  databaseUrl: z.string(),
  /** Filesystem path to a PEM CA cert for verifying the database's TLS
   *  certificate (external managed DB with a private CA). Trust is scoped to
   *  the DB connection — the client passes it as `ssl.ca`. The Helm chart
   *  mounts the CA and sets this; unset means no custom CA. */
  databaseCaCertPath: z.string().optional(),
  migrationsPath: z.string().default("./packages/db/drizzle"),
  slackBotToken: z.string().nullable().default(null),
  slackAppToken: z.string().nullable().default(null),
  slackOauthCallbackUrl: z.string().nullable().default(null),
  telegramEnabled: z.coerce.boolean().default(false),
  e2eEnabled: z.coerce.boolean().default(false),
  activityTrackingEnabled: z.coerce.boolean().default(false),
  /** HMAC key used to pseudonymize Keycloak `sub` values written to
   *  `activity_events`, `actor_roles`, and `instances` (GDPR Art. 32).
   *  Must be stable across restarts — rotating it orphans every existing
   *  row. The Helm chart auto-generates and persists this in a Secret. */
  activityHmacKey: z.string().min(1, "ACTIVITY_HMAC_KEY must be set"),
  /** HMAC pepper for at-rest API-key token digests. Must be stable across
   *  restarts — rotating it invalidates every existing key. The Helm chart
   *  auto-generates and persists this in a Secret, mirroring ACTIVITY_HMAC_KEY. */
  apiKeyHmacKey: z.string().min(1, "API_KEY_HMAC_KEY must be set"),
  uiBaseUrl: z.url().default("http://localhost:4444"),
  keycloakUrl: z.url().default("http://platform-keycloak:8080"),
  keycloakExternalUrl: z.url().default("http://keycloak.localhost:4444"),
  keycloakRealm: z.string().default("platform"),
  keycloakClientId: z.string().default("platform-ui"),
  /** Public Keycloak client id used by the `dam` CLI's Device Authorization
   *  Grant (RFC 8628). Surfaced to the CLI via `GET /api/auth/config` as
   *  `cliClientId`; never used by the api-server itself. */
  keycloakCliClientId: z.string().default("platform-cli"),
  keycloakApiAudience: z.string().default("platform-api"),
  keycloakApiClientId: z.string().default("platform-api"),
  keycloakApiClientSecret: z.string().default(""),
  keycloakRequiredRole: z.string().optional(),
  /** Realm role granting read access to the inspector endpoints
   *  (`GET /api/usage`, `GET /api/usage/report`). Unset means usage endpoints
   *  are off entirely. Threaded from `keycloak.inspectorRole` Helm value. */
  keycloakInspectorRole: z.string().optional(),
  agentHome: z.string().default("/home/agent"),
  /** JSON array of system Skill Sources declared by the cluster admin via
   *  Helm values. Empty/unset means no seed sources. Validated by Zod inside
   *  parseSeedSources at startup — malformed JSON or wrong shape crashes the
   *  pod with a clear stderr. */
  skillSourcesSeed: z.string().default(""),
  // Optional admin-level OAuth app defaults — when set, the connect form
  // for the matching app skips those input fields and the api-server uses
  // the defaults to mint tokens. A single admin-registered OAuth app can
  // serve every user on a deployment.
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
  /** Optional Redis AUTH password. The chart provisions a generated
   *  per-release password and binds it via secretKeyRef; standalone dev
   *  setups can leave it unset to point at an unauthenticated instance. */
  redisPassword: z.string().nullable().default(null),
  /** Default hold window for ext_authz HITL (seconds). Helm-configurable;
   *  matches `pending_approvals.expires_at` and the synchronous-hold deadline. */
  approvalHoldSeconds: z.coerce.number().int().positive().default(1800),
  /** Minimum CLI version this server accepts. Optional — when unset, no
   *  floor is advertised and every CLI is accepted (a soft-warn fires on
   *  the CLI side when the local CLI is behind the current server). */
  minClientCliVersion: z.string().optional(),
  /** Path to a newline-delimited file of hosts seeded by the `trusted` egress
   *  preset. Mounted from a Helm-managed ConfigMap.
   *  Empty/missing file → preset is empty (still selectable, just seeds nothing). */
  trustedHostsPath: z.string().default(""),
  /** Directory of chart-shipped agent templates, mounted from a Helm-managed
   *  ConfigMap. One `<id>.yaml` per template. The api-server loads
   *  them once at boot — templates are declarative config that only changes on
   *  a helm upgrade, which restarts the pod. Empty/missing → no templates. */
  agentTemplatesPath: z.string().default(""),
  /** Directory holding the chart-shipped `git-repos.yaml` — the curated
   *  catalog of public repos an agent's working dir can be seeded from.
   *  Boot-loaded like templates; empty/missing → no repos offered. */
  gitReposPath: z.string().default(""),
  /** Hard ceiling for file-import bundle uploads, in bytes. Enforced at the
   *  api-server proxy boundary before any byte reaches agent-runtime, so a
   *  misbehaving client can't fill the PVC. Default 5 GiB — generous enough
   *  to carry a real `.git/` directory while still under the 10 GiB
   *  controller-default agent PVC. Admins on tighter PVCs (the bundled
   *  `claude-code` template ships with a 5 GiB `homeMountSize`) should
   *  lower this via `MAX_IMPORT_BUNDLE_BYTES`. */
  maxImportBundleBytes: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024 * 1024),
  /** Brand presented to end users — display name, slash-command identifier,
   *  and theme accent colors. Surfaced to the UI via `GET /api/brand` and
   *  used internally for OAuth client_name, Slack slash command, skill
   *  publish git author, MCP tool descriptions. The internal codename
   *  ("platform") is permanent; this section is the only knob users see.
   *
   *  Shape comes from `brandSchema` in `api-server-api` so the UI parses
   *  `GET /api/brand` against the same definition. Defaults live in the
   *  env-var input-prep block below — not in the schema — so a malformed
   *  server response cannot silently coerce on the UI side. */
  brand: brandSchema,
  terms: z.object({
    version: z.string().min(1, "terms.version must be set"),
    text: z.string().min(1, "terms.text must be set"),
  }),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
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
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    slackOauthCallbackUrl: process.env.SLACK_OAUTH_CALLBACK_URL,
    telegramEnabled: process.env.TELEGRAM_ENABLED,
    e2eEnabled: process.env.E2E_ENABLED,
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
    agentHome: process.env.AGENT_HOME,
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
    minClientCliVersion: process.env.MIN_CLIENT_CLI_VERSION,
    trustedHostsPath: process.env.TRUSTED_HOSTS_PATH,
    agentTemplatesPath: process.env.AGENT_TEMPLATES_PATH,
    gitReposPath: process.env.GIT_REPOS_PATH,
    maxImportBundleBytes: process.env.MAX_IMPORT_BUNDLE_BYTES,
    brand: {
      name: process.env.BRAND_NAME ?? "Platform",
      short: process.env.BRAND_SHORT ?? "platform",
      tagline: process.env.BRAND_TAGLINE ?? "",
      theme: {
        light: {
          accent: process.env.BRAND_THEME_LIGHT_ACCENT ?? "#1D6BE1",
          accentHover: process.env.BRAND_THEME_LIGHT_ACCENT_HOVER ?? "#1556B8",
          accentLight: process.env.BRAND_THEME_LIGHT_ACCENT_LIGHT ?? "#eaf2fe",
        },
        dark: {
          accent: process.env.BRAND_THEME_DARK_ACCENT ?? "#3C92FD",
          accentHover: process.env.BRAND_THEME_DARK_ACCENT_HOVER ?? "#2F88FD",
          accentLight: process.env.BRAND_THEME_DARK_ACCENT_LIGHT ?? "#0f1f3a",
        },
      },
    },
    terms: {
      version: process.env.TERMS_VERSION,
      text: process.env.TERMS_TEXT,
    },
  });
}
