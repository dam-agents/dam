import { isCancel, password } from "@clack/prompts";
import { Command } from "commander";
import { ChannelType } from "api-server-api";
import type { AgentService } from "../../agent/index.js";
import { createAgentResolver } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import { printServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { exitCancelled } from "../../shared/prompt.js";
import type { ChannelService } from "../services/channel-service.js";
import { ensureProviderAvailable } from "./precheck.js";

export function buildTelegramConnectCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
  createChannelService: (host: string) => ChannelService;
}): Command {
  return new Command("connect")
    .description("Bind a Telegram bot to an Agent")
    .argument("<agent>", "Agent Ref — name or 'agent-…' ID")
    .option(
      "--bot-token <token>",
      "bot token from @BotFather (prompted, masked, if omitted on a TTY)",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit the updated ChannelConfig[] as JSON")
    .addHelpText(
      "after",
      "\nExamples:\n" +
        "  dam channel telegram connect my-agent\n" +
        "  dam channel telegram connect my-agent --bot-token 123:ABC\n",
    )
    .action(
      async (
        ref: string,
        opts: { botToken?: string; server?: string; json?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, {
          flag: opts.server ? { server: opts.server } : undefined,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        const resolver = createAgentResolver({
          agentService: deps.createAgentService(host),
        });
        const resolved = await resolver.resolve(ref);
        if (!resolved.ok) {
          printResolveError(resolved.error, host);
          process.exit(exitCodeForResolveError(resolved.error));
        }

        const token = await resolveToken(opts);

        const svc = deps.createChannelService(host);
        await ensureProviderAvailable(svc, ChannelType.Telegram, host);

        const res = await svc.connectTelegram(resolved.value.id, token);
        if (!res.ok) {
          if (
            res.error.kind === "channel-precondition" ||
            res.error.kind === "invalid-input"
          ) {
            process.stderr.write(`error: ${res.error.message}\n`);
            process.exit(EXIT_INVALID_INPUT);
          }
          printServiceError(res.error, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(res.value)}\n`);
        } else {
          process.stdout.write(
            `✓ Telegram bot connected to ${resolved.value.name}.\n`,
          );
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}

async function resolveToken(opts: {
  botToken?: string;
  json?: boolean;
}): Promise<string> {
  const flag = opts.botToken?.trim();
  if (flag) return flag;

  if (!process.stdin.isTTY) {
    process.stderr.write("error: --bot-token is required on a non-TTY\n");
    process.exit(EXIT_INVALID_INPUT);
  }

  const answer = await password({
    message: "Telegram bot token (from @BotFather)",
    validate: (v) => (v && v.trim().length > 0 ? undefined : "Required"),
  });
  if (isCancel(answer)) exitCancelled({ json: opts.json });
  return String(answer).trim();
}
