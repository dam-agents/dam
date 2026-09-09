import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Command } from "commander";

import { ensureAgentReachable, measureSessionLoad } from "./client.js";
import { synthesizeSessionFile } from "./fixture.js";
import { loadManifest, saveManifest, type Manifest } from "./manifest.js";
import { appendSample, readSamples, summarize } from "./report.js";
import {
  mergeSessionMetadata,
  writePodFile,
  type KubeTarget,
  type SessionMetaEntry,
} from "./seeder.js";

const TEMPLATE_PATH = fileURLToPath(
  new URL("../fixtures/seed-session.jsonl", import.meta.url),
);

function projectSlug(workdir: string): string {
  return workdir.replace(/[^A-Za-z0-9-]/g, "-");
}

function sessionFilePath(workdir: string, sessionId: string): string {
  const home = workdir.split("/").slice(0, 3).join("/");
  return `${home}/.claude/projects/${projectSlug(workdir)}/${sessionId}.jsonl`;
}

function manifestPath(resultsDir: string, env: string): string {
  return `${resultsDir}/manifest-${env}.json`;
}

function homeDir(workdir: string): string {
  return workdir.split("/").slice(0, 3).join("/");
}

function chatMetaEntries(
  sessionIds: string[],
): Record<string, SessionMetaEntry> {
  const now = new Date().toISOString();
  return Object.fromEntries(
    sessionIds.map((sessionId) => [
      sessionId,
      {
        meta: { mode: "chat", type: "regular" },
        createdAt: now,
        seenAt: now,
      },
    ]),
  );
}

const RESTART_REMINDER =
  "session metadata merged on disk; restart the agent so the runtime re-reads it (its in-memory copy wins otherwise)";

function requireToken(explicit: string | undefined): string {
  const token = explicit ?? process.env.PLATFORM_BENCH_TOKEN;
  if (!token) {
    throw new Error(
      "no token: pass --token or set PLATFORM_BENCH_TOKEN (any keycloak bearer or api key accepted by the ACP relay)",
    );
  }
  return token;
}

const program = new Command();
program
  .name("bench")
  .description(
    "Repeatable session/load latency benchmark against the ACP relay",
  );

program
  .command("seed")
  .description("Synthesize fixture sessions and write them onto the agent pod")
  .requiredOption("--env <name>", "environment tag recorded in results")
  .requiredOption("--agent <id>", "agent id (pod <id>-0 must be running)")
  .requiredOption("--namespace <ns>", "kubernetes namespace of the agent pod")
  .option("--context <ctx>", "kubectl context")
  .requiredOption("--label <label>", "conversation label, e.g. short or long")
  .option("--repetitions <k>", "template repetitions per session", "1")
  .option("--count <n>", "number of sessions to seed", "10")
  .option("--workdir <dir>", "agent working directory", "/home/agent/work")
  .option("--results-dir <dir>", "results directory", "results")
  .action(async (opts) => {
    const template = readFileSync(TEMPLATE_PATH, "utf8");
    const repetitions = parseInt(opts.repetitions, 10);
    const count = parseInt(opts.count, 10);
    const file = manifestPath(opts.resultsDir, opts.env);
    const manifest: Manifest = loadManifest(file) ?? {
      env: opts.env,
      agentId: opts.agent,
      namespace: opts.namespace,
      context: opts.context,
      workdir: opts.workdir,
      sessions: [],
    };
    if (manifest.agentId !== opts.agent) {
      throw new Error(
        `manifest ${file} targets agent ${manifest.agentId}, not ${opts.agent}; use a fresh --results-dir or --env`,
      );
    }
    const target: KubeTarget = {
      context: opts.context,
      namespace: opts.namespace,
      pod: `${opts.agent}-0`,
      container: "agent",
    };
    const seededIds: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const sessionId = randomUUID();
      const content = synthesizeSessionFile({
        template,
        sessionId,
        cwd: opts.workdir,
        repetitions,
      });
      await writePodFile(
        target,
        sessionFilePath(opts.workdir, sessionId),
        content,
      );
      manifest.sessions.push({
        sessionId,
        label: opts.label,
        repetitions,
        bytes: Buffer.byteLength(content),
        loads: 0,
      });
      saveManifest(file, manifest);
      console.log(
        `seeded ${opts.label} session ${i + 1}/${count}: ${sessionId} (${Buffer.byteLength(content)} bytes, x${repetitions})`,
      );
      seededIds.push(sessionId);
    }
    const total = await mergeSessionMetadata(
      target,
      homeDir(opts.workdir),
      chatMetaEntries(seededIds),
    );
    console.log(
      `merged chat metadata for ${seededIds.length} sessions (store now has ${total})`,
    );
    console.log(RESTART_REMINDER);
  });

program
  .command("annotate")
  .description(
    "Merge chat session metadata on the pod for every manifest session",
  )
  .requiredOption("--env <name>", "environment tag, must match a manifest")
  .option("--results-dir <dir>", "results directory", "results")
  .action(async (opts) => {
    const file = manifestPath(opts.resultsDir, opts.env);
    const manifest = loadManifest(file);
    if (!manifest) throw new Error(`no manifest at ${file}; run seed first`);
    const target: KubeTarget = {
      context: manifest.context,
      namespace: manifest.namespace,
      pod: `${manifest.agentId}-0`,
      container: "agent",
    };
    const total = await mergeSessionMetadata(
      target,
      homeDir(manifest.workdir),
      chatMetaEntries(manifest.sessions.map((s) => s.sessionId)),
    );
    console.log(
      `merged chat metadata for ${manifest.sessions.length} sessions (store now has ${total})`,
    );
    console.log(RESTART_REMINDER);
  });

program
  .command("run")
  .description(
    "Measure cold (first) and warm (second) loads of seeded sessions",
  )
  .requiredOption("--env <name>", "environment tag, must match a manifest")
  .requiredOption("--host <url>", "api-server base url")
  .option("--token <token>", "bearer token (default: PLATFORM_BENCH_TOKEN)")
  .requiredOption("--label <label>", "conversation label to measure")
  .option("--samples <n>", "max sessions to measure this run")
  .option("--results-dir <dir>", "results directory", "results")
  .action(async (opts) => {
    const file = manifestPath(opts.resultsDir, opts.env);
    const manifest = loadManifest(file);
    if (!manifest) throw new Error(`no manifest at ${file}; run seed first`);
    const token = requireToken(opts.token);
    const target = { host: opts.host, agentId: manifest.agentId, token };
    const samplesFile = `${opts.resultsDir}/samples.jsonl`;

    await ensureAgentReachable(target);
    console.log(`agent ${manifest.agentId} reachable, sampling...`);

    const sessions = manifest.sessions.filter((s) => s.label === opts.label);
    const limit = opts.samples
      ? Math.min(parseInt(opts.samples, 10), sessions.length)
      : sessions.length;
    for (const session of sessions.slice(0, limit)) {
      if (session.loads === 0) {
        const cold = await measureSessionLoad(target, session.sessionId);
        session.loads += 1;
        saveManifest(file, manifest);
        appendSample(samplesFile, {
          env: manifest.env,
          agentId: manifest.agentId,
          label: session.label,
          mode: "cold",
          sample: cold,
        });
        if (cold.events === 0) {
          console.warn(
            `WARNING: cold load of ${session.sessionId} replayed 0 events - fixture may not be loadable`,
          );
        }
        console.log(
          `cold ${session.sessionId}: total=${Math.round(cold.phases.responseMs)}ms ttfe=${Math.round(cold.phases.firstEventMs)}ms events=${cold.events}`,
        );
      }
      const warm = await measureSessionLoad(target, session.sessionId);
      session.loads += 1;
      saveManifest(file, manifest);
      appendSample(samplesFile, {
        env: manifest.env,
        agentId: manifest.agentId,
        label: session.label,
        mode: "warm",
        sample: warm,
      });
      console.log(
        `warm ${session.sessionId}: total=${Math.round(warm.phases.responseMs)}ms ttfe=${Math.round(warm.phases.firstEventMs)}ms events=${warm.events}`,
      );
    }
  });

program
  .command("report")
  .description("Print a p50/p95 summary of collected samples as markdown")
  .option("--results-dir <dir>", "results directory", "results")
  .action((opts) => {
    const rows = readSamples(`${opts.resultsDir}/samples.jsonl`);
    if (rows.length === 0) {
      console.log("no samples collected yet");
      return;
    }
    console.log(summarize(rows));
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
