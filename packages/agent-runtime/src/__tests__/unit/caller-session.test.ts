/**
 * TEST_OVERVIEW: The Model Router books a call that names no Session to the
 * Session its process inherited: the process holding the call's loopback
 * connection is found through /proc/net/tcp and its fds, and it and then its
 * parents are read for the Session variables, the first value naming a
 * Session winning.
 */
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCallerSessionLookup } from "../../modules/model-router/index.js";

const CLIENT_PORT = 54321;
const ROUTER_PORT = 24100;
const INODE = "777";

let proc: string;

async function processDir(
  pid: number,
  ppid: number,
  env: Record<string, string>,
  socketFd = false,
): Promise<void> {
  const dir = join(proc, String(pid));
  await mkdir(join(dir, "fd"), { recursive: true });
  await writeFile(
    join(dir, "stat"),
    `${pid} (proc name) S ${ppid} ${pid} ${pid} 0`,
  );
  await writeFile(
    join(dir, "environ"),
    Object.entries(env)
      .map(([k, v]) => `${k}=${v}\0`)
      .join(""),
  );
  await symlink("/dev/null", join(dir, "fd", "0"));
  if (socketFd) await symlink(`socket:[${INODE}]`, join(dir, "fd", "3"));
}

const hex = (port: number) => port.toString(16).toUpperCase().padStart(4, "0");
const socket = { remotePort: CLIENT_PORT, localPort: ROUTER_PORT } as Socket;

beforeEach(async () => {
  proc = await mkdtemp(join(tmpdir(), "caller-session-"));
  await mkdir(join(proc, "net"));
  await writeFile(
    join(proc, "net", "tcp"),
    [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      `   0: 0100007F:${hex(ROUTER_PORT)} 0100007F:${hex(CLIENT_PORT)} 01 00000000:00000000 00:00000000 00000000 65532 0 778 1`,
      `   1: 0100007F:${hex(CLIENT_PORT)} 0100007F:${hex(ROUTER_PORT)} 01 00000000:00000000 00:00000000 00000000 65532 0 ${INODE} 1`,
    ].join("\n"),
  );
});

afterEach(async () => {
  await rm(proc, { recursive: true, force: true });
});

describe("caller session lookup", () => {
  /** TEST_SCENARIO: A Session's shell ran `claude -p`, and that nested run's
   * own shell ran an SDK script. The script's env holds the nested run's id,
   * which is no Session, and an API key that must never be read; the nested
   * run's process still holds the Session's id, so the call books there. */
  it("walks up from a nested run to the Session's own process", async () => {
    await processDir(100, 1, { PATH: "/bin" });
    await processDir(150, 100, { CLAUDE_CODE_SESSION_ID: "session-a" });
    await processDir(
      200,
      150,
      { CLAUDE_CODE_SESSION_ID: "nested-run", OPENAI_API_KEY: "sk-secret" },
      true,
    );
    const lookup = createCallerSessionLookup({
      variables: ["HARNESS_SESSION_ID", "CLAUDE_CODE_SESSION_ID"],
      procRoot: proc,
    });
    const seen: string[] = [];
    const session = await lookup.sessionOf(socket, (value) => {
      seen.push(value);
      return value === "session-a" ? value : null;
    });
    expect(session).toBe("session-a");
    expect(seen).toEqual(["nested-run", "session-a"]);
  });
});
