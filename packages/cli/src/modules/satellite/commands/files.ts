import { basename, resolve } from "node:path";
import { Command } from "commander";
import { DEFAULT_MAX_CONCURRENT, satelliteNameSchema } from "api-server-api";
import { createFileTransfer } from "../services/file-transfer.js";
import {
  createFilesBackend,
  resolveFileRoot,
} from "../services/files-backend.js";
import {
  activeHost,
  asSatelliteName,
  connectOptions,
  defaultSatelliteName,
  fail,
  serve,
  type CommonConnectOpts,
  type ConnectDeps,
} from "./shared.js";

interface Opts extends CommonConnectOpts {
  root?: string;
  upload?: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The name a files Satellite takes when the user
 * gives none: the directory it exposes, which is the one thing about it a
 * model and a grant list can both read.
 */
function filesDefaultName(root: string): string {
  return asSatelliteName(basename(resolve(root))) || defaultSatelliteName();
}

export function buildFilesCommand(deps: ConnectDeps): Command {
  return connectOptions(
    new Command("files")
      .description(
        "Let an agent copy single files between one directory on this machine and its own workspace",
      )
      .option("--root <dir>", "the one directory an agent may read")
      .option(
        "--upload",
        "also let an agent write a file from its workspace into --root",
      ),
    "the directory's name, or user@hostname",
  )
    .addHelpText(
      "after",
      "\nThe agent gets a `download` tool and, with --upload, an `upload` tool.\n" +
        "A file's bytes never enter the agent's context: a download lands in the\n" +
        "agent's workspace and the agent gets its path, size and sha256, and an\n" +
        "upload comes from a path in that workspace.\n\n" +
        "  dam satellite files --name laptop --root ~/work\n" +
        "  dam satellite files --name laptop --root ~/work --upload\n\n" +
        "--root is the whole allowlist: every path is resolved inside it, and an\n" +
        "absolute path, a .. segment or a symlink that leads out is refused.\n" +
        "It refuses / and your home directory — name the directory an agent may\n" +
        "read, e.g. ~/work rather than ~. Without --upload the agent can read but\n" +
        "never write; with it, a file already there is replaced only when the\n" +
        "agent's call asks to overwrite.\n" +
        "One transfer carries at most 50 MB, which is the agent's own per-file\n" +
        "limit. Changing what is exposed means restarting: there is no file to\n" +
        "re-read. First interrupt drains, second kills running jobs.\n",
    )
    .action(async (opts: Opts) => {
      if (opts.root === undefined)
        fail("--root is required — name the one directory an agent may read");
      const root = await resolveFileRoot(opts.root);
      if (!root.ok) fail(root.reason);

      const name = satelliteNameSchema.safeParse(
        opts.name ?? filesDefaultName(root.root),
      );
      if (!name.success)
        fail(`--name: ${name.error.issues[0]?.message ?? "invalid"}`);
      const host = await activeHost(deps, opts);
      const backend = createFilesBackend({
        root: root.root,
        allowUpload: opts.upload === true,
        transfer: createFileTransfer({
          satellite: name.data,
          host,
          tokenProvider: deps.tokenProvider,
        }),
      });

      return serve(
        deps,
        opts,
        backend,
        {
          name: name.data,
          ...(opts.description === undefined
            ? {}
            : { description: opts.description }),
          maxConcurrent: opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
        },
        [
          `${root.root} — ${opts.upload === true ? "read and write" : "read-only"}`,
        ],
      );
    });
}
