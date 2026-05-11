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

async function buildBundle(): Promise<Buffer> {
  const src = mkdtempSync(join(tmpdir(), "import-fixture-"));
  try {
    writeFileSync(join(src, "CLAUDE.md"), "# project context\n");
    mkdirSync(join(src, ".claude"));
    writeFileSync(join(src, ".claude/settings.json"), "{}\n");
    const chunks: Buffer[] = [];
    for await (const chunk of createTar({ cwd: src, gzip: true }, ["CLAUDE.md", ".claude"])) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    return Buffer.concat(chunks);
  } finally {
    rmSync(src, { recursive: true, force: true });
  }
}

describe("import (e2e)", () => {
  it("imports a bundle and the files appear in the agent's home dir", async () => {
    const bundle = await buildBundle();
    const form = new FormData();
    form.set("mode", "replace");
    form.set("bundle", new Blob([new Uint8Array(bundle)], { type: "application/gzip" }), "bundle.tar.gz");

    const res = await fetch(`${API_BASE}/api/instances/${INSTANCE_ID}/import`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: form,
    });
    expect(res.status, await res.text().catch(() => "")).toBe(200);
    const result = await res.json() as { filesWritten: number };
    expect(result.filesWritten).toBe(2);

    // Read CLAUDE.md back via the existing files tRPC, proxied through
    // /api/instances/:id/trpc/. tRPC's HTTP transport serializes single
    // calls as `?input=<json>` on GET.
    const readRes = await fetch(
      `${API_BASE}/api/instances/${INSTANCE_ID}/trpc/files.read?input=${encodeURIComponent(JSON.stringify({ path: "CLAUDE.md" }))}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(readRes.status, await readRes.text().catch(() => "")).toBe(200);
    const body = await readRes.json() as { result?: { data?: { content?: string } } };
    expect(body.result?.data?.content).toContain("project context");
  }, 180_000);
});
