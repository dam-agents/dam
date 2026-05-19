import { Command } from "commander";
import type { ChannelConfig, Instance } from "api-server-api";
import { ChannelType } from "api-server-api";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { InstanceService } from "../services/instance-service.js";
import { createInstanceResolver } from "../services/instance-resolver.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { exitCodeForResolveError, printResolveError } from "./errors.js";
import {
  EXIT_INSTANCE_BELOW_FLOOR,
  EXIT_INSTANCE_RUNTIME_FAILURE,
  EXIT_INSTANCE_SUCCESS,
} from "./exit-codes.js";

export function buildGetCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createInstanceService: (host: string) => InstanceService;
}): Command {
  return new Command("get")
    .description("Show one Instance's details, addressed by name or ID")
    .argument("<ref>", "Instance Ref — name or 'inst-…' ID")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit raw JSON instead of the default vertical layout")
    .addHelpText(
      "after",
      "\nExamples:\n  dam instance get my-agent\n  dam instance get inst-abc123 --json\n",
    )
    .action(async (ref: string, opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, {
        flag: opts.server ? { server: opts.server } : undefined,
        exitCodes: {
          runtimeFailure: EXIT_INSTANCE_RUNTIME_FAILURE,
          belowFloor: EXIT_INSTANCE_BELOW_FLOOR,
        },
      });

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
    instance.allowedUserEmails.length === 0
      ? "<none>"
      : instance.allowedUserEmails.join(", "),
  ]);
  if (instance.state === "error" && instance.error)
    entries.push(["ERROR", instance.error]);
  const pad = Math.max(...entries.map(([k]) => k.length)) + 2;
  return (
    entries
      .map(([k, v]) => `${k}:${" ".repeat(pad - k.length)}${v}`)
      .join("\n") + "\n"
  );
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
