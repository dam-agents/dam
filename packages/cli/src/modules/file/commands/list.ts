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

const entrySuffix: Record<TreeEntry["type"], string> = { file: "", dir: "/" };

export function buildFileListCommand(deps: FileListDeps): Command {
  return new Command("list")
    .description("List a directory in an Agent's workspace")
    .argument("<ref>", "Agent Ref — name or 'agent-…' ID")
    .argument(
      "[remote-path]",
      "directory to list (workspace-relative; defaults to root)",
    )
    .option("--server <url>", "override the configured server URL")
    .option("-R, --recursive", "list all nested files and directories")
    .option("--json", "emit entries as JSON (files and directories)")
    .action(
      async (
        ref: string,
        remotePath: string | undefined,
        opts: { server?: string; json?: boolean; recursive?: boolean },
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

        const entries: TreeEntry[] = [];
        try {
          const pending = [dir];
          while (pending.length > 0) {
            const current = pending.pop()!;
            const { results } = await trpc.files.listDirs.query({
              paths: [current],
            });
            const res = results[0];
            if (!res || !res.ok) {
              const reason = res?.error ?? "not-found";
              process.stderr.write(
                `error: cannot list \`${current || "/"}\`: ${reason}\n`,
              );
              process.exit(EXIT_RUNTIME_FAILURE);
            }
            for (const entry of res.entries) {
              const path = current ? `${current}/${entry.name}` : entry.name;
              entries.push({ path, type: entry.type });
              if (opts.recursive && entry.type === "dir") pending.push(path);
            }
          }
        } catch (e) {
          printTrpcError(e, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.recursive)
          entries.sort((a, b) => a.path.localeCompare(b.path));

        const out = opts.json
          ? `${JSON.stringify(entries)}\n`
          : entries
              .filter((e) => opts.recursive || e.type === "file")
              .map((e) => `${e.path}${entrySuffix[e.type]}\n`)
              .join("");
        return writeStdoutAndExit(out, EXIT_SUCCESS);
      },
    );
}
