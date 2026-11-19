import { basename, resolve } from "node:path";
import { Command } from "commander";
import { DEFAULT_MAX_CONCURRENT, satelliteNameSchema } from "api-server-api";
import { EXIT_RUNTIME_FAILURE, EXIT_SUCCESS } from "../../shared/exit-codes.js";
import { pinRoot, platformRefusal } from "../services/confined-files.js";
import { createFileOps, lockRoot } from "../services/file-ops.js";
import { createFileWorker } from "../services/file-worker.js";
import {
  activeHost,
  asSatelliteName,
  connectOptions,
  defaultSatelliteName,
  fail,
  log,
  transportFor,
  type CommonConnectOpts,
  type ConnectDeps,
} from "./shared.js";

interface Opts extends CommonConnectOpts {
  root?: string;
  write?: boolean;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: The name a files Satellite takes when the user
 * gives none: the directory it mounts, which is the one thing about it a model
 * and a grant list can both read.
 */
function filesDefaultName(root: string): string {
  return asSatelliteName(basename(resolve(root))) || defaultSatelliteName();
}

function mountGuide(host: string, name: string): string[] {
  return [
    `to mount it in an agent, open ${host}, pick the agent and go to`,
    `  ⵗ → Configure agent → Connections → + New → MCP servers → "${name}" → Add to agent`,
    `/mnt/sat/${name} then appears in that agent within 30 seconds, with no restart`,
  ];
}

export function buildFilesCommand(deps: ConnectDeps): Command {
  const files = connectOptions(
    new Command("files")
      .description(
        "Mount one directory of this machine in an agent's own machine as /mnt/sat/<name>",
      )
      .option("--root <dir>", "the one directory an agent sees")
      .option(
        "--write",
        "let agents create, change, rename and delete there too (default: read-only)",
      ),
    "the directory's name, or user@hostname",
  );
  const concurrency = files.options.find(
    (option) => option.long === "--max-concurrent",
  );
  if (concurrency !== undefined)
    concurrency.description =
      "how many file operations may be in flight at once";

  return files
    .addHelpText(
      "after",
      "\nAn agent sees this directory as /mnt/sat/<name> inside its own machine\n" +
        "and walks it with its own tools — ls, find, grep, sed, git — as if it\n" +
        "were local. A files satellite has no tools of its own: the mount is the\n" +
        "whole surface, fixed when a session starts, and every agent you add\n" +
        "this satellite to gets it.\n" +
        'Without --write every change fails with "Read-only file system" and\n' +
        "nothing on this machine moves; the flag is checked here as well as on\n" +
        "the platform, so the opt-in holds on your own machine. With --write an\n" +
        "agent may create, change, truncate, rename and delete anything under\n" +
        "--root, and nothing keeps a copy of what it removes: there is no\n" +
        "trash and no undo. A write is sent at its offset as the agent makes\n" +
        "it, so a half-written file is visible, and two writers interleave; a\n" +
        "write or a grow that would leave less than 1 GiB free is refused.\n" +
        "--root is the whole allowlist: a path is relative to it, and an\n" +
        "absolute path, a .. segment, an empty name, a NUL or a backslash is\n" +
        "refused. The root is resolved again on every operation, and every\n" +
        "directory on the way must be a real directory, never a link. A link may\n" +
        "be created, and its target shown, only when it stays inside --root;\n" +
        "hard links, FIFOs, sockets and devices cannot be created, chown is\n" +
        "refused and a file with a second hard link cannot be read or written.\n" +
        "It refuses / and your home directory — name the directory an agent may\n" +
        "see, e.g. ~/work rather than ~. One worker serves every agent the\n" +
        "satellite is added to, and a second worker on the same directory is\n" +
        "refused: stop it first.\n" +
        "Ceilings: the worker is Node, which has no openat/renameat, so a step\n" +
        "inside a directory makes it the process's working directory and changes\n" +
        "to the tree run one at a time; a native openat2/renameat2 is the\n" +
        "upgrade. A link that complies can still pass through a link you made\n" +
        "that leaves the root.\n\n" +
        "  dam satellite files --name lab --root ~/lab\n" +
        "  dam satellite files --name lab --root ~/lab --write\n\n" +
        "Changing what is mounted means restarting: there is no file to\n" +
        "re-read. First interrupt drains, second stops the worker.\n" +
        "A platform older than this command has no file tree in its manifest\n" +
        "schema: it refuses the manifest, and the worker stops and says the\n" +
        "platform has to be upgraded.\n",
    )
    .action(async (opts: Opts) => {
      const unsupported = platformRefusal();
      if (unsupported !== null) fail(unsupported);
      if (opts.root === undefined)
        fail("--root is required — name the one directory an agent may see");
      const root = await pinRoot(opts.root);
      if (!root.ok) fail(root.reason);

      const name = satelliteNameSchema.safeParse(
        opts.name ?? filesDefaultName(root.root),
      );
      if (!name.success)
        fail(`--name: ${name.error.issues[0]?.message ?? "invalid"}`);
      const lock = await lockRoot(root.root);
      if (!lock.ok) fail(lock.reason);

      const host = await activeHost(deps, opts);
      const writable = opts.write === true;
      const worker = createFileWorker({
        name: name.data,
        root: root.root,
        writable,
        maxConcurrent: opts.maxConcurrent ?? DEFAULT_MAX_CONCURRENT,
        ...(opts.description === undefined
          ? {}
          : { description: opts.description }),
        host,
        ops: createFileOps({ root: root.root, writable }),
        transport: transportFor(deps.createTrpc(host)),
        log,
        guide: mountGuide(host, name.data),
      });

      let interrupted = false;
      const onInterrupt = (): void => {
        if (interrupted) {
          worker.forceStop();
          process.exit(EXIT_SUCCESS);
        }
        interrupted = true;
        void worker.drain();
      };
      process.on("SIGINT", onInterrupt);
      process.on("SIGTERM", onInterrupt);

      try {
        await worker.start();
        lock.release();
        return process.exit(EXIT_SUCCESS);
      } catch (err) {
        process.stderr.write(`satellite stopped: ${String(err)}\n`);
        return process.exit(EXIT_RUNTIME_FAILURE);
      }
    });
}
