import { Command } from "commander";
import type { TokenProvider } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { createAgentResolver, type AgentService } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { writeStdoutAndExit } from "../../shared/stdout.js";
import { printTrpcError } from "../../shared/trpc/print.js";
import { createAgentTrpcClient } from "../../shared/trpc/trpc-client.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";

export interface FileListDeps {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

interface TreeEntry {
  path: string;
  type: "file" | "dir";
}

export function buildFileListCommand(deps: FileListDeps): Command {
  return new Command("list")
    .description(
      "List immediate children of a directory in an Agent's workspace",
    )
    .argument("<ref>", "Agent Ref — name or 'agent-…' ID")
    .argument(
      "[remote-path]",
      "directory to list (workspace-relative; defaults to root)",
    )
    .option("--server <url>", "override the configured server URL")
    .option("--json", "emit entries as JSON (files and directories)")
    .action(
      async (
        ref: string,
        remotePath: string | undefined,
        opts: { server?: string; json?: boolean },
      ) => {
        const flag = opts.server ? { server: opts.server } : undefined;
        const host = await resolveActiveHost(deps, {
          flag,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        const svc = deps.createAgentService(host);
        const resolver = createAgentResolver({ agentService: svc });
        const resolved = await resolver.resolve(ref);
        if (!resolved.ok) {
          printResolveError(resolved.error, host);
          process.exit(exitCodeForResolveError(resolved.error));
        }
        const agent = resolved.value;

        const trpc = createAgentTrpcClient({
          host,
          agentId: agent.id,
          tokenProvider: deps.tokenProvider,
        });

        const dir = (remotePath ?? "").replace(/\/+$/, "");

        let entries: TreeEntry[];
        try {
          const { results } = await trpc.files.listDirs.query({
            paths: [dir],
          });
          const res = results[0];
          if (!res || !res.ok) {
            const reason = res?.error ?? "not-found";
            process.stderr.write(
              `error: cannot list \`${dir || "/"}\`: ${reason}\n`,
            );
            process.exit(EXIT_RUNTIME_FAILURE);
          }
          entries = res.entries.map((e) => ({
            path: dir ? `${dir}/${e.name}` : e.name,
            type: e.type,
          }));
        } catch (e) {
          printTrpcError(e, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        const out = opts.json
          ? `${JSON.stringify(entries)}\n`
          : entries
              .filter((e) => e.type === "file")
              .map((e) => `${e.path}\n`)
              .join("");
        return writeStdoutAndExit(out, EXIT_SUCCESS);
      },
    );
}
