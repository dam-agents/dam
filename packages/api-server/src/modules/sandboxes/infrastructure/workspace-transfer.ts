import { spawn } from "node:child_process";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";

/**
 * UNIT_BOUNDARY_DESCRIPTION: Moves an agent's workspace between nodes. The
 * workspace lives on the node's own disk, which is what makes it fast enough
 * to run a build in, so an agent placed somewhere new has to fetch it from
 * wherever it ran last.
 *
 * The workspace is one directory: the agent's home, with its work tree inside
 * it exactly as the agent sees it. It used to be two siblings on the node that
 * only nested inside the sandbox, which bought nothing and meant a transfer
 * could carry one and silently lose the other.
 *
 * It goes node to node over the peer link rather than through an object store.
 * There is nothing an object store would add here: the node that has the
 * workspace is named on the agent record and is the only place it exists, so a
 * copy in a bucket would be a second truth to keep current and to explain when
 * it is stale. The cost is that an agent cannot move off a node that is down —
 * which is the same thing the record already says, rather than a new failure.
 *
 * A transfer only ever happens after the source has torn its sandbox down: the
 * scheduler releases an agent before it places it again, so nothing is writing
 * to the directory while it is read.
 *
 * Whether a node needs to fetch is not "do I have a directory" — a node that
 * ran the agent last month still has one, and it is stale by exactly the work
 * done since. The record names the node that ran it last, and that is the only
 * thing worth asking: if it was someone else, this copy is out of date whatever
 * it contains.
 *
 * The fetch therefore replaces rather than merges, and it lands in a directory
 * beside the old one first: extracting over a stale tree would leave behind
 * every file the agent has since deleted, and wiping before the transfer
 * succeeds would destroy a copy to make room for one that never arrived. The
 * whole transfer is checked before anything is swapped in, for the same
 * reason — a half-arrived workspace must fail loudly with the old one intact.
 */
const PERSISTED = "home";

export async function exportWorkspace(
  agentDir: string,
  out: NodeJS.WritableStream,
): Promise<void> {
  const present = await stat(join(agentDir, PERSISTED)).then(
    () => true,
    () => false,
  );
  if (!present) {
    out.end();
    return;
  }
  await run("tar", ["--create", "--zstd", "--directory", agentDir, PERSISTED], {
    stdout: out,
  });
}

export async function importWorkspace(
  agentDir: string,
  input: NodeJS.ReadableStream,
): Promise<void> {
  const incoming = join(agentDir, ".incoming");
  await rm(incoming, { recursive: true, force: true });
  await mkdir(incoming, { recursive: true, mode: 0o750 });
  await run(
    "tar",
    ["--extract", "--zstd", "--directory", incoming, "--same-owner"],
    { stdin: input },
  );
  const arrived = await stat(join(incoming, PERSISTED)).then(
    () => true,
    () => false,
  );
  if (!arrived) {
    await rm(incoming, { recursive: true, force: true });
    throw new Error("workspace transfer carried no home directory");
  }
  await rm(join(agentDir, PERSISTED), { recursive: true, force: true });
  await rename(join(incoming, PERSISTED), join(agentDir, PERSISTED));
  await rm(incoming, { recursive: true, force: true });
}

function run(
  file: string,
  args: string[],
  io: { stdin?: NodeJS.ReadableStream; stdout?: NodeJS.WritableStream },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      stdio: [
        io.stdin ? "pipe" : "ignore",
        io.stdout ? "pipe" : "ignore",
        "pipe",
      ],
    });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    if (io.stdin && child.stdin) io.stdin.pipe(child.stdin);
    if (io.stdout && child.stdout) child.stdout.pipe(io.stdout, { end: true });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${file} exited ${code}: ${stderr.slice(-500) || "no output"}`,
            ),
          ),
    );
  });
}
