import { basename, resolve } from "node:path";
import { Command } from "commander";
import { DEFAULT_MAX_CONCURRENT, satelliteNameSchema } from "api-server-api";
import { pinRoot, platformRefusal } from "../services/confined-files.js";
import { createFileTransfer } from "../services/file-transfer.js";
import { createFilesBackend } from "../services/files-backend.js";
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
        "Let an agent list, inspect and copy files in one directory on this machine from its own workspace",
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
      "\nThe agent gets `list` and `stat` to see what is there, a `download` tool\n" +
        "and, with --upload, an `upload` tool.\n" +
        "A file's bytes never enter the agent's context: a download lands in the\n" +
        "agent's workspace and the agent gets its path, size and sha256, and an\n" +
        "upload comes from a path in that workspace.\n" +
        "A download copies the whole file or a slice of it, with offset and\n" +
        "length, so a file bigger than the limit still moves in pieces.\n" +
        "A directory comes down as one uncompressed tar of its regular files,\n" +
        "named after the directory; the agent unpacks it with\n" +
        "`tar -xf <path> -C <dir>`. Links, special files and hard-linked files\n" +
        "are left out and named in the result.\n" +
        "With --upload, `unpack: true` turns one tar from the agent's workspace\n" +
        "into one new directory on this machine: it must not exist yet, and\n" +
        "nothing is published unless every entry arrives.\n\n" +
        "  dam satellite files --name laptop --root ~/work\n" +
        "  dam satellite files --name laptop --root ~/work --upload\n\n" +
        "--root is the whole allowlist: every path is resolved inside it, and an\n" +
        "absolute path or a .. segment is refused. A symlink is never followed:\n" +
        "it is refused on the way to a file, and list shows it as a link.\n" +
        "It refuses / and your home directory — name the directory an agent may\n" +
        "read, e.g. ~/work rather than ~. Without --upload the agent can read but\n" +
        "never write; with it, a file already there is replaced only when the\n" +
        "agent's call asks to overwrite.\n" +
        "One transfer carries at most 5 GiB; a slice under that limit still\n" +
        "copies from a larger file.\n" +
        "A listing stops at 10 levels deep, 5000 entries or 20 seconds, and says\n" +
        "on its last line that it stopped there.\n" +
        "Changing what is exposed means restarting: there is no file to\n" +
        "re-read. First interrupt drains, second kills running jobs.\n",
    )
    .action(async (opts: Opts) => {
      const unsupported = platformRefusal();
      if (unsupported !== null) fail(unsupported);
      if (opts.root === undefined)
        fail("--root is required — name the one directory an agent may read");
      const root = await pinRoot(opts.root);
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
