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
import { EXIT_RUNTIME_FAILURE, EXIT_SUCCESS } from "../../shared/exit-codes.js";

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
const MAX_DIRECTORY_BATCH_SIZE = 500;
const MAX_ENCODED_DIRECTORY_INPUT_LENGTH = 7_000;

class DirectoryPathTooLongError extends Error {}

function* directoryBatches(frontier: string[]): Generator<string[]> {
  let paths: string[] = [];
  const emptyInputLength = encodeURIComponent(
    JSON.stringify({ 0: { paths: [] } }),
  ).length;
  let encodedInputLength = emptyInputLength;
  for (const path of frontier) {
    const pathLength = encodeURIComponent(JSON.stringify(path)).length;
    if (emptyInputLength + pathLength > MAX_ENCODED_DIRECTORY_INPUT_LENGTH) {
      throw new DirectoryPathTooLongError(
        `cannot list \`${path}\`: directory path exceeds the request URL size limit`,
      );
    }
    const separatorLength = paths.length > 0 ? 3 : 0;
    if (
      paths.length > 0 &&
      (paths.length === MAX_DIRECTORY_BATCH_SIZE ||
        encodedInputLength + separatorLength + pathLength >
          MAX_ENCODED_DIRECTORY_INPUT_LENGTH)
    ) {
      yield paths;
      paths = [];
      encodedInputLength = emptyInputLength;
    }
    encodedInputLength += (paths.length > 0 ? 3 : 0) + pathLength;
    paths.push(path);
  }
  if (paths.length > 0) yield paths;
}

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
    .option("--json", "emit entries as JSON")
    .action(
      async (
        ref: string,
        remotePath: string | undefined,
        opts: { server?: string; json?: boolean; recursive?: boolean },
      ) => {
        const host = await resolveActiveHost(deps, opts.server);

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
          let frontier = [dir];
          while (frontier.length > 0) {
            const nextFrontier: string[] = [];
            for (const paths of directoryBatches(frontier)) {
              const { results } = await trpc.files.listDirs.query({ paths });
              for (const [index, current] of paths.entries()) {
                const res = results[index];
                if (!res || !res.ok) {
                  const reason = res?.error ?? "not-found";
                  process.stderr.write(
                    `error: cannot list \`${current || "/"}\`: ${reason}\n`,
                  );
                  process.exit(EXIT_RUNTIME_FAILURE);
                }
                for (const entry of res.entries) {
                  const path = current
                    ? `${current}/${entry.name}`
                    : entry.name;
                  entries.push({ path, type: entry.type });
                  if (opts.recursive && entry.type === "dir")
                    nextFrontier.push(path);
                }
              }
            }
            frontier = nextFrontier;
          }
        } catch (e) {
          if (e instanceof DirectoryPathTooLongError) {
            process.stderr.write(`error: ${e.message}\n`);
          } else {
            printTrpcError(e, host);
          }
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        if (opts.recursive)
          entries.sort((a, b) => a.path.localeCompare(b.path));

        const out = opts.json
          ? `${JSON.stringify(entries)}\n`
          : entries.map((e) => `${e.path}${entrySuffix[e.type]}\n`).join("");
        return writeStdoutAndExit(out, EXIT_SUCCESS);
      },
    );
}
