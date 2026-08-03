import { type FileHandle, open } from "node:fs/promises";
import { resolve } from "node:path";
import { TRPCClientError } from "@trpc/client";
import { Command } from "commander";
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

export interface FilePutDeps {
  tokenProvider: TokenProvider;
  configService: ConfigService;
  compatService: CompatService;
  createAgentService: (host: string) => AgentService;
}

export function buildFilePutCommand(deps: FilePutDeps): Command {
  return new Command("put")
    .description("Upload a single local file into an Agent's workspace")
    .argument("<ref>", "Agent Ref — name or 'agent-…' ID")
    .argument("<local-path>", "path to a local file to upload")
    .argument(
      "<remote-path>",
      "destination path inside the workspace, workspace-relative",
    )
    .option("--overwrite", "allow overwriting an existing remote file")
    .option("--server <url>", "override the configured server URL")
    .action(
      async (
        ref: string,
        localPath: string,
        remotePath: string,
        opts: { server?: string; overwrite?: boolean },
      ) => {
        const flag = opts.server ? { server: opts.server } : undefined;
        const host = await resolveActiveHost(deps, {
          flag,
          exitCodes: {
            runtimeFailure: EXIT_RUNTIME_FAILURE,
            belowFloor: EXIT_BELOW_FLOOR,
          },
        });

        // Resolve the agent before touching local I/O — a bad ref is the
        // most common user error and we'd rather fail fast.
        const svc = deps.createAgentService(host);
        const resolver = createAgentResolver({ agentService: svc });
        const resolved = await resolver.resolve(ref);
        if (!resolved.ok) {
          printResolveError(resolved.error, host);
          process.exit(exitCodeForResolveError(resolved.error));
        }
        const agent = resolved.value;

        const absLocal = resolve(localPath);
        // Open once and stat+read through the same handle to avoid a TOCTOU
        // race between the directory-guard and the read.
        let fh: FileHandle;
        try {
          fh = await open(absLocal, "r");
        } catch (e) {
          process.stderr.write(
            `error: cannot read ${absLocal}: ${(e as Error).message}\n`,
          );
          process.exit(EXIT_INVALID_INPUT);
        }
        let buf: Buffer;
        try {
          const stats = await fh.stat();
          if (stats.isDirectory()) {
            await fh.close();
            process.stderr.write(
              `error: ${absLocal} is a directory; \`dam file put\` uploads a single file. Use \`dam import\` for directories.\n`,
            );
            process.exit(EXIT_INVALID_INPUT);
          }
          buf = await fh.readFile();
        } catch (e) {
          await fh.close();
          process.stderr.write(
            `error: cannot read ${absLocal}: ${(e as Error).message}\n`,
          );
          process.exit(EXIT_RUNTIME_FAILURE);
        } finally {
          await fh.close();
        }
        // The per-file cap belongs to the server; oversize comes back as
        // PAYLOAD_TOO_LARGE and printTrpcUploadError surfaces it.

        const contentBase64 = buf.toString("base64");

        const trpc = createAgentTrpcClient({
          host,
          agentId: agent.id,
          tokenProvider: deps.tokenProvider,
        });

        try {
          await trpc.files.upload.mutate({
            path: remotePath,
            contentBase64,
            overwrite: !!opts.overwrite,
          });
        } catch (e) {
          printTrpcUploadError(e, remotePath, host);
          process.exit(EXIT_RUNTIME_FAILURE);
        }

        process.stdout.write(
          `Uploaded ${buf.length} bytes to ${remotePath} on ${agent.name}.\n`,
        );
        process.exit(EXIT_SUCCESS);
      },
    );
}

function printTrpcUploadError(
  e: unknown,
  remotePath: string,
  host: string,
): void {
  const trpcErr = e instanceof TRPCClientError ? e : undefined;
  const code = trpcErr?.data?.code as string | undefined;
  // Server detail (e.g. "file 15728640 bytes (max 10485760)") lives in
  // `data.message`; top-level `message` is just the code name.
  const message = (trpcErr?.data?.message as string | undefined) ?? "";
  // `files.upload` only emits CONFLICT for the AlreadyExists domain error —
  // no mtime-conflict branch on this route (see agent-runtime-api router).
  if (code === "CONFLICT") {
    process.stderr.write(
      `error: ${remotePath} already exists on the agent; pass --overwrite to clobber\n`,
    );
    return;
  }
  if (code === "FORBIDDEN") {
    process.stderr.write(`error: forbidden path: ${message || remotePath}\n`);
    return;
  }
  if (code === "PAYLOAD_TOO_LARGE") {
    process.stderr.write(
      `error: ${remotePath} exceeds the server's per-file cap` +
        (message ? ` (${message})` : "") +
        `. Streaming transfer for individual large files isn't implemented yet ` +
        `(use \`dam import\` for bulk transfer).\n`,
    );
    return;
  }
  printTrpcError(e, host);
}
