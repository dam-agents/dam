import { openAsBlob } from "node:fs";
import { Command } from "commander";
import type { TokenProvider } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { createAgentResolver, type AgentService } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import { formatAuthRejection } from "../../shared/auth-message.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { confirm } from "../../shared/prompt.js";
import {
  type BundleBuilder,
  EXCLUDE_FROM_IMPORT,
  type PackedBundle,
  resolveArgs,
} from "../infrastructure/bundle-builder.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
  EXIT_AGENT_NOT_RESOLVED,
} from "../../shared/exit-codes.js";

export interface ImportCommandDeps {
  compatService: CompatService;
  configService: ConfigService;
  tokenProvider: TokenProvider;
  /** Per-host service factory from the agent module's compose. */
  createAgentService: (host: string) => AgentService;
  bundleBuilder: BundleBuilder;
  serverEnvVar: string;
}

interface ImportSuccess {
  filesWritten: number;
  bytes: number;
  durationMs: number;
}

export function buildImportCommand(deps: ImportCommandDeps): Command {
  const cmd = new Command("import")
    .description("Import local files or folders into an Agent")
    .argument("<agent-ref>", "Agent name or ID (`agent-...`)")
    .argument("<path...>", "one or more local files or directories")
    .option(
      "--server <url>",
      "override the configured server URL for this call",
    )
    .option("-y, --yes", "skip the TTY confirm prompt (required on non-TTY)")
    .option(
      "--json",
      "emit the server's JSON response (or `{ cancelled: true }` on cancel) instead of the human one-liner",
    );

  cmd.addHelpText(
    "after",
    () =>
      "\nEach <path> becomes a top-level entry under 'work/' on the Agent. " +
      "Existing entries with the same name are replaced wholesale; other " +
      "entries under 'work/' are untouched.\n\n" +
      "Symlinks anywhere in the imported tree are skipped (not followed).\n\n" +
      "Excluded directory and file names (matched at every level by basename):\n" +
      `  ${[...EXCLUDE_FROM_IMPORT].sort().join(", ")}\n`,
  );

  cmd.action(
    async (
      ref: string,
      paths: string[],
      opts: { server?: string; yes?: boolean; json?: boolean },
    ) => {
      const flag = opts.server ? { server: opts.server } : undefined;

      const host = await resolveActiveHost(deps, {
        flag,
        exitCodes: {
          runtimeFailure: EXIT_RUNTIME_FAILURE,
          belowFloor: EXIT_BELOW_FLOOR,
        },
      });

      // Validate args early — cheap, surfaces user typos before the round-trip.
      const resolved = await resolveArgs(paths);
      if (!resolved.ok) {
        process.stderr.write(`error: ${resolved.error.reason}\n`);
        process.exit(EXIT_INVALID_INPUT);
      }
      const args = resolved.value;

      const svc = deps.createAgentService(host);
      const resolver = createAgentResolver({ agentService: svc });
      const target = await resolver.resolve(ref);
      if (!target.ok) {
        printResolveError(target.error, host);
        process.exit(exitCodeForResolveError(target.error));
      }
      const agent = target.value;

      if (!opts.yes) {
        if (!process.stdin.isTTY) {
          process.stderr.write(
            "error: refusing destructive import on non-TTY; pass --yes\n",
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        process.stderr.write(
          `About to import into '${agent.name}' (${agent.id}):\n`,
        );
        for (const a of args) {
          process.stderr.write(`  ${a.input}\n`);
        }
        process.stderr.write(
          "This replaces each entry under 'work/' on the agent if present.\n",
        );
        // Longer timeout than `confirm`'s default — users may scan a long path list.
        const okToProceed = await confirm("Continue?", { timeoutMs: 120_000 });
        if (!okToProceed) {
          if (opts.json) {
            process.stdout.write(`${JSON.stringify({ cancelled: true })}\n`);
          } else {
            process.stdout.write("Cancelled.\n");
          }
          process.exit(EXIT_SUCCESS);
        }
      }

      const packed = await deps.bundleBuilder.pack(args);
      if (!packed.ok) {
        process.stderr.write(`error: ${packed.error.reason}\n`);
        process.exit(EXIT_INVALID_INPUT);
      }

      // Cleanup must run before process.exit — process.exit halts the event
      // loop before pending microtasks, so a finally-block awaiting cleanup
      // would leak the tmpdir on every successful import.
      let exitCode = EXIT_RUNTIME_FAILURE;
      try {
        exitCode = await uploadAndReport({
          host,
          agentId: agent.id,
          packed: packed.value,
          tokenProvider: deps.tokenProvider,
          json: opts.json === true,
        });
      } finally {
        await packed.value.cleanup();
      }
      process.exit(exitCode);
    },
  );

  return cmd;
}

async function uploadAndReport(args: {
  host: string;
  agentId: string;
  packed: PackedBundle;
  tokenProvider: TokenProvider;
  json: boolean;
}): Promise<number> {
  const tokenResult = await args.tokenProvider.getValidAccessToken(args.host);
  if (!tokenResult.ok) {
    const e = tokenResult.error;
    if (e.kind === "not-logged-in" || e.kind === "session-expired") {
      const reason =
        e.kind === "not-logged-in"
          ? `not logged in to ${e.host}`
          : `session expired for ${e.host}`;
      process.stderr.write(formatAuthRejection(reason));
    } else {
      process.stderr.write(`error: ${e.reason}\n`);
    }
    return EXIT_RUNTIME_FAILURE;
  }
  const token = tokenResult.value;

  const blob = await openAsBlob(args.packed.tmpPath, {
    type: "application/gzip",
  });
  const form = new FormData();
  form.set("bundle", blob, "bundle.tar.gz");

  let res: Response;
  try {
    res = await fetch(
      `${args.host}/api/agents/${encodeURIComponent(args.agentId)}/import`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      },
    );
  } catch (e) {
    process.stderr.write(
      `error: cannot reach server: ${(e as Error).message}\n`,
    );
    return EXIT_RUNTIME_FAILURE;
  }

  const body = await res.text();

  if (res.status === 200) {
    let parsed: ImportSuccess;
    try {
      parsed = JSON.parse(body) as ImportSuccess;
    } catch {
      process.stderr.write("error: malformed success response from server\n");
      return EXIT_RUNTIME_FAILURE;
    }
    if (args.json) {
      process.stdout.write(`${JSON.stringify(parsed)}\n`);
    } else {
      process.stdout.write(
        `Imported ${parsed.filesWritten} files (${formatBytes(parsed.bytes)}) in ${(parsed.durationMs / 1000).toFixed(1)}s.\n`,
      );
    }
    return EXIT_SUCCESS;
  }

  const serverMessage = extractServerError(body) ?? res.statusText;
  switch (res.status) {
    case 401:
      process.stderr.write(formatAuthRejection(serverMessage));
      return EXIT_RUNTIME_FAILURE;
    case 404:
      process.stderr.write("error: agent no longer exists\n");
      return EXIT_AGENT_NOT_RESOLVED;
    case 409:
      process.stderr.write(
        "error: another import is already in progress for this agent\n",
      );
      return EXIT_RUNTIME_FAILURE;
    case 411:
    case 413:
      process.stderr.write(`error: ${serverMessage}\n`);
      return EXIT_RUNTIME_FAILURE;
    case 422:
      process.stderr.write(`error: bundle rejected: ${serverMessage}\n`);
      return EXIT_RUNTIME_FAILURE;
    default:
      process.stderr.write(
        `error: cannot reach server: HTTP ${res.status} ${serverMessage}\n`,
      );
      return EXIT_RUNTIME_FAILURE;
  }
}

function extractServerError(body: string): string | null {
  try {
    const obj = JSON.parse(body) as { error?: unknown };
    if (typeof obj.error === "string") return obj.error;
  } catch {
    // not JSON; fall through
  }
  return null;
}

function formatBytes(n: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = n;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${i === 0 ? value.toString() : value.toFixed(1)} ${units[i]}`;
}
