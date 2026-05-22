import { Command } from "commander";
import type { TokenProvider } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { createAgentResolver, type AgentService } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { classifyTrpcError } from "../../shared/trpc/classify.js";
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
    .description("List files in an Agent's workspace")
    .argument("<ref>", "Agent Ref — name or 'agent-…' ID")
    .argument(
      "[remote-path]",
      "filter results to a subtree (workspace-relative)",
    )
    .option("--server <url>", "override the configured server URL")
    .option("--json", "emit the full tree as JSON (files and directories)")
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

        let entries: TreeEntry[];
        try {
          const res = await trpc.files.tree.query();
          entries = res.entries;
        } catch (e) {
          printTrpcError(e, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        const filtered = filterByPrefix(entries, remotePath);

        if (opts.json) {
          process.stdout.write(`${JSON.stringify(filtered)}\n`);
        } else {
          for (const e of filtered) {
            if (e.type === "file") process.stdout.write(`${e.path}\n`);
          }
        }
        process.exit(EXIT_SUCCESS);
      },
    );
}

function filterByPrefix(entries: TreeEntry[], prefix?: string): TreeEntry[] {
  if (!prefix) return entries;
  const norm = prefix.replace(/\/+$/, "");
  return entries.filter(
    (e) => e.path === norm || e.path.startsWith(`${norm}/`),
  );
}

function printTrpcError(e: unknown, host: string): void {
  const classified = classifyTrpcError(e);
  if (!classified.ok && classified.error.kind === "auth-required") {
    process.stderr.write(
      `error: not authenticated: ${classified.error.reason}\n` +
        "hint: run `dam auth login` first\n",
    );
    return;
  }
  const msg = e instanceof Error ? e.message : String(e);
  process.stderr.write(`error: cannot reach server \`${host}\`: ${msg}\n`);
}
