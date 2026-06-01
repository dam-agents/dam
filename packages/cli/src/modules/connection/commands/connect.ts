import { isCancel, password, text } from "@clack/prompts";
import { Command } from "commander";
import {
  type ConnectionCreateInput,
  type ConnectionTemplateInput,
  type ConnectionTemplateView,
  connectionNameSchema,
} from "api-server-api";
import { printServiceError } from "../../agent/commands/errors.js";
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
import type { ConnectionService } from "../services/connection-service.js";

const POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_SECONDS = 300;

interface ConnectOpts {
  name?: string;
  url?: string;
  host?: string;
  clientId?: string;
  clientSecret?: string;
  appSlug?: string;
  headerName?: string;
  valueFormat?: string;
  value?: string;
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
    .description("Create a connection from a provider template")
    .argument("<app-id>", "template id — see `dam template list` / the web UI")
    .option(
      "--name <name>",
      "connection name (default: slug of the template name)",
    )
    .option("--url <url>", "input: url")
    .option("--host <host>", "input: host")
    .option("--client-id <id>", "input: OAuth client id")
    .option("--client-secret <secret>", "input: OAuth client secret")
    .option("--app-slug <slug>", "input: GitHub App slug")
    .option("--header-name <name>", "input: header name")
    .option("--value-format <format>", "input: header value format")
    .option("--value <value>", "input: header secret value")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { ok, id, status, authKind } as JSON")
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
        "  dam connection connect github --no-browser\n" +
        "  dam connection connect my-api --header-name X-API-Key --value sk-…\n",
    )
    .action(async (appId: string, opts: ConnectOpts) => {
      const json = opts.json ?? false;

      const timeoutSeconds = parseTimeout(opts.timeout);
      if (timeoutSeconds === null) {
        process.stderr.write("error: --timeout must be a positive integer\n");
        process.exit(EXIT_INVALID_INPUT);
      }

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
      const template = templatesRes.value.find((t) => t.id === appId);
      if (!template) {
        const ids = templatesRes.value
          .map((t) => t.id)
          .sort((a, b) => a.localeCompare(b));
        process.stderr.write(`error: unknown app-id '${appId}'\n`);
        process.stderr.write(`available: ${ids.join(", ")}\n`);
        process.exit(EXIT_INVALID_INPUT);
      }
      if (template.category === "mcp") {
        process.stderr.write(
          "error: MCP connections are not supported by `connect` yet\n",
        );
        process.exit(EXIT_INVALID_INPUT);
      }

      const name = (opts.name ?? slugifyTemplateName(template.name)).trim();
      const nameCheck = connectionNameSchema.safeParse(name);
      if (!nameCheck.success) {
        const msg = nameCheck.error.issues[0]?.message ?? "invalid name";
        process.stderr.write(`error: ${msg}\n`);
        process.exit(EXIT_INVALID_INPUT);
      }

      const values = await collectInputs(template, opts, json);

      const payload = buildPayload(template, name, values);
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

      if (template.authKind !== "oauth") {
        emitSuccess({
          json,
          verb: "Created",
          name,
          id,
          authKind: template.authKind,
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
        ...(noBrowser ? { authUrl } : {}),
      });
      process.exit(EXIT_SUCCESS);
    });
}

async function collectInputs(
  template: ConnectionTemplateView,
  opts: ConnectOpts,
  json: boolean,
): Promise<Record<string, string>> {
  const flags = opts as unknown as Record<string, unknown>;
  const values: Record<string, string> = {};
  const missing: ConnectionTemplateInput[] = [];

  // `overridable` inputs use the admin preset in v1; only required/optional
  // are user-supplied.
  const relevant = template.inputs.filter(
    (i) => i.state === "required" || i.state === "optional",
  );
  for (const input of relevant) {
    const flagVal = flags[input.name];
    if (typeof flagVal === "string" && flagVal.trim().length > 0) {
      values[input.name] = flagVal.trim();
    } else if (input.state === "required") {
      missing.push(input);
    }
  }

  if (missing.length === 0) return values;

  if (!process.stdin.isTTY) {
    const flagList = missing.map((i) => `--${camelToKebab(i.name)}`).join(", ");
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
  return values;
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
      return {
        ...common,
        authKind: "header",
        ...(v("host") ? { host: v("host")! } : {}),
        ...(v("headerName") ? { headerName: v("headerName")! } : {}),
        ...(v("valueFormat") ? { valueFormat: v("valueFormat")! } : {}),
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
}): void {
  if (args.json) {
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        id: args.id,
        status: "active",
        authKind: args.authKind,
        ...(args.authUrl ? { authUrl: args.authUrl } : {}),
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

function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
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
};

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key;
}
