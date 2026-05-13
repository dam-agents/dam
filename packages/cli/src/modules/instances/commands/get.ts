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
  describeConfigError,
  formatTransportError,
  printCompatResolveError,
} from "./errors.js";
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
    .argument("<ref>", "Instance Ref — name or 'inst-…' ID")
    .option("--server <url>", "override the configured server URL for this call")
    .option("--json", "emit raw JSON instead of the default vertical layout")
    .addHelpText(
      "after",
      "\nExamples:\n  dam instances get my-agent\n  dam instances get inst-abc123 --json\n",
    )
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

      const host = cfg.value.server;
      const svc = deps.createInstancesService(host);
      const resolver = createInstanceResolver({ instancesService: svc });
      const result = await resolver.resolve(ref);
      if (!result.ok) {
        printResolveError(result.error, host);
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

/** Vertical key:value layout with dynamic column alignment.
 *  `ERROR:` appended only when state === "error". */
function renderInstance(instance: Instance): string {
  const entries: [string, string][] = [
    ["NAME", instance.name],
    ["ID", instance.id],
    ["TEMPLATE", instance.templateId ?? "<custom>"],
    ["IMAGE", instance.image],
    ["STATE", instance.state],
  ];
  if (instance.description) entries.push(["DESCRIPTION", instance.description]);
  entries.push(["CHANNELS", renderChannels(instance.channels)]);
  entries.push([
    "ALLOWED",
    instance.allowedUserEmails.length === 0 ? "<none>" : instance.allowedUserEmails.join(", "),
  ]);
  if (instance.state === "error" && instance.error) entries.push(["ERROR", instance.error]);
  const pad = Math.max(...entries.map(([k]) => k.length)) + 2;
  return entries.map(([k, v]) => `${k}:${" ".repeat(pad - k.length)}${v}`).join("\n") + "\n";
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

function printResolveError(error: ResolveError, host: string): void {
  switch (error.kind) {
    case "not-found":
      if (error.via === "id") {
        process.stderr.write(`error: no instance with id \`${error.ref}\`\n`);
      } else {
        process.stderr.write(`error: no instance named "${error.ref}"\n`);
      }
      return;
    case "ambiguous": {
      process.stderr.write(`error: multiple instances named "${error.ref}":\n`);
      for (const m of error.matches) {
        process.stderr.write(`  - \`${m.id}\`\n`);
      }
      process.stderr.write("hint: specify by id instead\n");
      return;
    }
    case "auth-required":
      process.stderr.write(`error: not authenticated: ${error.reason}\n`);
      process.stderr.write("hint: run `dam auth login` first\n");
      return;
    case "transport":
      process.stderr.write(`error: ${formatTransportError(error.reason, host)}\n`);
      return;
  }
}
