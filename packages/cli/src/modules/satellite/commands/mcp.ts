import { Command } from "commander";
import { DEFAULT_MAX_CONCURRENT } from "api-server-api";
import { createMcpBackend } from "../services/mcp-backend.js";
import {
  connectOptions,
  fail,
  log,
  serve,
  type CommonConnectOpts,
  type ConnectDeps,
} from "./shared.js";

interface Opts extends CommonConnectOpts {
  cwd?: string;
}

export function buildMcpCommand(deps: ConnectDeps): Command {
  return connectOptions(
    new Command("mcp")
      .description(
        "Expose a stdio MCP server running on this machine, offering its tools to an agent",
      )
      .argument("<command...>", "the MCP server to run"),
  )
    .option("--cwd <dir>", "working directory for the MCP server")
    .addHelpText(
      "after",
      "\nThe server's tools are offered verbatim — the platform never reads inside\n" +
        "their schemas, and the server decides what each call may do. It inherits\n" +
        "this shell's environment.\n\n" +
        "  dam satellite mcp --name build-farm -- npx -y @acme/build-mcp\n\n" +
        "First interrupt drains, second kills running jobs.\n",
    )
    .action(async (command: string[], opts: Opts) => {
      let backend;
      try {
        backend = await createMcpBackend(
          {
            command: command[0]!,
            args: command.slice(1),
            ...(opts.cwd === undefined ? {} : { cwd: opts.cwd }),
          },
          log,
        );
      } catch (err) {
        return fail(`could not start the MCP server: ${String(err)}`);
      }
      if (backend.tools.length === 0) {
        await backend.close().catch(() => {});
        return fail("that MCP server lists no tools — nothing to expose");
      }

      return serve(deps, opts, backend, {
        name: opts.name!,
        ...(opts.description === undefined
          ? {}
          : { description: opts.description }),
        maxConcurrent: opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
      });
    });
}
