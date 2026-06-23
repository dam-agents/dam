import { isCancel, password, text } from "@clack/prompts";
import { Command } from "commander";
import {
  type ConnectionCreateInput,
  type ConnectionTemplateInput,
  type ConnectionTemplateView,
  connectionNameSchema,
} from "api-server-api";
import { printServiceError } from "../../shared/trpc/print.js";
import type { BrowserOpener } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { exitCancelled } from "../../shared/prompt.js";
import {
  type ConfigFlagError,
  resolveConfigInputFlags,
} from "../domain/config-inputs.js";
import type { ConnectionService } from "../services/connection-service.js";

const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_SECONDS = 300;

interface ConnectOpts {
  name?: string;
  auth?: string;
  url?: string;
  host?: string;
  clientId?: string;
  clientSecret?: string;
  appSlug?: string;
  headerName?: string;
  valueFormat?: string;
  envName?: string;
  value?: string;
  config?: string[];
  server?: string;
  json?: boolean;
  browser?: boolean;
  timeout?: string;
}

export function buildConnectCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createConnectionService: (host: string) => ConnectionService;
  browserOpener: BrowserOpener;
}): Command {
  return new Command("connect")
    .description("Create a connection from a provider template or MCP server")
    .argument(
      "<provider-or-url>",
      "a provider template id (see `dam connection templates`) or an MCP server URL (https://…)",
    )
    .option(
      "--name <name>",
      "connection name (default: slug of the template name, or the MCP server host)",
    )
    .option(
      "--auth <mode>",
      "MCP auth mode: oauth | none (default: auto-detect from the server)",
    )
    .option("--url <url>", "input: url")
    .option("--host <host>", "input: host")
    .option("--client-id <id>", "input: OAuth client id")
    .option("--client-secret <secret>", "input: OAuth client secret")
    .option("--app-slug <slug>", "input: GitHub App slug")
    .option("--header-name <name>", "input: header name")
    .option("--value-format <format>", "input: header value format")
    .option(
      "--env-name <name>",
      "input: expose the credential to the agent as this env var (custom header credentials)",
    )
    .option("--value <value>", "input: header secret value")
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
      "emit { ok, id, status, authKind, presetsApplied? } as JSON",
    )
    .option("--no-browser", "print the authorize URL instead of opening it")
    .option(
      "--timeout <seconds>",
      "how long to wait for OAuth authorization",
      String(DEFAULT_TIMEOUT_SECONDS),
    )
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam connection connect github\n" +
        "  dam connection connect github --client-id Iv1.… --client-secret …  # use your own OAuth app\n" +
        "  dam connection connect github --no-browser\n" +
        "  dam connection connect my-api --header-name X-API-Key --value sk-…\n" +
        "  dam connection connect bob --value sk-… --config model=premium-shell --config chatMode=code\n" +
        "  dam connection connect https://mcp.example.com\n" +
        "  dam connection connect https://mcp.example.com --auth none\n",
    )
    .action(async (providerOrUrl: string, opts: ConnectOpts) => {
      const json = opts.json ?? false;

      const timeoutSeconds = parseTimeout(opts.timeout);
      if (timeoutSeconds === null) {
        process.stderr.write("error: --timeout must be a positive integer\n");
        process.exit(EXIT_INVALID_INPUT);
      }

      const authOverride = parseAuthMode(opts.auth);

      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });
      const svc = deps.createConnectionService(host);

      const templatesRes = await svc.listTemplates();
      if (!templatesRes.ok) {
        printServiceError(templatesRes.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      const templates = templatesRes.value;

      // A positional that parses as an http(s) URL is an MCP server; catalog
      // template ids are slugs (`github`, `custom-header`, …) and never contain
      // `://`, so the discriminator is unambiguous.
      const mcpUrl = parseHttpUrl(providerOrUrl);
      const { template, name, values, presetsApplied } = mcpUrl
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

      const configRes = resolveConfigInputFlags(template, opts.config ?? []);
      if (!configRes.ok) {
        process.stderr.write(
          `error: ${formatConfigFlagError(configRes.error)}\n`,
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const payload = buildPayload(template, name, {
        ...values,
        ...configRes.value,
      });
      if ("error" in payload) {
        process.stderr.write(`error: ${payload.error}\n`);
        process.exit(EXIT_INVALID_INPUT);
      }

      const createRes = await svc.createConnection(payload);
      if (!createRes.ok) {
        printServiceError(createRes.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
      const { id } = createRes.value;

      // A preset filled inputs we never asked about (operator default or family
      // sibling). Note it on stderr in human mode; under --json the same signal
      // rides along in the result as `presetsApplied`.
      const presetNames = presetsApplied.map((i) => i.name);
      if (!json && presetNames.length > 0) {
        process.stderr.write(formatPresetNote(presetsApplied));
      }

      if (template.authKind !== "oauth") {
        emitSuccess({
          json,
          verb: "Created",
          name,
          id,
          authKind: template.authKind,
          presetsApplied: presetNames,
        });
        process.exit(EXIT_SUCCESS);
      }

      const oauthRes = await svc.startOAuth(id);
      if (!oauthRes.ok) {
        printServiceError(oauthRes.error, host);
        process.exit(EXIT_RUNTIME_FAILURE);
      }
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

      const outcome = await pollUntilActive(svc, id, timeoutSeconds);
      if (outcome !== "active") {
        process.stderr.write(
          `error: couldn't confirm the connection finished within ${timeoutSeconds}s; ` +
            "it may still complete — check `dam connection list`\n",
        );
        process.exit(EXIT_RUNTIME_FAILURE);
      }

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
    });
}

interface ResolvedConnection {
  template: ConnectionTemplateView;
  name: string;
  values: Record<string, string>;
  presetsApplied: ConnectionTemplateInput[];
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

  const name = (opts.name ?? slugifyTemplateName(template.name)).trim();
  validateName(name);
  const { values, presetsApplied } = await collectInputs(template, opts, json);
  return { template, name, values, presetsApplied };
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
    if (!res.ok) {
      printServiceError(res.error, host);
      process.exit(EXIT_RUNTIME_FAILURE);
    }
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
  // MCP templates declare only a `url` input — no presets to override.
  return { template, name, values: { url }, presetsApplied: [] };
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

function validateName(name: string): void {
  const nameCheck = connectionNameSchema.safeParse(name);
  if (!nameCheck.success) {
    const msg = nameCheck.error.issues[0]?.message ?? "invalid name";
    process.stderr.write(`error: ${msg}\n`);
    process.exit(EXIT_INVALID_INPUT);
  }
}

interface CollectedInputs {
  values: Record<string, string>;
  /** Overridable inputs the user didn't supply a flag for — the server fills
   *  these from a preset. Surfaced to the user so the silent reuse is visible. */
  presetsApplied: ConnectionTemplateInput[];
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
      // A supplied flag overrides an `overridable` preset; for required/optional
      // inputs it's just the user-typed value.
      values[input.name] = flagVal.trim();
    } else if (input.state === "required") {
      missing.push(input);
    } else if (input.state === "overridable") {
      // Left to the server-side preset (an operator default, or a credential
      // inherited from a family sibling). Never prompted — reported instead.
      presetsApplied.push(input);
    }
  }

  if (missing.length === 0) return { values, presetsApplied };

  if (!process.stdin.isTTY) {
    const flagList = flagListFor(missing);
    process.stderr.write(`error: missing required input(s): ${flagList}\n`);
    process.exit(EXIT_INVALID_INPUT);
  }

  for (const input of missing) {
    const prompt = input.secret ? password : text;
    const answer = await prompt({
      message: labelFor(input.name),
      validate: (v) => (v && v.trim().length > 0 ? undefined : "Required"),
    });
    if (isCancel(answer)) exitCancelled({ json });
    values[input.name] = String(answer).trim();
  }
  return { values, presetsApplied };
}

function buildPayload(
  template: ConnectionTemplateView,
  name: string,
  values: Record<string, string>,
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
        ...(Object.keys(configInputs).length > 0 ? { configInputs } : {}),
        value,
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

async function pollUntilActive(
  svc: ConnectionService,
  id: string,
  timeoutSeconds: number,
): Promise<"active" | "timeout"> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (true) {
    const res = await svc.getConnection(id);
    // A transient read failure shouldn't abort a multi-minute wait — retry
    // on the next tick; a persistent one surfaces as the timeout message.
    if (res.ok && res.value?.status === "active") return "active";
    if (Date.now() + POLL_INTERVAL_MS >= deadline) return "timeout";
    await sleep(POLL_INTERVAL_MS);
  }
}

function emitSuccess(args: {
  json: boolean;
  verb: "Created" | "Connected";
  name: string;
  id: string;
  authKind: ConnectionTemplateView["authKind"];
  authUrl?: string;
  presetsApplied?: string[];
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
      })}\n`,
    );
  } else {
    process.stdout.write(`✓ ${args.verb} ${args.name} (${args.id})\n`);
  }
}

function parseTimeout(raw: string | undefined): number | null {
  if (raw === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

// Strip a leading mcp./api./www. label, take the first remaining DNS label,
// and slugify to connectionNameSchema (e.g. mcp.notion.com -> "notion").
function deriveMcpName(url: URL): string {
  const host = url.hostname.replace(/^(mcp|api|www)\./, "");
  const label = host.split(".")[0] ?? host;
  return slugifyTemplateName(label);
}

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

// CLI flag spellings for a set of inputs, e.g. [clientId, clientSecret] →
// "--client-id, --client-secret". Shared by the missing-input error and the
// preset note so the two can never disagree on how a flag is spelled.
function flagListFor(inputs: readonly ConnectionTemplateInput[]): string {
  return inputs.map((i) => `--${camelToKebab(i.name)}`).join(", ");
}

const FIELD_LABELS: Record<string, string> = {
  url: "URL",
  host: "Host",
  headerName: "Header name",
  valueFormat: "Value format",
  value: "Secret value",
  clientId: "Client ID",
  clientSecret: "Client secret",
  appSlug: "GitHub App slug",
  envName: "Env var name",
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

// Generic by design: the CLI can't tell an operator default from a family
// inheritance, so the note names the fields and how to override them, not the
// source (issue #554, "Out of scope"). Preset values are never printed — for
// secrets the CLI doesn't have them, and echoing even a client id into a
// terminal/CI log is needless exposure.
function formatPresetNote(inputs: ConnectionTemplateInput[]): string {
  const fields = inputs.map((i) => labelFor(i.name)).join(", ");
  return `Using preset values (${fields}). Pass ${flagListFor(inputs)} to use your own.\n`;
}
