import { Command } from "commander";
import type { ChannelConfig, Instance } from "api-server-api";
import { ChannelType } from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { InstanceService } from "../services/instance-service.js";
import { createInstanceResolver } from "../services/instance-resolver.js";
import {
  describeConfigError,
  exitCodeForResolveError,
  printCompatResolveError,
  printResolveError,
} from "./errors.js";
import {
  EXIT_INSTANCE_BELOW_FLOOR,
  EXIT_INSTANCE_RUNTIME_FAILURE,
  EXIT_INSTANCE_SUCCESS,
} from "./exit-codes.js";

export interface GetCommandDeps {
  compatService: CompatService;
  configService: ConfigService;
  createInstanceService: (host: string) => InstanceService;
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
      "\nExamples:\n  dam instance get my-agent\n  dam instance get inst-abc123 --json\n",
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
        process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
      }
      const verdict = compat.value;
      if (verdict.kind === "below-floor") {
        process.stderr.write(
          `error: CLI ${verdict.localCli} is below the server's minimum required version ${verdict.serverMinClient}; upgrade and retry\n`,
        );
        process.exit(EXIT_INSTANCE_BELOW_FLOOR);
      }
      if (verdict.kind === "behind-current") {
        process.stderr.write(
          `warning: CLI ${verdict.localCli} is behind server ${verdict.serverVersion}; consider upgrading\n`,
        );
      }

      const cfg = await deps.configService.getResolved({ flag });
      if (!cfg.ok) {
        process.stderr.write(`error: ${describeConfigError(cfg.error)}\n`);
        process.exit(EXIT_INSTANCE_RUNTIME_FAILURE);
      }

      const host = cfg.value.server;
      const svc = deps.createInstanceService(host);
      const resolver = createInstanceResolver({ instanceService: svc });
      const result = await resolver.resolve(ref);
      if (!result.ok) {
        printResolveError(result.error, host);
        process.exit(exitCodeForResolveError(result.error));
      }

      if (opts.json) {
        process.stdout.write(`${JSON.stringify(result.value)}\n`);
        process.exit(EXIT_INSTANCE_SUCCESS);
      }

      process.stdout.write(renderInstance(result.value));
      process.exit(EXIT_INSTANCE_SUCCESS);
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
