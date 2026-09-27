// TEST_OVERVIEW: a soak of one agent on the vm Backend at the smolvm release the runner pins, run on demand by `mise run e2e:vm-soak` and nightly by CI's vm-soak workflow, never in the smoke tier. It targets two ways a microVM has been seen to fail where a pod does not: a guest that exits silently under sustained load, and a machine whose network does not come back after a stop and a start. The load phase keeps several multi-megabyte files moving through the files API — through the published port, the guest's network and its HOME disk — with a chat turn at intervals, and fails as soon as a read differs from its write or the runner reports that it revived the guest. The cycle phase then stops and starts the machine again and again, and after every start reads back every marker written so far, moves a large file across the network again and holds a chat turn. E2E_VM_SOAK_CYCLES and E2E_VM_SOAK_LOAD_MINUTES size the two phases.
import { createHash, randomBytes } from "node:crypto";

import { expect } from "@playwright/test";

import {
  openAgentChat,
  sendMessageToAgent,
  setMockAgentReply,
} from "../../lib/agents.js";
import { createRefreshingApiClient } from "../../lib/api-client.js";
import { acceptTerms } from "../../lib/auth.js";
import {
  createAgentOn,
  expectHomeFile,
  readHomeFile,
  refreshingToken,
  requireBackend,
  test,
  waitAgentState,
  writeHomeFile,
} from "../../lib/backend.js";
import { harnessName } from "../../lib/fixtures.js";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0)
    throw new Error(`${name} must be a whole number, got "${raw}"`);
  return value;
}

const cycles = envInt("E2E_VM_SOAK_CYCLES", 20);
const loadMinutes = envInt("E2E_VM_SOAK_LOAD_MINUTES", 15);
const loadLanes = 3;
const loadFileBytes = 4 * 1024 * 1024;
const chatEveryRounds = 10;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function payload(): string {
  return randomBytes(loadFileBytes / 2).toString("hex");
}

test("a vm agent survives sustained load and repeated stop/start cycles", async ({
  backend,
  page,
}) => {
  test.setTimeout((loadMinutes + cycles * 8 + 30) * 60_000);

  const token = refreshingToken();
  const api = createRefreshingApiClient(token);
  await requireBackend(api, backend);
  await acceptTerms(api);

  const agentName = `e2e-${backend}-soak`;
  const agentId = await createAgentOn(api, backend, agentName, harnessName, {
    neverIdle: true,
  });
  const markers = new Map<string, string>();
  let turns = 0;

  async function chatTurn(label: string): Promise<void> {
    turns += 1;
    const reply = `soak-reply-${turns}-${label}`;
    await setMockAgentReply(api, agentId, reply);
    await openAgentChat(page, agentName, agentId, { cardTimeoutMs: 120_000 });
    await sendMessageToAgent(page, `soak-prompt-${turns}`);
    await expect(page.getByText(reply)).toBeVisible({ timeout: 90_000 });
  }

  async function roundTrip(path: string): Promise<void> {
    const content = payload();
    await writeHomeFile(token, agentId, path, content);
    const read = await readHomeFile(token, agentId, path);
    expect(sha256(read), `${path} read back different bytes`).toBe(
      sha256(content),
    );
  }

  async function expectNotRevived(when: string): Promise<void> {
    const agent = await api.agents.get.query({ id: agentId });
    expect(
      agent.podRestarts,
      `the runner revived the guest ${when} (${agent.podRestartReason ?? "no reason"})`,
    ).toBe(0);
    expect(agent.state, `the agent left running ${when}`).toBe("running");
  }

  async function writeMarker(path: string): Promise<void> {
    const content = `${path}-${randomBytes(16).toString("hex")}`;
    await writeHomeFile(token, agentId, path, content);
    markers.set(path, content);
  }

  try {
    await test.step("boot the vm agent", async () => {
      await waitAgentState(api, agentId, "running", { timeoutMs: 900_000 });
      await writeMarker("soak-marker-boot.txt");
      await chatTurn("boot");
    });

    await test.step(`sustained load for ${loadMinutes} min`, async () => {
      const deadline = Date.now() + loadMinutes * 60_000;
      let rounds = 0;
      while (Date.now() < deadline) {
        await Promise.all(
          Array.from({ length: loadLanes }, (_, lane) =>
            roundTrip(`soak-load-${lane}.txt`),
          ),
        );
        rounds += 1;
        await expectNotRevived(`in load round ${rounds}`);
        if (rounds % chatEveryRounds === 0) await chatTurn(`load-${rounds}`);
      }
      test.info().annotations.push({
        type: "soak-load",
        description: `${rounds} rounds of ${loadLanes} x ${loadFileBytes} bytes written and read back`,
      });
    });

    for (let cycle = 1; cycle <= cycles; cycle++) {
      await test.step(`stop/start cycle ${cycle} of ${cycles}`, async () => {
        await writeMarker(`soak-marker-cycle-${cycle}.txt`);
        await api.agents.stop.mutate({ id: agentId });
        await waitAgentState(api, agentId, "hibernated");
        const woke = Date.now();
        await api.agents.wake.mutate({ id: agentId });
        await waitAgentState(api, agentId, "running");
        for (const [path, content] of markers)
          await expectHomeFile(token, agentId, path, content, {
            timeoutMs: 120_000,
          });
        const servedAfterS = Math.round((Date.now() - woke) / 1000);
        await roundTrip("soak-cycle-network.txt");
        await chatTurn(`cycle-${cycle}`);
        await expectNotRevived(`after start ${cycle}`);
        test.info().annotations.push({
          type: "soak-cycle",
          description: `cycle ${cycle}: HOME served ${servedAfterS}s after wake`,
        });
      });
    }
  } finally {
    await api.agents.delete.mutate({ id: agentId });
  }
});
