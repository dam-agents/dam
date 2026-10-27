import type { Socket } from "node:net";
import { readdir, readFile, readlink } from "node:fs/promises";

const MAX_ANCESTORS = 16;
const TCP_ESTABLISHED = "01";

export interface CallerSessionLookup {
  sessionOf(
    socket: Socket,
    accept: (value: string) => string | null,
  ): Promise<string | null>;
}

const portOf = (address: string | undefined): number | null => {
  const hex = address?.split(":")[1];
  return hex === undefined ? null : Number.parseInt(hex, 16);
};

function socketInodeOf(
  table: string,
  clientPort: number,
  routerPort: number,
): string | null {
  for (const line of table.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    if (
      fields[3] === TCP_ESTABLISHED &&
      portOf(fields[1]) === clientPort &&
      portOf(fields[2]) === routerPort
    )
      return fields[9] ?? null;
  }
  return null;
}

function variablesOf(
  environ: Buffer,
  names: readonly string[],
): Map<string, string> {
  const found = new Map<string, string>();
  for (const entry of environ.toString("utf8").split("\0")) {
    const eq = entry.indexOf("=");
    if (eq <= 0) continue;
    const name = entry.slice(0, eq);
    if (names.includes(name)) found.set(name, entry.slice(eq + 1));
  }
  return found;
}

/**
 * UNIT_BOUNDARY_DESCRIPTION: the Session a model call comes from, read from
 * the process that opened the call's loopback connection. A harness sets its
 * Session's id on every shell command (the manifest's `sessionEnvVar`, and
 * HARNESS_SESSION_ID on a terminal Session), so a script, an SDK call or a
 * nested harness run that a Session started inherits it, whatever it stamps
 * on the call itself. The connection's peer port finds the socket in
 * /proc/net/tcp, the socket finds the process that holds it, and the process
 * and then its parents are read until one carries a value that `accept`
 * takes: a nested run sets the variable to its own id, which is no Session,
 * and its parent still carries the Session's. Only the named variables are
 * read from the environment and every other one is dropped at once, because
 * agents hold credentials there. Each connection is looked up once.
 */
export function createCallerSessionLookup(deps: {
  variables: readonly string[];
  procRoot?: string;
  log?: (msg: string) => void;
}): CallerSessionLookup {
  const procRoot = deps.procRoot ?? "/proc";
  const looked = new WeakMap<Socket, Promise<string | null>>();

  const pidHolding = async (inode: string): Promise<number | null> => {
    const link = `socket:[${inode}]`;
    const pids = (await readdir(procRoot))
      .map(Number)
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
    const holders = await Promise.all(
      pids.map(async (pid) => {
        try {
          const fds = await readdir(`${procRoot}/${pid}/fd`);
          const targets = await Promise.all(
            fds.map((fd) =>
              readlink(`${procRoot}/${pid}/fd/${fd}`).catch(() => null),
            ),
          );
          return targets.includes(link) ? pid : null;
        } catch {
          return null;
        }
      }),
    );
    return holders.find((pid) => pid !== null) ?? null;
  };

  const parentOf = async (pid: number): Promise<number | null> => {
    try {
      const stat = await readFile(`${procRoot}/${pid}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      return Number.isInteger(ppid) && ppid > 1 ? ppid : null;
    } catch {
      return null;
    }
  };

  const fromAncestors = async (
    start: number,
    accept: (value: string) => string | null,
  ): Promise<string | null> => {
    let pid: number | null = start;
    for (let depth = 0; pid !== null && depth < MAX_ANCESTORS; depth++) {
      if (pid === process.pid) return null;
      const environ = await readFile(`${procRoot}/${pid}/environ`).catch(
        () => null,
      );
      if (environ) {
        const found = variablesOf(environ, deps.variables);
        for (const name of deps.variables) {
          const value = found.get(name);
          const session = value ? accept(value) : null;
          if (session) return session;
        }
      }
      pid = await parentOf(pid);
    }
    return null;
  };

  const lookUp = async (
    socket: Socket,
    accept: (value: string) => string | null,
  ): Promise<string | null> => {
    const { remotePort, localPort } = socket;
    if (remotePort === undefined || localPort === undefined) return null;
    const table = await readFile(`${procRoot}/net/tcp`, "utf8");
    const inode = socketInodeOf(table, remotePort, localPort);
    const pid = inode === null ? null : await pidHolding(inode);
    return pid === null ? null : fromAncestors(pid, accept);
  };

  return {
    sessionOf(socket, accept) {
      const cached = looked.get(socket);
      if (cached) return cached;
      const result = lookUp(socket, accept).catch((err: unknown) => {
        deps.log?.(
          `[model-router] caller session lookup failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });
      looked.set(socket, result);
      return result;
    },
  };
}
