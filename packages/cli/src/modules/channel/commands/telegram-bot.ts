import { Command } from "commander";
import { ChannelType } from "api-server-api";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { renderTable } from "../../shared/render-table.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { telegramBotView } from "../domain/telegram-bot.js";
import type { ChannelService } from "../services/channel-service.js";

export function buildTelegramBotCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createChannelService: (host: string) => ChannelService;
}): Command {
  return new Command("bot")
    .description(
      "Show this host's Telegram bot: its username and the t.me link a user opens to bind a chat",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit { enabled, username, link } as JSON")
    .addHelpText(
      "after",
      "\nTelegram off, or a bot whose username the server does not know yet, is not\n" +
        "an error: the command says so and exits 0, and --json gives null for both.\n" +
        "\nExamples:\n" +
        "  dam channel telegram bot\n" +
        "  dam channel telegram bot --json\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);
      const svc = deps.createChannelService(host);

      const available = await svc.available();
      exitOnServiceError(available, host);
      const enabled = available.value[ChannelType.Telegram] === true;

      let bot: { username: string } | null = null;
      if (enabled) {
        const res = await svc.telegramBot();
        exitOnServiceError(res, host);
        bot = res.value;
      }
      const view = telegramBotView(enabled, bot);

      if (opts.json) {
        return writeStdoutAndExit(`${JSON.stringify(view)}\n`, EXIT_SUCCESS);
      }
      if (!view.enabled) {
        process.stderr.write("Telegram is not enabled on this host.\n");
        process.exit(EXIT_SUCCESS);
      }
      if (view.username === null || view.link === null) {
        process.stderr.write(
          "Telegram is enabled, but the server does not know its bot's username yet.\n",
        );
        process.exit(EXIT_SUCCESS);
      }
      return writeStdoutAndExit(
        renderTable([
          ["USERNAME", "LINK"],
          [`@${view.username}`, view.link],
        ]),
        EXIT_SUCCESS,
      );
    });
}
