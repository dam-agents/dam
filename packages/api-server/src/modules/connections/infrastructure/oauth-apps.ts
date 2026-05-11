/**
 * Static descriptors for the OAuth apps the platform knows how to drive — GitHub.com,
 * GitHub Enterprise, and a Generic app for arbitrary auth-code+PKCE
 * providers. Each descriptor declares the inputs the user must supply at
 * connect time (their own OAuth client id + secret, plus app-specific
 * fields) and a `build` function that turns those inputs into the
 * `OAuthFlowProvider` + `OAuthFlowMetadata` the engine needs.
 *
 * Client credentials live with the user by default — every user registers
 * their own OAuth app at the provider against the platform's callback URL.
 * **Optional admin defaults** (`GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
 * knobs on the api-server) let an operator wire a single platform-registered
 * OAuth app: when a default is configured, the matching field disappears
 * from the connect form and the registry's `build()` uses the default to
 * mint tokens.
 *
 * Cardinality:
 * - **Single-instance** apps (github, github-enterprise) have at most one
 *   connection per user, keyed by the descriptor's `connectionKey`.
 * - **Multi-instance** apps (generic) can have many connections per user;
 *   `connectionKey` is a *prefix* and per-connection keys carry a stable
 *   suffix derived from the upstream host.
 */
import crypto from "node:crypto";
import { z } from "zod";

import { DEFAULT_ENV_PLACEHOLDER, type EnvMapping } from "api-server-api";

import {
  type OAuthFlowMetadata,
  type OAuthFlowProvider,
} from "./oauth-engine.js";

/**
 * Env vars set on agents that grant a GitHub.com or GHE connection. `gh` CLI
 * (and most token-aware GitHub tooling) reads `GH_TOKEN` from the env and
 * sends it as the bearer token; the Envoy sidecar's credential_injector
 * filter rewrites the sentinel placeholder to the real token on outbound
 * requests matching the secret's host pattern.
 */
const GH_TOKEN_ENV_MAPPING: EnvMapping = {
  envName: "GH_TOKEN",
  placeholder: DEFAULT_ENV_PLACEHOLDER,
};

export type GoogleServiceId =
  | "gmail"
  | "google-admin"
  | "google-analytics"
  | "google-calendar"
  | "google-classroom"
  | "google-docs"
  | "google-drive"
  | "google-forms"
  | "google-health"
  | "google-meet"
  | "google-photos"
  | "google-search-console"
  | "google-sheets"
  | "google-slides"
  | "google-tasks"
  | "youtube";

export type OAuthAppId =
  | "github"
  | "github-enterprise"
  | "spotify"
  | "generic"
  | GoogleServiceId;

export interface OAuthAppInputField {
  name: string;
  label: string;
  /** Render as a password input — never echo secret values back to the UI. */
  secret?: boolean;
  placeholder?: string;
  /** Short hint shown beneath the field. */
  helper?: string;
  /**
   * The field is currently covered by a stored value the backend will
   * merge in at submit time (sibling family credentials, admin defaults).
   * The form hides the input behind an "override" toggle ("Use a
   * different app" / "Use different credentials") so the user doesn't
   * have to re-enter what we already have; on submit, the field is
   * dropped unless the override panel is open and the user typed
   * something.
   *
   * Set dynamically — descriptors don't carry it. For inputs that are
   * *intrinsically* optional (no stored fallback, the user may just
   * leave them empty), use `optional` instead.
   */
  overridable?: boolean;
  /**
   * The field may be left empty by the user — there is no stored fallback,
   * just nothing to fill in. The form keeps the input always visible and
   * doesn't count it toward the "Connect" enable check; on submit, the
   * field is dropped if empty and forwarded if filled. Used for the
   * GitHub App `appSlug` input: OAuth Apps don't have one, GitHub Apps do.
   */
  optional?: boolean;
}

export type OAuthAppCardinality = "single" | "multiple";

export interface OAuthAppDescriptor {
  id: OAuthAppId;
  displayName: string;
  description: string;
  /**
   * "single" — at most one connection of this app per user. `connectionKey`
   * matches exactly. "multiple" — many connections per user; `connectionKey`
   * is a prefix and per-connection keys are `<prefix>-<suffix>`.
   */
  cardinality: OAuthAppCardinality;
  /** See `cardinality`. */
  connectionKey: string;
  /** The form fields the UI renders before kicking off the OAuth dance. */
  inputs: OAuthAppInputField[];
  /**
   * Helper link surfaced near the form to walk the user through registering
   * their own OAuth app at the provider.
   */
  registrationUrl?: string;
  /**
   * GitHub App slug (URL-friendly identifier from the app's GitHub URL —
   * `https://github.com/apps/{slug}`). Only meaningful for the github /
   * github-enterprise descriptors when the credentials belong to a GitHub
   * App (not an OAuth App). When set, the platform offers users an
   * installation step after authorization, since GitHub Apps see no private
   * data without an installation. Carried on the descriptor (admin default)
   * and stored on the connection (so the UI can surface a "Manage
   * installation" link later).
   */
  appSlug?: string;
  /**
   * True when an admin has pre-configured a platform-wide default for
   * every required input on this descriptor. The connect form drops the
   * "register your own OAuth app" guidance and the redirect-URI helper,
   * and renders a one-click "Connect" plus an override toggle that
   * unmasks the now-`overridable` inputs.
   */
  defaultsApplied?: boolean;
  /**
   * When set, the connect form runs RFC 8414 / OIDC issuer discovery against
   * the value of the named input field on blur, and auto-fills the
   * `authorizationUrl` and `tokenEndpoint` inputs (if they exist and are
   * empty). Generic uses this; static apps don't need it.
   */
  discoverFromHostField?: string;
  /**
   * Provider quirk: some OAuth providers (notably Spotify since 2024) reject
   * `localhost` as a redirect-URI host but accept `127.0.0.1`. When set, the
   * platform rewrites the `localhost` host to this alias **only when** the
   * platform's `uiBaseUrl` host is exactly `localhost` — production URLs are
   * left alone. Used both for the displayed callback URL on the connect form
   * (so the user registers the right value at the provider) and for the
   * `redirect_uri` sent during the OAuth flow.
   */
  localhostCallbackAlias?: string;
  /**
   * Credential family — descriptors with the same family share OAuth
   * `clientId` / `clientSecret` per user. Once one app in a family is
   * connected, the route layer prunes the credential inputs from siblings
   * and reuses the stored creds during the OAuth flow. Lets the user
   * register one Google Cloud OAuth client and connect Drive, Gmail,
   * Calendar, etc. without re-entering credentials each time.
   */
  credentialFamily?: string;
  /**
   * API egress allowlist this descriptor opens when granted to an agent.
   * Each rule is `{host, pathPattern?}`; multiple rules can target the
   * same host as long as their path patterns differ (e.g. Drive at
   * `www.googleapis.com/drive/*` and Calendar at `/calendar/*`).
   *
   * Static descriptors declare these here; dynamic-host apps (GHE,
   * Generic) leave it undefined — the connections-service falls back to
   * the connection's stored `hostPattern`/`pathPattern` metadata at
   * grant time, since that's where the user-supplied host lives.
   */
  egressHosts?: readonly { host: string; pathPattern?: string }[];
}

export interface BuiltOAuthApp {
  provider: OAuthFlowProvider;
  flow: OAuthFlowMetadata;
  /** The display label the UI uses for this specific connection — for GHE,
   *  carries the host; for Generic, the user-supplied display name. */
  connectionDisplayName: string;
}

const DEFAULT_GITHUB_SCOPES = ["repo", "read:user", "user:email"];

// ---- Google services (gmail + 14 google-*) ----------------------------------
//
// Every Google service uses the same OAuth flow against
// accounts.google.com / oauth2.googleapis.com. The Cloud Console issues one
// `clientId` / `clientSecret` per app project, and the same credential
// authorizes any combination of scopes — so we expose one descriptor per
// service (granular agent grants, brand icons) but mark them all
// `credentialFamily: "google"` so the user enters credentials only once.
//
// Default scopes are stripped down from onecli's permission lists to the
// minimum a typical agent task needs. The OIDC baseline (`openid`, `email`,
// `profile`) is added to every Google service so the api-server can populate
// `metadata.username` from `userinfo` after exchange.

const GOOGLE_BASELINE_SCOPES = ["openid", "email", "profile"];

interface GoogleServiceDef {
  displayName: string;
  description: string;
  /** API host the service routes to (used for Envoy SNI / cred injection). */
  hostPattern: string;
  /** Service-specific scopes; baseline OIDC scopes are added automatically. */
  scopes: string[];
  /**
   * Egress allowlist rules opened when this service is granted to an
   * agent. Mirrors onecli's host_rules table — each rule is the canonical
   * Google API host plus, for services that share `www.googleapis.com`,
   * a path-prefix discriminator. Drive's `/drive/` and `/upload/drive/`
   * coexist with Calendar's `/calendar/` because the path is part of the
   * rule key.
   */
  egressHosts: readonly { host: string; pathPattern?: string }[];
}

const GOOGLE_SERVICES: Record<GoogleServiceId, GoogleServiceDef> = {
  gmail: {
    displayName: "Gmail",
    description: "Read, compose, and send emails via Gmail.",
    hostPattern: "gmail.googleapis.com",
    scopes: [
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
      "https://www.googleapis.com/auth/gmail.send",
    ],
    egressHosts: [
      { host: "gmail.googleapis.com" },
      { host: "www.googleapis.com", pathPattern: "/gmail/*" },
    ],
  },
  "google-admin": {
    displayName: "Google Admin",
    description: "Manage users, groups, and devices in Google Workspace.",
    hostPattern: "admin.googleapis.com",
    scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
    egressHosts: [{ host: "admin.googleapis.com" }],
  },
  "google-analytics": {
    displayName: "Google Analytics",
    description: "Access report data and run analytics queries.",
    hostPattern: "analyticsdata.googleapis.com",
    scopes: ["https://www.googleapis.com/auth/analytics"],
    egressHosts: [{ host: "analyticsdata.googleapis.com" }],
  },
  "google-calendar": {
    displayName: "Google Calendar",
    description: "Read, create, and manage calendar events.",
    hostPattern: "calendar.googleapis.com",
    scopes: [
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ],
    egressHosts: [{ host: "www.googleapis.com", pathPattern: "/calendar/*" }],
  },
  "google-classroom": {
    displayName: "Google Classroom",
    description: "Manage classes, rosters, and invitations.",
    hostPattern: "classroom.googleapis.com",
    scopes: ["https://www.googleapis.com/auth/classroom.courses"],
    egressHosts: [{ host: "classroom.googleapis.com" }],
  },
  "google-docs": {
    displayName: "Google Docs",
    description: "Read, create, and edit Google Docs documents.",
    hostPattern: "docs.googleapis.com",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
    egressHosts: [{ host: "docs.googleapis.com" }],
  },
  "google-drive": {
    displayName: "Google Drive",
    description: "Read, create, and manage files and folders.",
    hostPattern: "www.googleapis.com",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
    egressHosts: [
      { host: "www.googleapis.com", pathPattern: "/drive/*" },
      { host: "www.googleapis.com", pathPattern: "/upload/drive/*" },
    ],
  },
  "google-forms": {
    displayName: "Google Forms",
    description: "Read, create, and edit forms and responses.",
    hostPattern: "forms.googleapis.com",
    scopes: ["https://www.googleapis.com/auth/forms.body"],
    egressHosts: [{ host: "forms.googleapis.com" }],
  },
  "google-health": {
    displayName: "Google Health",
    description:
      "Access activity, sleep, and health metrics from Fitbit and connected devices.",
    hostPattern: "health.googleapis.com",
    scopes: [
      "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
      "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
      "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
    ],
    egressHosts: [{ host: "health.googleapis.com" }],
  },
  "google-meet": {
    displayName: "Google Meet",
    description: "Create and manage meetings.",
    hostPattern: "meet.googleapis.com",
    scopes: ["https://www.googleapis.com/auth/meetings.space.created"],
    egressHosts: [{ host: "meet.googleapis.com" }],
  },
  "google-photos": {
    displayName: "Google Photos",
    description: "Manage photos, videos, and albums.",
    hostPattern: "photoslibrary.googleapis.com",
    scopes: ["https://www.googleapis.com/auth/photoslibrary"],
    egressHosts: [{ host: "photoslibrary.googleapis.com" }],
  },
  "google-search-console": {
    displayName: "Google Search Console",
    description: "View search traffic data and manage site presence.",
    hostPattern: "searchconsole.googleapis.com",
    scopes: ["https://www.googleapis.com/auth/webmasters"],
    egressHosts: [{ host: "searchconsole.googleapis.com" }],
  },
  "google-sheets": {
    displayName: "Google Sheets",
    description: "Read, create, and edit spreadsheets.",
    hostPattern: "sheets.googleapis.com",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
    egressHosts: [{ host: "sheets.googleapis.com" }],
  },
  "google-slides": {
    displayName: "Google Slides",
    description: "Read, create, and edit presentations.",
    hostPattern: "slides.googleapis.com",
    scopes: [
      "https://www.googleapis.com/auth/drive.readonly",
      "https://www.googleapis.com/auth/drive.file",
    ],
    egressHosts: [{ host: "slides.googleapis.com" }],
  },
  "google-tasks": {
    displayName: "Google Tasks",
    description: "Manage task lists and tasks.",
    hostPattern: "tasks.googleapis.com",
    scopes: ["https://www.googleapis.com/auth/tasks"],
    egressHosts: [{ host: "tasks.googleapis.com" }],
  },
  youtube: {
    displayName: "YouTube",
    description: "Manage playlists, videos, and channel content on YouTube.",
    hostPattern: "youtube.googleapis.com",
    scopes: [
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube",
      "https://www.googleapis.com/auth/youtube.force-ssl",
    ],
    egressHosts: [
      { host: "youtube.googleapis.com" },
      { host: "www.googleapis.com", pathPattern: "/youtube/*" },
    ],
  },
};

const GOOGLE_REGISTRATION_URL = "https://console.cloud.google.com/apis/credentials";

function googleService(id: GoogleServiceId): OAuthAppDescriptor {
  const def = GOOGLE_SERVICES[id];
  return {
    id,
    displayName: def.displayName,
    description: def.description,
    cardinality: "single",
    connectionKey: id,
    registrationUrl: GOOGLE_REGISTRATION_URL,
    inputs: [
      {
        name: "clientId",
        label: "Client ID",
        placeholder: "123…apps.googleusercontent.com",
        helper: "From the OAuth client you created in the Google Cloud Console.",
      },
      { name: "clientSecret", label: "Client secret", secret: true, placeholder: "GOCSPX-…" },
    ],
    credentialFamily: "google",
    egressHosts: def.egressHosts,
  };
}

function googleServiceDescriptors(): Record<GoogleServiceId, OAuthAppDescriptor> {
  const ids = Object.keys(GOOGLE_SERVICES) as GoogleServiceId[];
  return Object.fromEntries(ids.map((id) => [id, googleService(id)])) as Record<
    GoogleServiceId,
    OAuthAppDescriptor
  >;
}

const DESCRIPTORS: Record<OAuthAppId, OAuthAppDescriptor> = {
  github: {
    id: "github",
    displayName: "GitHub",
    description: "Connect github.com so agents can call the GitHub API on your behalf.",
    cardinality: "single",
    connectionKey: "github",
    registrationUrl: "https://github.com/settings/applications/new",
    inputs: [
      {
        name: "clientId",
        label: "Client ID",
        placeholder: "Iv1.…",
        helper: "From the OAuth app you registered on github.com.",
      },
      { name: "clientSecret", label: "Client secret", secret: true },
      {
        name: "appSlug",
        label: "GitHub App slug",
        placeholder: "my-platform-app",
        helper:
          "Only for GitHub Apps (not OAuth Apps). The slug from https://github.com/apps/{slug}. When set, users are prompted to install the app after authorizing.",
        optional: true,
      },
    ],
    egressHosts: [{ host: "api.github.com" }, { host: "github.com" }],
  },
  "github-enterprise": {
    id: "github-enterprise",
    displayName: "GitHub Enterprise",
    description: "Connect a GitHub Enterprise host so agents can call its API on your behalf.",
    cardinality: "single",
    connectionKey: "github-enterprise",
    inputs: [
      {
        name: "host",
        label: "Host",
        placeholder: "ghe.example.com",
        helper: "Hostname only — no scheme or trailing slash.",
      },
      { name: "clientId", label: "Client ID" },
      { name: "clientSecret", label: "Client secret", secret: true },
      {
        name: "appSlug",
        label: "GitHub App slug",
        placeholder: "my-platform-app",
        helper:
          "Only for GitHub Apps (not OAuth Apps). The slug from https://{host}/github-apps/{slug}. When set, users are prompted to install the app after authorizing.",
        optional: true,
      },
    ],
  },
  spotify: {
    id: "spotify",
    displayName: "Spotify",
    description:
      "Connect Spotify so agents can read your library and playlists and control playback on your behalf.",
    cardinality: "single",
    connectionKey: "spotify",
    registrationUrl: "https://developer.spotify.com/dashboard",
    inputs: [
      {
        name: "clientId",
        label: "Client ID",
        helper: "From the app you registered in the Spotify developer dashboard.",
      },
      { name: "clientSecret", label: "Client secret", secret: true },
    ],
    // Spotify rejects `localhost` redirect URIs (developer dashboard policy
    // since 2024) but accepts `127.0.0.1`. Reaching the api-server via the
    // catch-all ingress rule on the platform's local-dev cluster.
    localhostCallbackAlias: "127.0.0.1",
    egressHosts: [{ host: "api.spotify.com" }],
  },
  ...googleServiceDescriptors(),
  generic: {
    id: "generic",
    displayName: "Generic OAuth",
    description:
      "Connect any OAuth 2.1 authorization-code provider — supply the auth URL, token endpoint, and your client credentials.",
    cardinality: "multiple",
    connectionKey: "generic",
    discoverFromHostField: "hostPattern",
    inputs: [
      {
        name: "displayName",
        label: "Display name",
        placeholder: "e.g. Linear",
        helper: "Shown in the connections list.",
      },
      {
        name: "hostPattern",
        label: "Host",
        placeholder: "api.example.com",
        helper: "Hostname the credential injects on (no scheme).",
      },
      {
        name: "authorizationUrl",
        label: "Authorization URL",
        placeholder: "https://example.com/oauth/authorize",
      },
      {
        name: "tokenEndpoint",
        label: "Token endpoint",
        placeholder: "https://example.com/oauth/token",
      },
      {
        name: "scopes",
        label: "Scopes",
        placeholder: "openid profile email",
        helper:
          "Space-separated. For OIDC providers, include `offline_access` if you need a refresh token. Leave empty to omit the scope parameter.",
      },
      { name: "clientId", label: "Client ID" },
      { name: "clientSecret", label: "Client secret", secret: true },
    ],
  },
};

// `appSlug` (GitHub App URL slug) follows GitHub's slug rules:
//   - lowercase letters, digits, hyphens
//   - 1–39 characters
//   - no leading or trailing hyphens
//   - no consecutive hyphens
// (Matches the rules GitHub itself enforces when registering an app or
// renaming an account.) Empty string is treated as "not set" so admin
// defaults can pass through `appSlug: ""` without forcing the field on.
//
// Exported so the api-server config can apply the same check to
// admin-default slugs at startup — a misconfigured Helm value should
// crash the pod, not surface as a confusing 400 to the next user who
// tries to connect.
export const APP_SLUG_MAX_LENGTH = 39;
export const APP_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export function isValidAppSlug(value: string): boolean {
  return value.length <= APP_SLUG_MAX_LENGTH && APP_SLUG_RE.test(value);
}

const APP_SLUG_VALIDATION_MESSAGE =
  "App slug must be 1–39 lowercase letters, digits, and single hyphens — no leading, trailing, or consecutive hyphens.";

const appSlugSchema = z
  .string()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : undefined))
  .refine(
    (v) => v === undefined || isValidAppSlug(v),
    APP_SLUG_VALIDATION_MESSAGE,
  );

const githubInputSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
  appSlug: appSlugSchema,
});

const spotifyInputSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
});

const googleInputSchema = z.object({
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
});

/**
 * Default scope set covering reading the user's library/playlists, listening
 * history, and controlling playback. Scoped down to what the typical agent
 * use case ("triage my playlists", "queue this track") needs — avoids
 * `streaming` (Web Playback SDK only) and `ugc-image-upload` (rare).
 *
 * Spotify always returns a refresh token for auth-code flows, so no
 * `offline_access` analogue is required.
 */
const DEFAULT_SPOTIFY_SCOPES = [
  "user-read-private",
  "user-read-email",
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-private",
  "playlist-modify-public",
  "user-library-read",
  "user-library-modify",
  "user-top-read",
  "user-read-recently-played",
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
];

// RFC 1123 subdomain — same shape K8s names accept. Used both directly as a
// host and as input to Envoy SNI matching, so we apply it strictly here.
const HOSTNAME_RE =
  /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

const gheInputSchema = z.object({
  host: z
    .string()
    .min(1, "Host is required")
    .regex(HOSTNAME_RE, "Host must be a valid DNS hostname (no scheme)."),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  appSlug: appSlugSchema,
});

const httpsUrlSchema = z
  .string()
  .min(1)
  .refine((v) => /^https:\/\//.test(v), "Must be an https:// URL.");

const genericInputSchema = z.object({
  displayName: z.string().min(1, "Display name is required").max(80),
  hostPattern: z
    .string()
    .min(1, "Host is required")
    .regex(HOSTNAME_RE, "Host must be a valid DNS hostname (no scheme)."),
  authorizationUrl: httpsUrlSchema,
  tokenEndpoint: httpsUrlSchema,
  scopes: z.string().optional().default(""),
  clientId: z.string().min(1, "Client ID is required"),
  clientSecret: z.string().min(1, "Client secret is required"),
});

export type GithubInput = z.infer<typeof githubInputSchema>;
export type GheInput = z.infer<typeof gheInputSchema>;
export type SpotifyInput = z.infer<typeof spotifyInputSchema>;
export type GoogleInput = z.infer<typeof googleInputSchema>;
export type GenericInput = z.infer<typeof genericInputSchema>;

/**
 * Optional platform-wide defaults for OAuth app credentials. When a field
 * is set, the connect form's matching input is collapsed behind an
 * "override" toggle and `build()` uses the default. Fields the admin
 * doesn't set are still required from the user.
 *
 * `appSlug` is the GitHub App slug — when supplied alongside the OAuth
 * client credentials, the connection flow recognises that the credentials
 * belong to a GitHub App (not an OAuth App) and offers an installation
 * step after authorization.
 */
export interface OAuthAppDefaults {
  github?: {
    clientId?: string;
    clientSecret?: string;
    appSlug?: string;
  };
  githubEnterprise?: {
    host?: string;
    clientId?: string;
    clientSecret?: string;
    appSlug?: string;
  };
}

export interface OAuthAppRegistry {
  list(): OAuthAppDescriptor[];
  get(id: string): OAuthAppDescriptor | null;
  /**
   * Validate user-supplied form input against the app's schema and produce
   * the engine inputs. Throws on validation failure — caller maps to a 400.
   */
  build(id: OAuthAppId, rawInput: unknown): BuiltOAuthApp;
}

/**
 * Compute the OAuth callback URL for a given app, applying the
 * `localhostCallbackAlias` provider quirk when the platform's `uiBaseUrl`
 * host is exactly `localhost`. The scheme, port, and path are preserved;
 * only the host is swapped. Production URLs (any host other than
 * `localhost`) pass through unchanged.
 */
export function callbackUrlForApp(
  descriptor: OAuthAppDescriptor,
  uiBaseUrl: string,
): string {
  const base = descriptor.localhostCallbackAlias
    ? rewriteLocalhostHost(uiBaseUrl, descriptor.localhostCallbackAlias)
    : uiBaseUrl;
  return `${base}/api/oauth/callback`;
}

// Match `localhost` as a complete host label so we never rewrite hostnames
// like `localhost.example.com`. Anchored at the scheme so query strings and
// path segments containing the literal "localhost" are left alone.
function rewriteLocalhostHost(url: string, alias: string): string {
  return url.replace(/^(https?:\/\/)localhost(?=:|\/|$)/, `$1${alias}`);
}

/**
 * Returns true when the given stored connection key belongs to this
 * descriptor. Single-instance apps match exactly; multi-instance apps
 * match by `<prefix>-<…>` shape.
 */
export function matchesAppConnection(
  descriptor: OAuthAppDescriptor,
  connectionKey: string,
): boolean {
  if (descriptor.cardinality === "single") {
    return connectionKey === descriptor.connectionKey;
  }
  return (
    connectionKey === descriptor.connectionKey ||
    connectionKey.startsWith(`${descriptor.connectionKey}-`)
  );
}

function buildGithub(input: GithubInput): BuiltOAuthApp {
  return {
    provider: {
      id: "github",
      authorizationUrl: "https://github.com/login/oauth/authorize",
      tokenEndpoint: "https://github.com/login/oauth/access_token",
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      scopes: DEFAULT_GITHUB_SCOPES,
      tokenEndpointAcceptJson: true,
    },
    flow: {
      connectionKey: "github",
      hostPattern: "api.github.com",
      displayName: "GitHub",
      envMappings: [GH_TOKEN_ENV_MAPPING],
      ...(input.appSlug ? { appSlug: input.appSlug } : {}),
    },
    connectionDisplayName: "GitHub",
  };
}

function buildGhe(input: GheInput): BuiltOAuthApp {
  const host = input.host;
  return {
    provider: {
      id: "github-enterprise",
      authorizationUrl: `https://${host}/login/oauth/authorize`,
      tokenEndpoint: `https://${host}/login/oauth/access_token`,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      scopes: DEFAULT_GITHUB_SCOPES,
      tokenEndpointAcceptJson: true,
    },
    flow: {
      // Single GHE per user for now — connecting a different GHE host
      // replaces the previous one. Multi-host GHE (key on host hash) is a
      // follow-up.
      connectionKey: "github-enterprise",
      hostPattern: host,
      displayName: `GitHub Enterprise (${host})`,
      // GH_HOST is a literal config value (the user's enterprise host), not a
      // sentinel — `gh` CLI uses it to direct API calls to the right server.
      envMappings: [
        GH_TOKEN_ENV_MAPPING,
        { envName: "GH_HOST", placeholder: host },
      ],
      ...(input.appSlug ? { appSlug: input.appSlug } : {}),
    },
    connectionDisplayName: `GitHub Enterprise (${host})`,
  };
}

function buildSpotify(input: SpotifyInput): BuiltOAuthApp {
  return {
    provider: {
      id: "spotify",
      authorizationUrl: "https://accounts.spotify.com/authorize",
      tokenEndpoint: "https://accounts.spotify.com/api/token",
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      scopes: DEFAULT_SPOTIFY_SCOPES,
      tokenEndpointAcceptJson: true,
    },
    flow: {
      connectionKey: "spotify",
      hostPattern: "api.spotify.com",
      displayName: "Spotify",
    },
    connectionDisplayName: "Spotify",
  };
}

function buildGoogleService(id: GoogleServiceId, input: GoogleInput): BuiltOAuthApp {
  const def = GOOGLE_SERVICES[id];
  return {
    provider: {
      id,
      authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenEndpoint: "https://oauth2.googleapis.com/token",
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      scopes: [...GOOGLE_BASELINE_SCOPES, ...def.scopes],
      tokenEndpointAcceptJson: true,
      // Google won't return a refresh_token without these. `prompt=consent`
      // forces a re-prompt on every connect, which we want — sibling Google
      // services connect with different scope sets, so the user must approve
      // each scope expansion.
      extraAuthParams: { access_type: "offline", prompt: "consent" },
    },
    flow: {
      connectionKey: id,
      hostPattern: def.hostPattern,
      displayName: def.displayName,
    },
    connectionDisplayName: def.displayName,
  };
}

function genericConnectionKey(hostPattern: string): string {
  // Connection key derived from hostPattern so reconnecting the same host
  // updates the existing K8s Secret in place. Different hosts → different
  // keys → independent connections.
  const hash = crypto.createHash("sha1").update(hostPattern).digest("hex").slice(0, 16);
  return `generic-${hash}`;
}

function buildGeneric(input: GenericInput): BuiltOAuthApp {
  const scopes = input.scopes
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    provider: {
      id: "generic",
      authorizationUrl: input.authorizationUrl,
      tokenEndpoint: input.tokenEndpoint,
      clientId: input.clientId,
      clientSecret: input.clientSecret,
      ...(scopes.length > 0 ? { scopes } : {}),
      // `Accept: application/json` is a safe default — providers that don't
      // honor it return JSON anyway, and the few that fall back to
      // form-encoded are caught by the engine's lenient parser.
      tokenEndpointAcceptJson: true,
    },
    flow: {
      connectionKey: genericConnectionKey(input.hostPattern),
      hostPattern: input.hostPattern,
      displayName: input.displayName,
    },
    connectionDisplayName: input.displayName,
  };
}

/**
 * Returns a copy of the descriptor with inputs covered by `defaultsForApp`
 * marked `overridable: true` (so the connect form collapses them behind
 * an override toggle) and the descriptor flagged with `appSlug` /
 * `defaultsApplied` when the admin has wired a platform-wide default app.
 *
 * We don't prune the inputs outright: the connect form needs to know which
 * fields are *available* to override, even when none of them are required
 * for the happy path.
 */
function decorateDescriptorWithDefaults(
  descriptor: OAuthAppDescriptor,
  defaultsForApp: Record<string, string | undefined>,
): OAuthAppDescriptor {
  const hasAnyDefault = Object.values(defaultsForApp).some(
    (v) => v !== undefined && v !== "",
  );
  if (!hasAnyDefault) return descriptor;
  const inputs = descriptor.inputs.map((input) =>
    defaultsForApp[input.name]
      ? { ...input, overridable: true as const }
      : input,
  );
  // "All required inputs are admin-defaulted" — the form can render the
  // connect button without asking the user for anything. `optional`
  // inputs (e.g. appSlug) don't count: they're intrinsically optional, so
  // the form is fully fillable whether or not the admin set them.
  const requiredInputs = inputs.filter((i) => !i.overridable && !i.optional);
  const defaultsApplied = requiredInputs.length === 0;
  const defaultedAppSlug = defaultsForApp.appSlug;
  return {
    ...descriptor,
    inputs,
    ...(defaultsApplied ? { defaultsApplied: true as const } : {}),
    ...(defaultedAppSlug ? { appSlug: defaultedAppSlug } : {}),
  };
}

function defaultsObject(
  descriptor: OAuthAppDescriptor,
  defaults: OAuthAppDefaults,
): Record<string, string | undefined> {
  if (descriptor.id === "github") {
    return {
      clientId: defaults.github?.clientId,
      clientSecret: defaults.github?.clientSecret,
      appSlug: defaults.github?.appSlug,
    };
  }
  if (descriptor.id === "github-enterprise") {
    return {
      host: defaults.githubEnterprise?.host,
      clientId: defaults.githubEnterprise?.clientId,
      clientSecret: defaults.githubEnterprise?.clientSecret,
      appSlug: defaults.githubEnterprise?.appSlug,
    };
  }
  return {};
}

export function createOAuthAppRegistry(
  defaults: OAuthAppDefaults = {},
): OAuthAppRegistry {
  const decorated: OAuthAppDescriptor[] = Object.values(DESCRIPTORS).map((d) =>
    decorateDescriptorWithDefaults(d, defaultsObject(d, defaults)),
  );
  const byId = new Map(decorated.map((d) => [d.id, d]));

  /**
   * Merge admin defaults with user-supplied input before validation.
   * User input wins when both are present so a user can still override
   * a default if the descriptor still surfaces the field.
   */
  function withDefaults(id: OAuthAppId, rawInput: unknown): unknown {
    const base = defaultsObject(DESCRIPTORS[id], defaults);
    const user = (rawInput && typeof rawInput === "object" ? rawInput : {}) as Record<string, unknown>;
    const merged: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(base)) if (v != null) merged[k] = v;
    for (const [k, v] of Object.entries(user)) if (v !== undefined) merged[k] = v;
    return merged;
  }

  return {
    list: () => decorated,
    get: (id: string) => byId.get(id as OAuthAppId) ?? null,
    build: (id, rawInput) => {
      const merged = withDefaults(id, rawInput);
      if (id === "github") return buildGithub(githubInputSchema.parse(merged));
      if (id === "github-enterprise") return buildGhe(gheInputSchema.parse(merged));
      if (id === "spotify") return buildSpotify(spotifyInputSchema.parse(merged));
      if (id === "generic") return buildGeneric(genericInputSchema.parse(merged));
      if (id in GOOGLE_SERVICES) {
        return buildGoogleService(id as GoogleServiceId, googleInputSchema.parse(merged));
      }
      throw new Error(`unknown app id: ${id as string}`);
    },
  };
}
