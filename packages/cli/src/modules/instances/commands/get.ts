import { Command } from "commander";
import type { ChannelConfig, Instance } from "api-server-api";
import { ChannelType } from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { InstancesService } from "../services/instances-service.js";
import {
  createInstanceResolver,
  type ResolveError,
} from "../services/instance-resolver.js";
import {
  EXIT_INSTANCES_BELOW_FLOOR,
  EXIT_INSTANCES_RUNTIME_FAILURE,
  EXIT_INSTANCES_SUCCESS,
  EXIT_INSTANCE_NOT_RESOLVED,
} from "./exit-codes.js";

export interface GetCommandDeps {
  compatService: CompatService;
  configService: ConfigService;
  createInstancesService: (host: string) => InstancesService;
  serverEnvVar: string;
}

export function buildGetCommand(deps: GetCommandDeps): Command {
  return new Command("get")
    .description("Show one Instance's details, addressed by name or ID")
    .argument("<ref>", "Instance Ref — name or ID (`inst-...`)")
    .option("--server <url>", "override the configured server URL for this call")
    .option("--json", "emit raw JSON instead of the default vertical layout")
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const flag = opts.server ? { server: opts.server } : undefined;

      // Compat pre-flight — same gate `ping` and `auth login` use.
      // Matches `ping`: all compat-resolve failures (missing-config,
      // malformed-config, probe-error) exit as runtime failure so the
      // exit code is consistent across commands that share this gate.
      const compat = await deps.compatService.check({ flag });
      if (!compat.ok) {
        printCompatResolveError(compat.error, deps.serverEnvVar);
        process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
      }
      const verdict = compat.value;
      if (verdict.kind === "below-floor") {
        process.stderr.write(
          `error: CLI ${verdict.localCli} is below the server's minimum required version ${verdict.serverMinClient}; upgrade and retry\n`,
        );
        process.exit(EXIT_INSTANCES_BELOW_FLOOR);
      }
      if (verdict.kind === "behind-current") {
        process.stderr.write(
          `warning: CLI ${verdict.localCli} is behind server ${verdict.serverVersion}; consider upgrading\n`,
        );
      }

      const cfg = await deps.configService.getResolved({ flag });
      if (!cfg.ok) {
        process.stderr.write(`error: ${describeConfigError(cfg.error)}\n`);
        process.exit(EXIT_INSTANCES_RUNTIME_FAILURE);
      }

      const svc = deps.createInstancesService(cfg.value.server);
      const resolver = createInstanceResolver({ instancesService: svc });
      const result = await resolver.resolve(ref);
      if (!result.ok) {
        printResolveError(result.error);
        process.exit(exitCodeFor(result.error));
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.value)}\n`);
        process.exit(EXIT_INSTANCES_SUCCESS);
      }

      process.stdout.write(renderInstance(result.value));
      process.exit(EXIT_INSTANCES_SUCCESS);
    });
}

/** Vertical key:value layout. `ERROR:` appended only when state === "error". */
function renderInstance(instance: Instance): string {
  const lines: string[] = [];
  lines.push(`NAME:        ${instance.name}`);
  lines.push(`ID:          ${instance.id}`);
  lines.push(`AGENT:       ${instance.agentId}`);
  lines.push(`STATE:       ${instance.state}`);
  if (instance.description) lines.push(`DESCRIPTION: ${instance.description}`);
  lines.push(`CHANNELS:    ${renderChannels(instance.channels)}`);
  lines.push(
    `ALLOWED:     ${instance.allowedUserEmails.length === 0 ? "<none>" : instance.allowedUserEmails.join(", ")}`,
  );
  if (instance.state === "error" && instance.error) {
    lines.push(`ERROR:       ${instance.error}`);
  }
  return lines.join("\n") + "\n";
}

function renderChannels(channels: readonly ChannelConfig[]): string {
  if (channels.length === 0) return "<none>";
  return channels
    .map((c) => {
      if (c.type === ChannelType.Slack) return `slack(${c.slackChannelId})`;
      return "telegram";
    })
    .join(", ");
}

function exitCodeFor(error: ResolveError): number {
  if (error.kind === "not-found" || error.kind === "ambiguous") {
    return EXIT_INSTANCE_NOT_RESOLVED;
  }
  return EXIT_INSTANCES_RUNTIME_FAILURE;
}

function printResolveError(error: ResolveError): void {
  switch (error.kind) {
    case "not-found":
      if (error.via === "id") {
        process.stderr.write(`error: no instance with id '${error.ref}'\n`);
      } else {
        process.stderr.write(`error: no instance named '${error.ref}'\n`);
      }
      return;
    case "ambiguous": {
      process.stderr.write(`error: multiple instances named '${error.ref}':\n`);
      for (const m of error.matches) {
        process.stderr.write(`  ${m.id}\n`);
      }
      process.stderr.write("specify by id instead.\n");
      return;
    }
    case "auth-required":
      process.stderr.write(
        `error: not authenticated: ${error.reason}\n` +
          `       run "dam auth login" first\n`,
      );
      return;
    case "transport":
      process.stderr.write(`error: cannot reach server: ${error.reason}\n`);
      return;
  }
}

function describeConfigError(e: { kind: string; reason?: string }): string {
  if (e.kind === "malformed-config") return e.reason ?? "config is malformed";
  return "no server configured";
}

function printCompatResolveError(
  e: { kind: string; reason?: string; code?: string; message?: string },
  serverEnvVar: string,
): void {
  switch (e.kind) {
    case "missing-config":
      process.stderr.write(
        `error: no server configured; run "dam config set server <url>" or set ${serverEnvVar}\n`,
      );
      return;
    case "malformed-config":
      process.stderr.write(`error: ${e.reason ?? "config malformed"}\n`);
      return;
    case "probe-error":
      process.stderr.write(`error: cannot reach server: ${e.message ?? e.code ?? "unknown"}\n`);
      return;
    default:
      process.stderr.write(`error: ${e.kind}\n`);
  }
}
