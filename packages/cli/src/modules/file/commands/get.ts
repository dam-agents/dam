import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { TRPCClientError } from "@trpc/client";
import { Command } from "commander";
import type { FileReadResult } from "agent-runtime-api";
import type { TokenProvider } from "../../auth/index.js";
import type { CompatService, ConfigService } from "../../cli/index.js";
import { createAgentResolver, type AgentService } from "../../agent/index.js";
import {
  exitCodeForResolveError,
  printResolveError,
} from "../../agent/commands/errors.js";
import { resolveActiveHost } from "../../shared/preflight.js";
import { printTrpcError } from "../../shared/trpc/print.js";
import { createAgentTrpcClient } from "../../shared/trpc/trpc-client.js";
import {
  EXIT_BELOW_FLOOR,
  EXIT_INVALID_INPUT,
  EXIT_RUNTIME_FAILURE,
  EXIT_SUCCESS,
} from "../../shared/exit-codes.js";

export interface FileGetDeps {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

export function buildFileGetCommand(deps: FileGetDeps): Command {
  return new Command("get")
    .description("Fetch a single file from an Agent's workspace")
    .argument("<ref>", "Agent Ref — name or 'agent-…' ID")
    .argument("<remote-path>", "path inside the workspace, workspace-relative")
    .option(
      "-o, --output <local-path>",
      "write to this local path instead of `basename(remote-path)` in cwd; if the path is an existing directory, the file lands inside it as `basename(remote-path)`",
    )
    .option(
      "--stdout",
      "stream the file's bytes to stdout instead of writing to disk",
    )
    .option(
      "--overwrite",
      "allow overwriting an existing local file (ignored with --stdout)",
    )
    .option("--server <url>", "override the configured server URL")
    .action(
      async (
        ref: string,
        remotePath: string,
        opts: {
          server?: string;
          output?: string;
          stdout?: boolean;
          overwrite?: boolean;
        },
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

        // Decide the local target BEFORE the round-trip so we refuse to
        // clobber without spending bytes on the wire. `cp`-style: if `-o`
        // resolves to an existing directory, the file lands inside it.
        let localPath: string | undefined;
        if (!opts.stdout) {
          const target = await resolveLocalTarget(
            opts.output ?? basename(remotePath),
            basename(remotePath),
          );
          if (!target.ok) {
            process.stderr.write(`error: ${target.error}\n`);
            process.exit(EXIT_INVALID_INPUT);
          }
          localPath = target.value;
          if ((await fileExists(localPath)) && !opts.overwrite) {
            process.stderr.write(
              `error: ${localPath} already exists; pass --overwrite to clobber\n`,
            );
            process.exit(EXIT_INVALID_INPUT);
          }
        }

        const trpc = createAgentTrpcClient({
          host,
          agentId: agent.id,
          tokenProvider: deps.tokenProvider,
        });

        let result: FileReadResult;
        try {
          result = await trpc.files.read.query({ path: remotePath });
        } catch (e) {
          printTrpcReadError(e, remotePath, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        const bytes = result.binary
          ? Buffer.from(result.content, "base64")
          : Buffer.from(result.content, "utf8");

        if (opts.stdout) {
          process.stdout.write(bytes);
          process.exit(EXIT_SUCCESS);
        }

        // Non-null after the !opts.stdout branch above.
        const target_ = localPath as string;
        await mkdir(dirname(target_), { recursive: true });
        await writeFile(target_, bytes);
        process.exit(EXIT_SUCCESS);
      },
    );
}

interface OkResult<T> {
  ok: true;
  value: T;
}
interface ErrResult {
  ok: false;
  error: string;
}

async function resolveLocalTarget(
  userPath: string,
  remoteBasename: string,
): Promise<OkResult<string> | ErrResult> {
  const abs = resolve(userPath);
  try {
    const s = await stat(abs);
    if (s.isDirectory()) {
      if (!remoteBasename) {
        return {
          ok: false,
          error: `cannot infer a filename from the remote path; pass a full -o <local-path>`,
        };
      }
      return { ok: true, value: join(abs, remoteBasename) };
    }
  } catch {
    // path does not exist — treat as the literal target
  }
  return { ok: true, value: abs };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isFile();
  } catch {
    return false;
  }
}

function printTrpcReadError(e: unknown, path: string, host: string): void {
  const code =
    e instanceof TRPCClientError
      ? (e.data?.code as string | undefined)
      : undefined;
  if (code === "NOT_FOUND") {
    process.stderr.write(`error: not found: ${path}\n`);
    return;
  }
  if (code === "PAYLOAD_TOO_LARGE") {
    process.stderr.write(
      `error: ${path} exceeds the 10 MB cap for tRPC-based reads. ` +
        `Streaming transfer for individual large files isn't implemented yet ` +
        `(use \`dam import\` for bulk transfer).\n`,
    );
    return;
  }
  printTrpcError(e, host);
}
