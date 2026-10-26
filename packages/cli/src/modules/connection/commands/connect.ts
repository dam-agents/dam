import { isCancel, password, text } from "@clack/prompts";
import { Command, Option } from "commander";
import type {
  ConnectionCreateInput,
  ConnectionTemplateInput,
  ConnectionTemplateView,
  CredentialCheck,
  SecretlessConnectionCreateInput,
} from "api-server-api";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { BrowserOpener } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { pollUntil } from "../../shared/poll.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { exitCancelled } from "../../shared/prompt.js";
import {
  type ConfigFlagError,
  resolveConfigInputFlags,
} from "../domain/config-inputs.js";
import { credentialCheckWarning } from "../domain/credential-check.js";
import {
  connectFromHint,
  freeConnectionName,
  nonParentNames,
  splitsIntoParent,
} from "../domain/github-parent.js";
import {
  FULL_ACCESS_CONFLICT,
  hasScopeFlags,
  isGitHubUserTokenTemplate,
  scopeOf,
  scopeOfSent,
  sentReach,
} from "../domain/github-scope.js";
import type { ConnectionService } from "../services/connection-service.js";
import {
  choosesReach,
  connectFrom,
  emitMadeConnection,
  emitParentOnly,
  type ChildScopeInput,
  makeConnection,
  makeConnectionFailure,
  readBackFailure,
  validateName,
} from "./connect-from.js";
import { enterSecretOnPage, PAGE_SECRET_FIELDS } from "./secret-page.js";

const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_SECONDS = 300;
const SECRETS_GROUP = "Secrets (for scripts; agents leave these out):";

interface ConnectOpts {
  name?: string;
  auth?: string;
  url?: string;
  host?: string;
  clientId?: string;
  clientSecret?: string;
  issuerUrl?: string;
  scopes?: string;
  audience?: string;
  appSlug?: string;
  appId?: string;
  installationId?: string;
  privateKey?: string;
  account?: string;
  repositories?: string;
  repositoryIds?: string;
  permissions?: string;
  fullAccess?: boolean;
  from?: string;
  headerName?: string;
  valueFormat?: string;
  envName?: string;
  value?: string;
  caData?: string;
  endpoint?: string;
  region?: string;
  bucket?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  config?: string[];
  server?: string;
  json?: boolean;
  browser?: boolean;
  prompt?: boolean;
  timeout?: string;
}

export function buildConnectCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
  browserOpener: BrowserOpener;
}): Command {
  return new Command("connect")
    .description(
      "Create a connection from a provider template or MCP server, or from a GitHub sign-in or installation",
    )
    .argument(
      "[provider-or-url]",
      "a provider template id (see `dam connection templates`) or an MCP server URL (https://…); left out with --from",
    )
    .option(
      "--from <sign-in>",
      "make a connection from an existing GitHub sign-in or GitHub App installation (id or name), " +
        "next to those made from it; takes the scope flags or --full-access",
    )
    .option(
      "--name <name>",
      "connection name (default: slug of the template name, or the MCP server host; " +
        "a GitHub sign-in or installation and its first connection share it, with -2, -3, … when it is taken; " +
        "with --from, the sign-in's or installation's name, with -2, -3, … when a connection has it)",
    )
    .option(
      "--auth <mode>",
      "MCP auth mode: oauth | none (default: auto-detect from the server)",
    )
    .option("--url <url>", "input: url")
    .option("--host <host>", "input: host")
    .option("--client-id <id>", "input: OAuth client id")
    .addOption(
      new Option(
        "--client-secret <secret>",
        "input: OAuth client secret (client credentials: omit to enter it on a DAM web page)",
      ).helpGroup(SECRETS_GROUP),
    )
    .option(
      "--issuer-url <url>",
      "input: OAuth issuer URL — the token endpoint is discovered from its metadata (client credentials)",
    )
    .option(
      "--scopes <scopes>",
      "input: OAuth scopes, space- or comma-separated (client credentials)",
    )
    .option(
      "--audience <audience>",
      "input: OAuth audience (client credentials)",
    )
    .option("--app-slug <slug>", "input: GitHub App slug")
    .option("--app-id <id>", "input: GitHub App ID (GitHub App installation)")
    .option(
      "--installation-id <id>",
      "input: GitHub App installation ID (GitHub App installation)",
    )
    .addOption(
      new Option(
        "--private-key <pem>",
        "input: GitHub App private key, PEM or base64 — omit to enter it on a DAM web page (GitHub App installation)",
      ).helpGroup(SECRETS_GROUP),
    )
    .option(
      "--account <login>",
      "limit the connection made from a GitHub sign-in to the app's installation on this user or organization, after consent (GitHub)",
    )
    .option(
      "--repositories <names>",
      "limit the connection to these repository names, space- or comma-separated (GitHub, GitHub App installation)",
    )
    .option(
      "--repository-ids <ids>",
      "limit the connection to these numeric repository ids; takes precedence over --repositories (GitHub, GitHub App installation)",
    )
    .option(
      "--permissions <pairs>",
      "limit the connection to these name:level permissions, e.g. contents:read (GitHub, GitHub App installation)",
    )
    .option(
      "--full-access",
      "let the connection reach everything the GitHub sign-in or installation reaches: " +
        "every account, repository and permission (GitHub, GitHub App installation)",
    )
    .option("--header-name <name>", "input: header name")
    .option("--value-format <format>", "input: header value format")
    .option(
      "--env-name <name>",
      "input: expose the credential to the agent as this env var (custom header credentials)",
    )
    .addOption(
      new Option(
        "--value <value>",
        "input: header secret value (header credentials: omit to enter it on a DAM web page)",
      ).helpGroup(SECRETS_GROUP),
    )
    .option(
      "--ca-data <data>",
      "input: upstream CA certificate — PEM or base64 (a kubeconfig's certificate-authority-data)",
    )
    .option(
      "--endpoint <url>",
      "input: S3-compatible endpoint URL, https:// and host only (Object Storage)",
    )
    .option(
      "--region <region>",
      "input: signing region (Object Storage; IBM COS accepts any value)",
    )
    .option(
      "--bucket <name>",
      "input: limit the agent to this bucket (Object Storage)",
    )
    .addOption(
      new Option(
        "--access-key-id <id>",
        "input: HMAC access key ID — omit both keys to enter them on a DAM web page (Object Storage)",
      ).helpGroup(SECRETS_GROUP),
    )
    .addOption(
      new Option(
        "--secret-access-key <key>",
        "input: HMAC secret access key — omit both keys to enter them on a DAM web page (Object Storage)",
      ).helpGroup(SECRETS_GROUP),
    )
    .option(
      "-c, --config <key=value>",
      "set an optional template config input (e.g. -c model=premium-shell), repeatable",
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option(
      "--json",
      "emit { ok, id, status, authKind, presetsApplied?, scope?, check? } as JSON; " +
        "a connection made from a GitHub sign-in or installation adds name and parentId (the sign-in's or installation's id), " +
        "and a sign-in or installation kept alone has isParent: true and available, what it reaches; " +
        "check { status: passed|failed|unchecked, account?, expiresAt?, scopes?, installedOn?, repositories?, repositoriesTruncated?, reason?, at } is the token check",
    )
    .option(
      "--no-browser",
      "print the authorize or secret-entry link instead of opening it",
    )
    .option(
      "--prompt",
      "ask for a missing secret at a hidden terminal prompt instead of on a web page",
    )
    .option(
      "--timeout <seconds>",
      "how long to wait for OAuth authorization or for the secret to be entered",
      String(DEFAULT_TIMEOUT_SECONDS),
    )
    .addHelpText(
      "after",
      "\nA GitHub sign-in (github, github-enterprise) or GitHub App installation\n" +
        "(github-app, github-enterprise-app) holds the credential and is never granted\n" +
        "to an agent. Agents are granted the connections made from it, each with its own\n" +
        "scope: the scope flags, or --full-access for everything the sign-in or\n" +
        "installation reaches. Without either, the command keeps the sign-in or\n" +
        "installation alone and shows what it reaches; --from makes a connection from\n" +
        "it then, and another one next to those it has.\n" +
        "\nA missing secret (token, API key, client secret, private key, key pair)\n" +
        "is entered on a DAM web page: the command opens it, waits until the\n" +
        "secret is saved, and reports the result. The page shows where the secret\n" +
        "will be sent, and takes a multi-line PEM key. Sign in there as the same\n" +
        "user. Pass --prompt to type it at a hidden terminal prompt instead.\n" +
        "\nExamples:\n" +
        "  dam connection connect github   # the sign-in alone, and what it reaches\n" +
        "  dam connection connect github --account acme --repositories api,web \\\n" +
        "      --permissions contents:read,pull_requests:write\n" +
        "  dam connection connect github --full-access --no-browser\n" +
        "  dam connection connect --from github --account acme --repositories docs --name github-docs\n" +
        "  dam connection connect github-pat   # the token is entered on a DAM web page\n" +
        "  dam connection connect custom-header --host api.example.com \\\n" +
        "      --header-name X-API-Key --value-format '{value}'   # the key, on the page\n" +
        "  dam connection connect custom-client-credentials --host api.example.com \\\n" +
        "      --issuer-url https://auth.example.com/realms/main --client-id my-client \\\n" +
        "      --header-name Authorization --value-format 'Bearer {value}'\n" +
        "  dam connection connect github-app --app-id 123456 --installation-id 987654 \\\n" +
        "      --repositories api --permissions contents:read\n" +
        "  dam connection connect github-enterprise-app --host ghe.acme.com \\\n" +
        "      --app-id 123456 --installation-id 987654   # the private key, on the page\n" +
        "  dam connection connect bob --config model=premium-shell --config chatMode=agent\n" +
        "  dam connection connect s3-compatible --endpoint https://s3.us-south.cloud-object-storage.appdomain.cloud \\\n" +
        "      --bucket my-bucket   # both keys, on the page\n" +
        "  dam connection connect https://mcp.example.com\n" +
        "  dam connection connect https://mcp.example.com --auth none\n" +
        "\nThe secret flags are for scripts with nobody at a browser, which read the\n" +
        "secret from their environment; an agent leaves them out:\n" +
        '  dam connection connect github-pat --value "$GITHUB_TOKEN" --json\n' +
        "The client secret of your own OAuth app has no page: the user passes it\n" +
        "in a terminal of their own:\n" +
        "  dam connection connect github --client-id Iv1.… --client-secret …\n",
    )
    .action(async (providerOrUrl: string | undefined, opts: ConnectOpts) => {
      const json = opts.json ?? false;

      const timeoutSeconds = parseTimeout(opts.timeout);
      if (timeoutSeconds === null) {
        process.stderr.write("error: --timeout must be a positive integer\n");
        process.exit(EXIT_INVALID_INPUT);
      }
      if (opts.fullAccess && hasScopeFlags(opts)) {
        process.stderr.write(`error: ${FULL_ACCESS_CONFLICT}\n`);
        process.exit(EXIT_INVALID_INPUT);
      }

      if (opts.from !== undefined) {
        if (providerOrUrl !== undefined) {
          process.stderr.write(
            "error: pass a provider or --from, not both; --from makes a connection from an existing GitHub sign-in or installation\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        const host = await resolveActiveHost(deps, opts.server);
        return connectFrom({
          svc: deps.createConnectionService(host),
          host,
          ref: opts.from,
          name: opts.name,
          choice: opts,
          json,
        });
      }
      if (providerOrUrl === undefined) {
        process.stderr.write(
          "error: pass a provider template id or an MCP server URL, or --from <sign-in or installation>\n" +
            "hint: run `dam connection templates` to see the available providers\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const authOverride = parseAuthMode(opts.auth);

      const host = await resolveActiveHost(deps, opts.server);
      const svc = deps.createConnectionService(host);

      const templatesRes = await svc.listTemplates();
      exitOnServiceError(templatesRes, host);
      const templates = templatesRes.value;

      const mcpUrl = parseHttpUrl(providerOrUrl);
      const resolved = mcpUrl
        ? await resolveMcpTemplate({
            svc,
            url: providerOrUrl,
            mcpUrl,
            templates,
            opts,
            authOverride,
            json,
            host,
          })
        : await resolveSlugTemplate({
            templates,
            appId: providerOrUrl,
            opts,
            json,
          });
      const { template, values, presetsApplied, secretOnPage } = resolved;
      const github = splitsIntoParent(template);
      const name = github
        ? await gitHubName(svc, host, resolved.name, opts)
        : resolved.name;

      const configRes = resolveConfigInputFlags(template, opts.config ?? []);
      if (!configRes.ok) {
        process.stderr.write(
          `error: ${formatConfigFlagError(configRes.error)}\n`,
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const payload = buildPayload(
        template,
        name,
        {
          ...values,
          ...configRes.value,
          ...(secretOnPage ? pagePlaceholders(template) : {}),
        },
        opts.fullAccess === true,
      );
      if ("error" in payload) {
        process.stderr.write(`error: ${payload.error}\n`);
        process.exit(EXIT_INVALID_INPUT);
      }

      if (
        template.id === "kubernetes" &&
        payload.authKind === "header" &&
        !payload.caData &&
        values.host &&
        !checkClusterTrust(await svc.probeClusterCa(values.host), values.host)
      ) {
        process.exit(EXIT_INVALID_INPUT);
      }

      const presetNames = presetsApplied.map((i) => i.name);
      if (secretOnPage) {
        if (!json && presetNames.length > 0) {
          const fields = presetsApplied.map((i) => labelFor(i.name)).join(", ");
          process.stderr.write(
            `Using preset values (${fields}). Pass ${flagListFor(presetsApplied)} to use your own.\n`,
          );
        }
        const entered = await enterSecretOnPage({
          svc,
          host,
          browserOpener: deps.browserOpener,
          input: { action: "create", connection: withoutSecret(payload) },
          noBrowser: opts.browser === false,
          timeoutSeconds,
        });
        if (entered.kind === "saved") {
          await emitCreated({
            svc,
            json,
            github,
            name,
            id: entered.connectionId,
            authKind: template.authKind,
            presetsApplied: presetNames,
            sent: sentAppScope(payload),
            ...(entered.check ? { check: entered.check } : {}),
          });
          process.exit(EXIT_SUCCESS);
        }
        process.stderr.write(
          "note: this server has no secret-entry page; asking here instead\n",
        );
        const typed = await promptMissing(
          template,
          secretInputsOf(template),
          json,
        );
        Object.assign(payload, typed);
      }

      const createRes = await svc.createConnection(payload);
      exitOnServiceError(createRes, host);
      const { id } = createRes.value;

      if (!json && !secretOnPage && presetNames.length > 0) {
        const fields = presetsApplied.map((i) => labelFor(i.name)).join(", ");
        process.stderr.write(
          `Using preset values (${fields}). Pass ${flagListFor(presetsApplied)} to use your own.\n`,
        );
      }

      if (template.authKind !== "oauth") {
        await emitCreated({
          svc,
          json,
          github,
          name,
          id,
          authKind: template.authKind,
          presetsApplied: presetNames,
          sent: sentAppScope(payload),
        });
        process.exit(EXIT_SUCCESS);
      }

      const oauthRes = await svc.startOAuth(id);
      exitOnServiceError(oauthRes, host);
      const { authUrl } = oauthRes.value;

      const noBrowser = opts.browser === false;
      if (noBrowser) {
        process.stderr.write(`Open this URL to authorize:\n  ${authUrl}\n`);
      } else {
        const opened = await deps.browserOpener.open(authUrl);
        if (!opened.ok) {
          process.stderr.write(
            `Couldn't open a browser. Open this URL to authorize:\n  ${authUrl}\n`,
          );
        }
      }
      process.stderr.write("Waiting for authorization…\n");

      const active = await pollUntil(() => svc.getConnection(id), {
        timeoutSeconds,
        intervalMs: POLL_INTERVAL_MS,
        until: (res) => res.ok && res.value?.status === "active",
      });
      if (!active) {
        process.stderr.write(
          `error: couldn't confirm the connection finished within ${timeoutSeconds}s; ` +
            "it may still complete — check `dam connection list`\n",
        );
        process.exit(EXIT_RUNTIME_FAILURE);
      }

      if (!github) {
        emitSuccess({
          json,
          verb: "Connected",
          name,
          id,
          authKind: "oauth",
          presetsApplied: presetNames,
          ...(noBrowser ? { authUrl } : {}),
        });
        process.exit(EXIT_SUCCESS);
      }

      const signIn = { id, name, authKind: "oauth" as const };
      if (!choosesReach(opts)) {
        await emitParentOnly({
          svc,
          json,
          verb: "Connected",
          parent: signIn,
          presetsApplied: presetNames,
          ...(noBrowser ? { authUrl } : {}),
        });
        process.exit(EXIT_SUCCESS);
      }

      const made = await makeConnection(
        svc,
        { id, kind: "github-user-token" },
        name,
        opts,
      );
      if (!made.ok) {
        process.stderr.write(
          `error: signed in, but couldn't make a connection from the GitHub sign-in ${name} (${id}): ` +
            `${makeConnectionFailure(made.error)}\n` +
            "  No agent can use the sign-in until a connection is made from it:\n" +
            connectFromHint(signIn) +
            `  or remove the sign-in with \`dam connection disconnect ${id}\`.\n`,
        );
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      const after = await svc.getConnection(made.value.id);
      const view = after.ok ? after.value : null;
      const failure = readBackFailure(after);
      emitMadeConnection({
        json,
        verb: "Connected",
        id: made.value.id,
        name,
        parent: signIn,
        kind: "github-user-token",
        scope: (view && scopeOf(view)) ?? scopeOfSent(made.value.sent),
        presetsApplied: presetNames,
        ...(noBrowser ? { authUrl } : {}),
        ...(failure ? { readBackFailure: failure } : {}),
      });
      process.exit(EXIT_SUCCESS);
    });
}

interface ResolvedConnection {
  template: ConnectionTemplateView;
  name: string;
  values: Record<string, string>;
  presetsApplied: ConnectionTemplateInput[];
  secretOnPage: boolean;
}

async function resolveSlugTemplate(args: {
  templates: readonly ConnectionTemplateView[];
  appId: string;
  opts: ConnectOpts;
  json: boolean;
}): Promise<ResolvedConnection> {
  const { templates, appId, opts, json } = args;
  const template = templates.find((t) => t.id === appId);
  if (!template) {
    process.stderr.write(`error: unknown provider id '${appId}'\n`);
    process.stderr.write(
      "hint: run `dam connection templates` to see the available providers\n",
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  if (template.category === "mcp") {
    process.stderr.write(
      "error: to connect an MCP server, pass its URL:\n" +
        "  dam connection connect https://your-mcp-server\n",
    );
    process.exit(EXIT_INVALID_INPUT);
  }

  for (const flag of [
    "repositories",
    "repositoryIds",
    "permissions",
  ] as const) {
    if (
      opts[flag] &&
      !isGitHubUserTokenTemplate(template.id) &&
      !template.inputs.some((i) => i.name === flag)
    ) {
      process.stderr.write(
        `error: this server does not support --${camelToKebab(flag)} for '${template.id}' — ` +
          "the token would carry the installation's full authority\n",
      );
      process.exit(EXIT_INVALID_INPUT);
    }
  }

  if (opts.account !== undefined && !isGitHubUserTokenTemplate(template.id)) {
    process.stderr.write(
      `error: --account applies only to a GitHub sign-in (github, github-enterprise), not '${template.id}'\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }

  if (opts.fullAccess && !splitsIntoParent(template)) {
    process.stderr.write(
      "error: --full-access applies only to a GitHub sign-in or GitHub App installation " +
        `(github, github-enterprise, github-app, github-enterprise-app), not '${template.id}'\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }

  const name = (opts.name ?? slugifyTemplateName(template.name)).trim();
  validateName(name);
  const collected = await collectInputs(template, opts, json);
  return { template, name, ...collected };
}

async function resolveMcpTemplate(args: {
  svc: ConnectionService;
  url: string;
  mcpUrl: URL;
  templates: readonly ConnectionTemplateView[];
  opts: ConnectOpts;
  authOverride: "oauth" | "none" | undefined;
  json: boolean;
  host: string;
}): Promise<ResolvedConnection> {
  const { svc, url, mcpUrl, templates, opts, authOverride, json, host } = args;

  let auth = authOverride;
  if (!auth) {
    const res = await svc.discoverMcp(url);
    exitOnServiceError(res, host);
    auth = res.value.auth;
  }

  const templateId = auth === "oauth" ? "custom-mcp-oauth" : "custom-mcp-none";
  const template = templates.find((t) => t.id === templateId);
  if (!template) {
    process.stderr.write(
      `error: built-in template '${templateId}' is missing from the catalog\n`,
    );
    process.exit(EXIT_RUNTIME_FAILURE);
  }

  const name = await resolveMcpName(mcpUrl, opts, json);
  validateName(name);
  return {
    template,
    name,
    values: { url },
    presetsApplied: [],
    secretOnPage: false,
  };
}

async function resolveMcpName(
  url: URL,
  opts: ConnectOpts,
  json: boolean,
): Promise<string> {
  if (opts.name !== undefined) return opts.name.trim();
  const derived = deriveMcpName(url);
  if (!process.stdin.isTTY) {
    if (!derived) {
      process.stderr.write(
        "error: couldn't derive a name from the URL — pass --name\n",
      );
      process.exit(EXIT_INVALID_INPUT);
    }
    return derived;
  }
  const answer = await text({
    message: "Connection name",
    initialValue: derived,
    placeholder: derived || "my-mcp-server",
    validate: (v) => (v && v.trim().length > 0 ? undefined : "Required"),
  });
  if (isCancel(answer)) exitCancelled({ json });
  return String(answer).trim();
}

async function gitHubName(
  svc: ConnectionService,
  host: string,
  base: string,
  opts: ConnectOpts,
): Promise<string> {
  const listed = await svc.list();
  exitOnServiceError(listed, host);
  if (opts.name === undefined) {
    return freeConnectionName(new Set(listed.value.map((c) => c.name)), base);
  }
  if (choosesReach(opts) && nonParentNames(listed.value).has(base)) {
    process.stderr.write(
      `error: a connection named '${base}' exists; pass another --name\n`,
    );
    process.exit(EXIT_INVALID_INPUT);
  }
  return base;
}

interface CollectedInputs {
  values: Record<string, string>;
  presetsApplied: ConnectionTemplateInput[];
  secretOnPage: boolean;
}

async function collectInputs(
  template: ConnectionTemplateView,
  opts: ConnectOpts,
  json: boolean,
): Promise<CollectedInputs> {
  const flags = opts as unknown as Record<string, unknown>;
  const values: Record<string, string> = {};
  const missing: ConnectionTemplateInput[] = [];
  const presetsApplied: ConnectionTemplateInput[] = [];

  for (const input of template.inputs) {
    const flagVal = flags[input.name];
    if (typeof flagVal === "string" && flagVal.trim().length > 0) {
      values[input.name] = flagVal.trim();
    } else if (input.state === "required") {
      missing.push(input);
    } else if (input.state === "overridable") {
      presetsApplied.push(input);
    }
  }

  if (missing.length === 0) {
    return { values, presetsApplied, secretOnPage: false };
  }

  if (!opts.prompt && missesOnlyThePageSecret(template, missing)) {
    return { values, presetsApplied, secretOnPage: true };
  }

  Object.assign(values, await promptMissing(template, missing, json));
  return { values, presetsApplied, secretOnPage: false };
}

async function promptMissing(
  template: ConnectionTemplateView,
  missing: readonly ConnectionTemplateInput[],
  json: boolean,
): Promise<Record<string, string>> {
  if (!process.stdin.isTTY) {
    const flagList = flagListFor(missing);
    process.stderr.write(`error: missing required input(s): ${flagList}\n`);
    if (missesOnlyThePageSecret(template, missing)) {
      process.stderr.write(
        "hint: drop --prompt to enter the secret on a web page instead\n",
      );
    }
    process.exit(EXIT_INVALID_INPUT);
  }

  const values: Record<string, string> = {};
  for (const input of missing) {
    const prompt = input.secret ? password : text;
    const label = input.label ?? labelFor(input.name);
    const answer = await prompt({
      message: input.hint ? `${label} — ${input.hint}` : label,
      validate: (v) => (v && v.trim().length > 0 ? undefined : "Required"),
    });
    if (isCancel(answer)) exitCancelled({ json });
    values[input.name] = String(answer).trim();
  }
  return values;
}

function missesOnlyThePageSecret(
  template: ConnectionTemplateView,
  missing: readonly ConnectionTemplateInput[],
): boolean {
  const pageFields = PAGE_SECRET_FIELDS[template.authKind];
  if (!pageFields) return false;
  const names = new Set(missing.map((i) => i.name));
  return (
    pageFields.every((f) => names.has(f)) &&
    missing.every((i) => pageFields.includes(i.name))
  );
}

function secretInputsOf(
  template: ConnectionTemplateView,
): ConnectionTemplateInput[] {
  const pageFields = PAGE_SECRET_FIELDS[template.authKind] ?? [];
  return template.inputs.filter((i) => pageFields.includes(i.name));
}

const PAGE_PLACEHOLDER = "entered-on-the-page";

function pagePlaceholders(
  template: ConnectionTemplateView,
): Record<string, string> {
  return Object.fromEntries(
    (PAGE_SECRET_FIELDS[template.authKind] ?? []).map((f) => [
      f,
      PAGE_PLACEHOLDER,
    ]),
  );
}

function withoutSecret(
  payload: ConnectionCreateInput,
): SecretlessConnectionCreateInput {
  switch (payload.authKind) {
    case "header": {
      const { value: _value, ...rest } = payload;
      return rest;
    }
    case "client-credentials": {
      const { clientSecret: _clientSecret, ...rest } = payload;
      return rest;
    }
    case "github-app": {
      const { privateKey: _privateKey, ...rest } = payload;
      return rest;
    }
    case "sigv4": {
      const {
        accessKeyId: _accessKeyId,
        secretAccessKey: _secretAccessKey,
        ...rest
      } = payload;
      return rest;
    }
    case "oauth":
    case "none":
      throw new Error(`a ${payload.authKind} connection takes no page secret`);
  }
}

function buildPayload(
  template: ConnectionTemplateView,
  name: string,
  values: Record<string, string>,
  fullAccess: boolean,
): ConnectionCreateInput | { error: string } {
  const common = { templateId: template.id, name };
  const v = (k: string): string | undefined => {
    const s = values[k]?.trim();
    return s && s.length > 0 ? s : undefined;
  };
  switch (template.authKind) {
    case "oauth":
      return {
        ...common,
        authKind: "oauth",
        ...(v("url") ? { url: v("url")! } : {}),
        ...(v("host") ? { host: v("host")! } : {}),
        ...(v("clientId") ? { clientId: v("clientId")! } : {}),
        ...(v("clientSecret") ? { clientSecret: v("clientSecret")! } : {}),
        ...(v("appSlug") ? { appSlug: v("appSlug")! } : {}),
      };
    case "client-credentials":
      return {
        ...common,
        authKind: "client-credentials",
        ...(v("host") ? { host: v("host")! } : {}),
        ...(v("issuerUrl") ? { issuerUrl: v("issuerUrl")! } : {}),
        ...(v("clientId") ? { clientId: v("clientId")! } : {}),
        ...(v("clientSecret") ? { clientSecret: v("clientSecret")! } : {}),
        ...(v("scopes") ? { scopes: v("scopes")! } : {}),
        ...(v("audience") ? { audience: v("audience")! } : {}),
        ...(v("headerName") ? { headerName: v("headerName")! } : {}),
        ...(v("valueFormat") ? { valueFormat: v("valueFormat")! } : {}),
        ...(v("envName") ? { envName: v("envName")! } : {}),
      };
    case "github-app": {
      const appId = v("appId");
      const installationId = v("installationId");
      const privateKey = v("privateKey");
      if (!appId) return { error: "the App ID is required (--app-id)" };
      if (!installationId) {
        return { error: "the installation ID is required (--installation-id)" };
      }
      if (!privateKey) {
        return { error: "the private key is required (--private-key)" };
      }
      return {
        ...common,
        authKind: "github-app",
        ...(v("host") ? { host: v("host")! } : {}),
        appId,
        installationId,
        privateKey,
        ...(v("repositories") ? { repositories: v("repositories")! } : {}),
        ...(v("repositoryIds") ? { repositoryIds: v("repositoryIds")! } : {}),
        ...(v("permissions") ? { permissions: v("permissions")! } : {}),
        ...(fullAccess ? { fullAccess: true } : {}),
      };
    }
    case "header": {
      const value = v("value");
      if (!value) return { error: "the secret value is required (--value)" };
      const configInputs: Record<string, string> = {};
      for (const input of template.inputs) {
        if (!input.configInput) continue;
        const ov = v(input.name);
        if (ov) configInputs[input.name] = ov;
      }
      return {
        ...common,
        authKind: "header",
        ...(v("host") ? { host: v("host")! } : {}),
        ...(v("headerName") ? { headerName: v("headerName")! } : {}),
        ...(v("valueFormat") ? { valueFormat: v("valueFormat")! } : {}),
        ...(v("envName") ? { envName: v("envName")! } : {}),
        ...(v("caData") ? { caData: v("caData")! } : {}),
        ...(Object.keys(configInputs).length > 0 ? { configInputs } : {}),
        value,
      };
    }
    case "sigv4": {
      const endpoint = v("endpoint");
      const accessKeyId = v("accessKeyId");
      const secretAccessKey = v("secretAccessKey");
      if (!endpoint)
        return { error: "the endpoint URL is required (--endpoint)" };
      if (!accessKeyId) {
        return { error: "the access key ID is required (--access-key-id)" };
      }
      if (!secretAccessKey) {
        return {
          error: "the secret access key is required (--secret-access-key)",
        };
      }
      return {
        ...common,
        authKind: "sigv4",
        endpoint,
        ...(v("region") ? { region: v("region")! } : {}),
        ...(v("bucket") ? { bucket: v("bucket")! } : {}),
        accessKeyId,
        secretAccessKey,
      };
    }
    case "none":
      return {
        ...common,
        authKind: "none",
        ...(v("url") ? { url: v("url")! } : {}),
      };
  }
}

function checkClusterTrust(
  probeRes: Awaited<ReturnType<ConnectionService["probeClusterCa"]>>,
  host: string,
): boolean {
  if (!probeRes.ok) return true;
  const probe = probeRes.value;
  if (probe.trusted) return true;
  if (probe.reachable) {
    process.stderr.write(
      `error: the API server at ${host} presents a certificate that isn't ` +
        `publicly trusted${probe.error ? ` (${probe.error})` : ""}.\n` +
        "  Pass --ca-data with the cluster CA — the certificate-authority-data " +
        "value from your kubeconfig (base64 or PEM).\n",
    );
    return false;
  }
  process.stderr.write(
    `warning: couldn't reach ${host} to check its certificate` +
      `${probe.error ? ` (${probe.error})` : ""}; continuing.\n`,
  );
  return true;
}

async function emitCreated(args: {
  svc: ConnectionService;
  json: boolean;
  github: boolean;
  name: string;
  id: string;
  authKind: ConnectionTemplateView["authKind"];
  presetsApplied: string[];
  sent: ChildScopeInput | undefined;
  check?: CredentialCheck;
}): Promise<void> {
  const created =
    args.github || args.check === undefined
      ? await args.svc.getConnection(args.id)
      : undefined;
  const view = created?.ok ? created.value : null;
  const check = view?.check ?? args.check;
  const failure = args.github && created ? readBackFailure(created) : undefined;
  const sent = args.sent ?? {};
  const madeConnection = view
    ? view.parentId !== undefined
    : failure !== undefined && sentReach(sent);
  const keptAlone = view ? view.isParent === true : failure !== undefined;
  const common = {
    json: args.json,
    verb: "Created" as const,
    presetsApplied: args.presetsApplied,
    ...(check ? { check } : {}),
    ...(failure ? { readBackFailure: failure } : {}),
  };
  if (args.github && madeConnection) {
    emitMadeConnection({
      ...common,
      id: args.id,
      name: args.name,
      parent: {
        id: view?.parentId,
        name: args.name,
        authKind: args.authKind,
      },
      kind: "github-app",
      scope: (view && scopeOf(view)) ?? scopeOfSent(sent),
    });
    return;
  }
  if (args.github && keptAlone) {
    await emitParentOnly({
      ...common,
      svc: args.svc,
      parent: { id: args.id, name: args.name, authKind: args.authKind },
    });
    return;
  }
  emitSuccess({
    json: args.json,
    verb: "Created",
    name: args.name,
    id: args.id,
    authKind: args.authKind,
    presetsApplied: args.presetsApplied,
    ...(check ? { check } : {}),
  });
}

function sentAppScope(
  payload: ConnectionCreateInput,
): ChildScopeInput | undefined {
  if (payload.authKind !== "github-app") return undefined;
  return {
    ...(payload.fullAccess ? { fullAccess: true } : {}),
    ...(payload.repositories ? { repositories: payload.repositories } : {}),
    ...(payload.repositoryIds ? { repositoryIds: payload.repositoryIds } : {}),
    ...(payload.permissions ? { permissions: payload.permissions } : {}),
  };
}

function emitSuccess(args: {
  json: boolean;
  verb: "Created" | "Connected";
  name: string;
  id: string;
  authKind: ConnectionTemplateView["authKind"];
  authUrl?: string;
  presetsApplied?: string[];
  check?: CredentialCheck;
}): void {
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        id: args.id,
        status: "active",
        authKind: args.authKind,
        ...(args.authUrl ? { authUrl: args.authUrl } : {}),
        ...(args.presetsApplied && args.presetsApplied.length > 0
          ? { presetsApplied: args.presetsApplied }
          : {}),
        ...(args.check ? { check: args.check } : {}),
      })}\n`,
    );
  } else {
    process.stdout.write(
      `✓ ${args.verb} ${args.name} (${args.id})` +
        (args.check?.account ? ` as ${args.check.account}` : "") +
        "\n",
    );
  }
  const warning = credentialCheckWarning(args.name, args.check);
  if (warning && !args.json) process.stderr.write(warning);
}

function parseTimeout(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function slugifyTemplateName(templateName: string): string {
  return templateName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

function parseAuthMode(raw: string | undefined): "oauth" | "none" | undefined {
  if (raw === undefined) return undefined;
  if (raw === "oauth" || raw === "none") return raw;
  process.stderr.write("error: --auth must be 'oauth' or 'none'\n");
  process.exit(EXIT_INVALID_INPUT);
}

function parseHttpUrl(s: string): URL | null {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function deriveMcpName(url: URL): string {
  const host = url.hostname.replace(/^(mcp|api|www)\./, "");
  const label = host.split(".")[0] ?? host;
  return slugifyTemplateName(label);
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function flagListFor(inputs: readonly ConnectionTemplateInput[]): string {
  return inputs.map((i) => `--${camelToKebab(i.name)}`).join(", ");
}

const FIELD_LABELS: Record<string, string> = {
  url: "URL",
  host: "Host",
  issuerUrl: "Issuer URL",
  headerName: "Header name",
  valueFormat: "Value format",
  value: "Secret value",
  clientId: "Client ID",
  clientSecret: "Client secret",
  scopes: "Scopes (space-separated)",
  audience: "Audience",
  appSlug: "GitHub App slug",
  appId: "GitHub App ID",
  installationId: "GitHub App installation ID",
  privateKey: "GitHub App private key (PEM)",
  envName: "Env var name",
  caData: "Cluster CA certificate",
  endpoint: "Endpoint URL",
  region: "Signing region",
  bucket: "Bucket",
  accessKeyId: "Access key ID",
  secretAccessKey: "Secret access key",
};

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key;
}

function formatConfigFlagError(e: ConfigFlagError): string {
  switch (e.kind) {
    case "missing-equals":
      return `invalid --config value \`${e.input}\`; expected key=value`;
    case "unknown-key": {
      const accepts = e.validKeys.map((k) => `\`${k}\``).join(", ");
      return accepts
        ? `unknown --config key \`${e.key}\`; this template accepts: ${accepts}`
        : `unknown --config key \`${e.key}\`; this template has no config inputs`;
    }
    case "invalid-value":
      return e.message;
  }
}
