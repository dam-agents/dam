import { Command } from "commander";
import { AVATAR_CHARACTERS } from "api-server-api/avatar/svg";
import type { CompatService, ConfigService } from "../../cli/index.js";
import type { AgentService } from "../services/agent-service.js";
import { renderTable } from "../../shared/render-table.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { exitOnServiceError } from "../../shared/trpc/print.js";
import { EXIT_SUCCESS } from "../../shared/exit-codes.js";

export function buildAvatarsCommand(deps: {
  compatService: CompatService;
  configService: ConfigService;
  createAgentService: (host: string) => AgentService;
}): Command {
  return new Command("avatars")
    .description(
      "List the built-in avatar characters, which of them you unlocked, and whether custom avatars are on",
    )
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("--json", "emit JSON instead of the default table")
    .addHelpText(
      "after",
      "\nA character unlocks when you finish a Getting Started task in the web app.\n" +
        "An emoji or an uploaded image needs the custom avatars feature, under Features in the web app's settings.\n" +
        "\nExamples:\n  dam agent avatars\n  dam agent update my-agent --avatar compass\n",
    )
    .action(async (opts: { server?: string; json?: boolean }) => {
      const host = await resolveActiveHost(deps, opts.server);
      const svc = deps.createAgentService(host);
      const [unlocked, custom] = await Promise.all([
        svc.unlockedCharacters(),
        svc.customAvatarsEnabled(),
      ]);
      exitOnServiceError(unlocked, host);
      exitOnServiceError(custom, host);
      const characters = AVATAR_CHARACTERS.map((name) => ({
        name,
        unlocked: unlocked.value.includes(name),
      }));
      if (opts.json)
        return writeStdoutAndExit(
          `${JSON.stringify({ characters, custom: custom.value })}\n`,
          EXIT_SUCCESS,
        );
      return writeStdoutAndExit(
        renderTable([
          ["CHARACTER", "UNLOCKED"],
          ...characters.map((c) => [c.name, c.unlocked ? "yes" : "no"]),
        ]) +
          `\nCustom avatars (an emoji or an uploaded image): ${custom.value ? "on" : "off"}\n`,
        EXIT_SUCCESS,
      );
    });
}
