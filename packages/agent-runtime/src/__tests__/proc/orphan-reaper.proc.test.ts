// What the reaper spares and what it kills, against a real kernel.
//
// The decisions are about /proc semantics — re-parenting to init, a session id
// surviving its leader's death, SO_ACCEPTCON on a unix listener, TCP st 0A vs 01
// — so they are exercised in the shipped image rather than against a fake table.
// pid 1 there is catatonit, as in a pod, which is what makes an abandoned process
// re-parent to 1 at all.
import { execFileSync, spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const IMAGE = process.env.REAPER_TEST_IMAGE ?? "platform-base:latest";
const NAME = `reaper-proc-test-${process.pid}`;
/** The sweep is on a fixed 60 s timer, so a run costs one interval. */
const SWEEP_WAIT_MS = 150_000;
const PROBE_WAIT_MS = 30_000;

const docker = (...args: string[]): string =>
  execFileSync("docker", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const inside = (script: string): string =>
  docker("exec", NAME, "sh", "-c", script);
/** Both streams: the runtime logs to stderr, which `docker logs` keeps separate. */
const logs = (): string => {
  const r = spawnSync("docker", ["logs", NAME], { encoding: "utf8" });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
};
const status = (): {
  idle: boolean;
  backgroundWork: { pid?: number; description?: string }[];
} =>
  JSON.parse(
    inside(`curl -s --noproxy '*' http://127.0.0.1:8080/api/status`),
  ) as never;

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

async function until<T>(
  what: string,
  probe: () => T | null,
  budgetMs = PROBE_WAIT_MS,
): Promise<T> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const got = probe();
    if (got !== null) return got;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(1_000);
  }
}

/** ppid/sid straight from /proc, or null once the process is gone. */
function shape(pid: number): { ppid: number; sid: number } | null {
  const out = inside(`cat /proc/${pid}/stat 2>/dev/null || true`);
  if (!out) return null;
  const fields = out.slice(out.lastIndexOf(") ") + 2).split(" ");
  return { ppid: Number(fields[1]), sid: Number(fields[3]) };
}

const alive = (pid: number): boolean => shape(pid) !== null;

/** Plants one process per row and returns their pids. Each is abandoned by its
 *  spawner, so the kernel re-parents it to pid 1 — the shape the sweep judges. */
const PLANT = String.raw`
import { spawn } from "node:child_process";
const detach = (args) => {
  const c = spawn(args[0], args.slice(1), { detached: true, stdio: "ignore" });
  c.unref();
  return c.pid;
};
const node = process.execPath;
const listen = (what) => [node, "-e", 'require("net").createServer(()=>{}).listen(' + what + ');setInterval(()=>{},1e9)'];
console.log(JSON.stringify({
  leak: detach(["sleep", "902"]),
  unixListener: detach(listen('"/tmp/r4.sock"')),
  tcpListener: detach(listen('19191,"127.0.0.1"')),
  // Retries until connected: the row is only meaningful once this process
  // really holds an established connection, otherwise it is a second plain leak.
  outbound: detach([node, "-e", 'const n=require("net");const dial=()=>{const s=n.connect(19191,"127.0.0.1");s.on("error",()=>setTimeout(dial,200))};dial();setInterval(()=>{},1e9)']),
}));
`;

describe("the orphan reaper, against a real /proc", () => {
  let declared = 0;
  let grandchild = 0;
  let planted: Record<string, number>;

  beforeAll(async () => {
    try {
      docker("version", "--format", "{{.Server.Os}}");
    } catch {
      throw new Error("docker is required for this suite; start it and re-run");
    }
    try {
      docker("image", "inspect", IMAGE);
    } catch {
      throw new Error(
        `image ${IMAGE} not found — build it with \`mise run platform-base:image\`, ` +
          `or point REAPER_TEST_IMAGE at another one that ships agent-runtime`,
      );
    }

    docker("rm", "-f", NAME);
    // API_SERVER_URL is unreachable on purpose: nothing here needs the platform,
    // and the runtime tolerates a failed hello.
    docker(
      "run",
      "-d",
      "--name",
      NAME,
      "-e",
      "API_SERVER_URL=http://127.0.0.1:9",
      IMAGE,
      "node",
      "/app/dist/server.js",
    );
    await until("the runtime to answer", () => {
      try {
        status();
        return true;
      } catch {
        return null;
      }
    });

    // A declared leader that stays alive, and a grandchild orphaned when the
    // middle process exits — it keeps the declared session's id.
    declared = Number(
      inside(
        `platform-bg sh -c '( sleep 901 & ) ; exec sleep 900' 2>/dev/null`,
      ),
    );
    planted = JSON.parse(
      inside(
        `cat > /tmp/plant.mjs <<'EOF'\n${PLANT}\nEOF\nnode /tmp/plant.mjs`,
      ),
    ) as never;
    grandchild = Number(
      inside(
        `for d in /proc/[0-9]*; do case "$(tr '\\0' ' ' < $d/cmdline 2>/dev/null)" in "sleep 901 "*) echo "\${d#/proc/}";; esac; done | head -1`,
      ),
    );

    // Only a process the kernel has re-parented is a candidate, so wait for that
    // rather than assuming the spawners have exited.
    await until("every planted process to be orphaned", () => {
      const pids = [declared, grandchild, ...Object.values(planted)];
      return pids.every((p) => shape(p)?.ppid === 1) ? true : null;
    });
    // The outbound row only means something once the connection is established.
    await until("the outbound connection to establish", () =>
      inside(
        `node -e 'const l=require("fs").readFileSync("/proc/net/tcp","utf8").split("\\n").slice(1);` +
          `console.log(l.some(x=>{const f=x.trim().split(/\\s+/);return f.length>3&&f[3]==="01"&&` +
          `(f[1].endsWith(":4AF7")||f[2].endsWith(":4AF7"))})?"yes":"no")'`,
      ) === "yes"
        ? true
        : null,
    );
  });

  afterAll(() => {
    try {
      docker("rm", "-f", NAME);
    } catch {
      /* nothing to clean up */
    }
  });

  it("plants each shape the matrix distinguishes", () => {
    expect(shape(declared)).toEqual({ ppid: 1, sid: declared });
    // The point of the grandchild: orphaned, but still in the declared session.
    expect(shape(grandchild)).toEqual({ ppid: 1, sid: declared });
    expect(shape(planted.leak)?.sid).toBe(planted.leak);
  });

  it("reports declared work as busy, so hibernation is vetoed", () => {
    const s = status();
    expect(s.idle).toBe(false);
    expect(s.backgroundWork.map((w) => w.pid)).toContain(declared);
  });

  it("clamps an over-long description instead of dropping the declaration", () => {
    // Straight at the route, not through `platform-bg`: the wrapper truncates the
    // description itself, so driving this through the CLI would pass even against
    // a schema that rejects — which is the defect this row exists to catch.
    const pid = Number(
      inside(
        `node -e 'const c=require("child_process").spawn("sleep",["904"],{detached:true,stdio:"ignore"});c.unref();console.log(c.pid)'`,
      ),
    );
    const code = inside(
      `curl -s -o /dev/null -w '%{http_code}' --noproxy '*' -X POST ` +
        `-H 'Content-Type: application/json' ` +
        `-d '{"pid":${pid},"description":"${"x".repeat(400)}"}' ` +
        `http://127.0.0.1:8080/api/declared-processes`,
    );
    expect(code, "an over-long label must not fail the declaration").toBe(
      "204",
    );
    const entry = status().backgroundWork.find((w) => w.pid === pid);
    expect(entry?.description).toHaveLength(200);
    inside(`kill -9 ${pid} 2>/dev/null || true`);
  });

  it("drops an unusable log path rather than publishing a truncated one", () => {
    // A description is read, so clipping it keeps most of its meaning. A log path
    // is followed: a prefix looks well-formed and opens nothing, so it goes.
    const pid = Number(
      inside(
        `node -e 'const c=require("child_process").spawn("sleep",["905"],{detached:true,stdio:"ignore"});c.unref();console.log(c.pid)'`,
      ),
    );
    const code = inside(
      `curl -s -o /dev/null -w '%{http_code}' --noproxy '*' -X POST ` +
        `-H 'Content-Type: application/json' ` +
        `-d '{"pid":${pid},"log":"/tmp/${"d".repeat(1200)}/x.log"}' ` +
        `http://127.0.0.1:8080/api/declared-processes`,
    );
    const entry = status().backgroundWork.find((w) => w.pid === pid);
    inside(`kill -9 ${pid} 2>/dev/null || true`);
    expect(code, "an unusable path must not fail the declaration").toBe("204");
    expect(entry, "the declaration itself must stand").toBeDefined();
    expect(entry && "log" in entry).toBe(false);
  });

  it("kills what nothing can reach and spares the rest", async () => {
    const reaped = await until(
      "a sweep",
      () => {
        const log = logs();
        return log.includes("orphaned process(es); reaping") ? log : null;
      },
      SWEEP_WAIT_MS,
    );

    // Asserted first and unconditionally: a reaper that failed closed (an
    // unreadable cgroup, say) would spare everything and pass every row below.
    expect(alive(planted.leak), "a leak with no socket must be reaped").toBe(
      false,
    );
    expect(
      alive(planted.outbound),
      "an outbound-only connection is the shape of #3038 and must be reaped",
    ).toBe(false);

    expect(alive(declared), "a declared process must be spared").toBe(true);
    expect(
      alive(grandchild),
      "an orphaned grandchild of live declared work must be spared",
    ).toBe(true);
    expect(alive(planted.unixListener), "a unix listener must be spared").toBe(
      true,
    );
    expect(alive(planted.tcpListener), "a tcp listener must be spared").toBe(
      true,
    );

    expect(reaped).toContain("keeping " + planted.unixListener);
    expect(reaped).toContain("keeping " + planted.tcpListener);
  });

  it("stops holding the pod once the declared work ends", async () => {
    inside(`kill -9 ${declared} ${grandchild} 2>/dev/null || true`);
    await until("the declaration to be pruned", () =>
      status().backgroundWork.some((w) => w.pid === declared) ? null : true,
    );
    inside(
      `kill -9 ${planted.unixListener} ${planted.tcpListener} 2>/dev/null || true`,
    );
    await until("the runtime to report idle", () =>
      status().idle ? true : null,
    );
  });
});
