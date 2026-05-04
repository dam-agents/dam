import { z } from "zod/v4";

const configSchema = z.object({
  namespace: z.string().default("humr-agents"),
  port: z.coerce.number().default(4000),
  harnessServerPort: z.coerce.number().default(4001),
  /** gRPC ext_authz listener — serves both Envoy's HTTP filter (L7,
   *  TLS-terminated chains) and network filter (L4, catch-all). */
  extAuthzPort: z.coerce.number().default(4002),
  databaseUrl: z.string(),
  migrationsPath: z.string().default("./packages/db/drizzle"),
  slackBotToken: z.string().nullable().default(null),
  slackAppToken: z.string().nullable().default(null),
  slackOauthCallbackUrl: z.string().nullable().default(null),
  telegramEnabled: z.coerce.boolean().default(false),
  uiBaseUrl: z.url().default("http://humr.localhost:4444"),
  onecliBaseUrl: z.url().default("http://humr-onecli:10254"),
  onecliExternalUrl: z.string().default(""),
  onecliAudience: z.string().default("onecli"),
  keycloakUrl: z.url().default("http://humr-keycloak:8080"),
  keycloakExternalUrl: z.url().default("http://keycloak.localhost:4444"),
  keycloakRealm: z.string().default("humr"),
  keycloakClientId: z.string().default("humr-ui"),
  keycloakApiAudience: z.string().default("humr-api"),
  keycloakApiClientId: z.string().default("humr-api"),
  keycloakApiClientSecret: z.string().default(""),
  keycloakRequiredRole: z.string().optional(),
  agentHome: z.string().default("/home/agent"),
  /** JSON array of system Skill Sources declared by the cluster admin via
   *  Helm values. Empty/unset means no seed sources. Validated by Zod inside
   *  parseSeedSources at startup — malformed JSON or wrong shape crashes the
   *  pod with a clear stderr. */
  skillSourcesSeed: z.string().default(""),
  // Optional admin-level OAuth app defaults — when set, the connect form
  // for the matching app skips those input fields and the api-server uses
  // the defaults to mint tokens. Mirrors OneCLI's `GITHUB_CLIENT_ID` /
  // `GITHUB_CLIENT_SECRET` knobs so a single admin-registered OAuth app
  // can serve every user on a deployment.
  defaultGithubClientId: z.string().nullable().default(null),
  defaultGithubClientSecret: z.string().nullable().default(null),
  defaultGithubEnterpriseHost: z.string().nullable().default(null),
  defaultGithubEnterpriseClientId: z.string().nullable().default(null),
  defaultGithubEnterpriseClientSecret: z.string().nullable().default(null),
  redisUrl: z.string().nullable().default(null),
  /** Optional Redis AUTH password. The chart provisions a generated
   *  per-release password and binds it via secretKeyRef; standalone dev
   *  setups can leave it unset to point at an unauthenticated instance. */
  redisPassword: z.string().nullable().default(null),
  /** Default hold window for ext_authz HITL (seconds). Helm-configurable;
   *  matches `pending_approvals.expires_at` and the synchronous-hold deadline. */
  approvalHoldSeconds: z.coerce.number().int().positive().default(1800),
  /** Path to a newline-delimited file of hosts seeded by the `trusted` egress
   *  preset (ADR-035). Mounted from a Helm-managed ConfigMap.
   *  Empty/missing file → preset is empty (still selectable, just seeds nothing). */
  trustedHostsPath: z.string().default(""),
  /** Path to a JSON map (`provider → string[]`) of API hosts each app-connection
   *  provider needs to reach. App grants insert one `connection:<id>` egress
   *  rule per host listed here. Empty/missing file → grants insert nothing
   *  (matches pre-ADR-035 behavior). */
  appConnectionEgressHostsPath: z.string().default(""),
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(): Config {
  return configSchema.parse({
    namespace: process.env.NAMESPACE,
    port: process.env.PORT,
    harnessServerPort: process.env.MCP_PORT,
    extAuthzPort: process.env.EXT_AUTHZ_PORT,
    databaseUrl: process.env.DATABASE_URL,
    migrationsPath: process.env.MIGRATIONS_PATH,
    slackBotToken: process.env.SLACK_BOT_TOKEN,
    slackAppToken: process.env.SLACK_APP_TOKEN,
    slackOauthCallbackUrl: process.env.SLACK_OAUTH_CALLBACK_URL,
    telegramEnabled: process.env.TELEGRAM_ENABLED,
    uiBaseUrl: process.env.UI_BASE_URL,
    onecliBaseUrl: process.env.ONECLI_WEB_URL,
    onecliExternalUrl: process.env.ONECLI_EXTERNAL_URL,
    onecliAudience: process.env.ONECLI_AUDIENCE,
    keycloakUrl: process.env.KEYCLOAK_URL,
    keycloakExternalUrl: process.env.KEYCLOAK_EXTERNAL_URL,
    keycloakRealm: process.env.KEYCLOAK_REALM,
    keycloakClientId: process.env.KEYCLOAK_CLIENT_ID,
    keycloakApiAudience: process.env.KEYCLOAK_API_AUDIENCE,
    keycloakApiClientId: process.env.KEYCLOAK_API_CLIENT_ID,
    keycloakApiClientSecret: process.env.KEYCLOAK_API_CLIENT_SECRET,
    keycloakRequiredRole: process.env.KEYCLOAK_REQUIRED_ROLE,
    agentHome: process.env.AGENT_HOME,
    skillSourcesSeed: process.env.SKILL_SOURCES_SEED,
    defaultGithubClientId: process.env.HUMR_DEFAULT_GITHUB_CLIENT_ID,
    defaultGithubClientSecret: process.env.HUMR_DEFAULT_GITHUB_CLIENT_SECRET,
    defaultGithubEnterpriseHost: process.env.HUMR_DEFAULT_GHE_HOST,
    defaultGithubEnterpriseClientId: process.env.HUMR_DEFAULT_GHE_CLIENT_ID,
    defaultGithubEnterpriseClientSecret: process.env.HUMR_DEFAULT_GHE_CLIENT_SECRET,
    redisUrl: process.env.REDIS_URL,
    redisPassword: process.env.REDIS_PASSWORD,
    approvalHoldSeconds: process.env.APPROVAL_HOLD_SECONDS,
    trustedHostsPath: process.env.TRUSTED_HOSTS_PATH,
    appConnectionEgressHostsPath: process.env.APP_CONNECTION_EGRESS_HOSTS_PATH,
  });
}
