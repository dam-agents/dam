import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";

export interface KubeTarget {
  context?: string;
  namespace: string;
  pod: string;
  container: string;
}

function kubectlExecArgs(target: KubeTarget, script: string): string[] {
  const args = ["exec", "-i", "-n", target.namespace, target.pod];
  if (target.context) args.unshift("--context", target.context);
  args.push("-c", target.container, "--", "sh", "-c", script);
  return args;
}

function runKubectl(
  target: KubeTarget,
  script: string,
  stdin?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("kubectl", kubectlExecArgs(target, script), {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", fail);
    child.stdin.on("error", (error) =>
      fail(new Error(`kubectl exec stdin failed: ${error.message}`)),
    );
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) resolve(stdout);
      else
        reject(
          new Error(`kubectl exec failed (exit ${code}): ${stderr.trim()}`),
        );
    });
    if (stdin !== undefined) {
      const flush = (): void => {
        if (child.stdin.write(stdin)) child.stdin.end();
        else child.stdin.once("drain", () => child.stdin.end());
      };
      flush();
    } else {
      child.stdin.end();
    }
  });
}

export async function writePodFile(
  target: KubeTarget,
  path: string,
  content: string,
): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const encoded = gzipSync(Buffer.from(content)).toString("base64");
  await runKubectl(
    target,
    `mkdir -p '${dir}' && base64 -d | gzip -dc > '${path}'`,
    encoded,
  );
  const size = await podFileSize(target, path);
  const expected = Buffer.byteLength(content);
  if (size !== expected) {
    throw new Error(
      `seeded file size mismatch at ${path}: wrote ${expected}, pod reports ${size}`,
    );
  }
}

export async function podFileSize(
  target: KubeTarget,
  path: string,
): Promise<number> {
  const out = await runKubectl(target, `wc -c < '${path}'`);
  return parseInt(out.trim(), 10);
}

export interface SessionMetaEntry {
  meta: { mode: string; type: string };
  createdAt: string;
  seenAt: string;
}

export async function mergeSessionMetadata(
  target: KubeTarget,
  homeDir: string,
  entries: Record<string, SessionMetaEntry>,
): Promise<number> {
  const entriesPath = "/tmp/bench-session-meta.json";
  const storePath = `${homeDir}/.platform/session-metadata.json`;
  await writePodFile(target, entriesPath, JSON.stringify(entries));
  const script = [
    "const fs = require('fs');",
    `const add = JSON.parse(fs.readFileSync('${entriesPath}', 'utf8'));`,
    "let cur = { sessions: {}, tombstones: [] };",
    `try { cur = JSON.parse(fs.readFileSync('${storePath}', 'utf8')); } catch {}`,
    "cur.sessions = Object.assign({}, cur.sessions, add);",
    `fs.mkdirSync('${homeDir}/.platform', { recursive: true });`,
    `fs.writeFileSync('${storePath}', JSON.stringify(cur, null, 2));`,
    "console.log(Object.keys(cur.sessions).length);",
  ].join(" ");
  const out = await runKubectl(
    target,
    `node -e "${script}" && rm -f '${entriesPath}'`,
  );
  return parseInt(out.trim(), 10);
}

export async function deletePodFile(
  target: KubeTarget,
  path: string,
): Promise<void> {
  await runKubectl(target, `rm -f '${path}'`);
}
