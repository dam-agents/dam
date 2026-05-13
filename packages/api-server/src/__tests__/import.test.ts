import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { create as createTar } from "tar";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { client } from "./helpers/trpc-client.js";
import { waitForPodReady } from "./helpers/kubectl.js";

const API_BASE = "http://localtest.me:5555";

let AGENT_ID: string;
let INSTANCE_ID: string;
let TOKEN: string;

beforeAll(async () => {
  TOKEN = inject("authToken") as string;
  // Need an image that bakes in agent-runtime — alpine has no HTTP server
  // on the harness port and waitForPodReady would just time out. The
  // claude-code template ships with the runtime; same image schedules
  // tests rely on.
  const agent = await client.agents.create.mutate({
    name: "test-import-agent",
    templateId: "claude-code",
    description: "import e2e",
  });
  AGENT_ID = agent.id;
  const inst = await client.instances.create.mutate({
    name: "test-import-inst",
    agentId: AGENT_ID,
  });
  INSTANCE_ID = inst.id;
  await waitForPodReady(`${INSTANCE_ID}-0`, 240_000);
});

afterAll(async () => {
  try { await client.instances.delete.mutate({ id: INSTANCE_ID }); } catch {}
  try { await client.agents.delete.mutate({ id: AGENT_ID }); } catch {}
});

async function buildBundle(files: Record<string, string>): Promise<Buffer> {
  const src = mkdtempSync(join(tmpdir(), "import-fixture-"));
  try {
    const topLevel = new Set<string>();
    for (const [path, content] of Object.entries(files)) {
      const abs = join(src, path);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content);
      topLevel.add(path.split("/")[0]);
    }
    const chunks: Buffer[] = [];
    for await (const chunk of createTar({ cwd: src, gzip: true }, [...topLevel])) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
}

async function postImport(bundle: Buffer): Promise<{ status: number; body: string }> {
  const form = new FormData();
  form.set("bundle", new Blob([new Uint8Array(bundle)], { type: "application/gzip" }), "bundle.tar.gz");
  const res = await fetch(`${API_BASE}/api/instances/${INSTANCE_ID}/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: form,
  });
  return { status: res.status, body: await res.text() };
}

async function readFile(path: string): Promise<string | null> {
  const res = await fetch(
    `${API_BASE}/api/instances/${INSTANCE_ID}/trpc/files.read?input=${encodeURIComponent(JSON.stringify({ path }))}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } },
  );
  const text = await res.text();
  if (res.status !== 200) return null;
  const body = JSON.parse(text) as { result?: { data?: { content?: string } } };
  return body.result?.data?.content ?? null;
}

describe("import (e2e)", () => {
  it("lands the bundle under <agenthome>/work and merges with existing files", async () => {
    const first = await postImport(await buildBundle({
      "CLAUDE.md": "# project context\n",
      ".claude/settings.json": "{}\n",
      "keep-me.txt": "original\n",
    }));
    expect(first.status, first.body).toBe(200);
    expect((JSON.parse(first.body) as { filesWritten: number }).filesWritten).toBe(3);

    expect(await readFile("work/CLAUDE.md")).toContain("project context");
    expect(await readFile("work/keep-me.txt")).toContain("original");

    // Second import: overlaps on CLAUDE.md, leaves keep-me.txt alone, adds a
    // new file. Verifies the merge semantics (bundle wins on conflict;
    // unrelated existing files survive).
    const second = await postImport(await buildBundle({
      "CLAUDE.md": "# updated context\n",
      "new-file.md": "fresh\n",
    }));
    expect(second.status, second.body).toBe(200);

    expect(await readFile("work/CLAUDE.md")).toContain("updated context");
    expect(await readFile("work/keep-me.txt")).toContain("original");
    expect(await readFile("work/new-file.md")).toContain("fresh");
  }, 180_000);
});
