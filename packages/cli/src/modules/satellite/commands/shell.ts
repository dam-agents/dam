import { Command } from "commander";
import { DEFAULT_MAX_CONCURRENT } from "api-server-api";
import { parseCommandSurface } from "../domain/command-surface.js";
import {
  createCommandBackend,
  describeSurface,
} from "../services/command-backend.js";
import {
  connectOptions,
  fail,
  readStdin,
  serve,
  shellDefaultName,
  type CommonConnectOpts,
  type ConnectDeps,
} from "./shared.js";

interface Opts extends CommonConnectOpts {
  cwd?: string;
  timeout?: string;
}

export function buildShellCommand(deps: ConnectDeps): Command {
  return connectOptions(
    new Command("shell")
      .description(
        "Expose a fixed set of approved commands on this machine, as one tool an agent can call",
      )
      .argument(
        "[patterns]",
        "one usage line per permitted command; read from stdin when omitted",
      ),
    "the one permitted command, or user@hostname",
  )
    .option("--cwd <dir>", "working directory commands run in")
    .option("--timeout <duration>", "kill a job after this long, e.g. 30m")
    .addHelpText(
      "after",
      "\nOne permitted command shape per line. A # opens a description, and a\n" +
        "trailing [...] group sets that command's own options: approval, max=N,\n" +
        "timeout=D, cwd=PATH.\n\n" +
        "  dam satellite shell --name gpu-box --cwd /srv --timeout 6h <<'EOF'\n" +
        "  ./process.sh (sales.db|events.db) [-n ^[1-9][0-9]{0,3}$]  # Process a database\n" +
        "  ./deploy.sh (staging|prod)  # Deploy it  [approval]\n" +
        "  ./train.sh ./data/**/*.db   # Train      [max=1 timeout=2h]\n" +
        "  EOF\n\n" +
        "Or as one argument:\n" +
        '  dam satellite shell "./run.sh [--thing] *  # run a thing"\n\n' +
        "The text is the whole allowlist and the platform can never widen it.\n" +
        "Changing it means restarting: there is no file to re-read.\n" +
        "Without --name the satellite is named after the permitted command when\n" +
        "there is one (run above), or called user@hostname.\n" +
        "First interrupt drains, second kills running jobs.\n",
    )
    .action(async (patterns: string | undefined, opts: Opts) => {
      const text = patterns ?? (await readStdin());
      if (text.trim() === "")
        fail(
          "no command patterns — pass them as an argument or pipe them in on stdin",
        );

      const surface = parseCommandSurface(text, {
        name: opts.name ?? shellDefaultName(text),
        ...(opts.description === undefined
          ? {}
          : { description: opts.description }),
        maxConcurrent: opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
        ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
        ...(opts.timeout === undefined ? {} : { timeout: opts.timeout }),
      });
      if (!surface.ok) return fail(surface.error);

      return serve(
        deps,
        opts,
        createCommandBackend(surface.value),
        surface.value.pushed,
        ["permitted commands:", ...describeSurface(surface.value)],
      );
    });
}
