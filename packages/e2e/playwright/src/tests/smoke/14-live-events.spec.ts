import { expect, test } from "@playwright/test";
import { TRPCClientError } from "@trpc/client";
import type { AppRouter, LiveEvent } from "api-server-api";

import {
  createApiClient,
  createWsApiClient,
  type ApiClient,
} from "../../lib/api-client.js";
import { acceptTerms, getAccessToken } from "../../lib/auth.js";
import { harnessName } from "../../lib/fixtures.js";

// TEST_OVERVIEW: The events.owner subscription end to end, against the real

const AGENT_NAME = "e2e-live-events";

function openOwnerStream(token: string) {
  const { api, close } = createWsApiClient(token);
  const pending: LiveEvent[] = [];
  let failure: unknown;
  const arrivals: Array<() => void> = [];
  const wake = () => arrivals.splice(0).forEach((w) => w());

  const sub = api.events.owner.subscribe(undefined, {
    onData(event) {
      pending.push(event);
      wake();
    },
    onError(err) {
      failure = err;
      wake();
    },
  });

  async function nextEvent(timeoutMs = 15_000): Promise<LiveEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const event = pending.shift();
      if (event) return event;
      if (failure) throw failure;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`no live event within ${timeoutMs}ms`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        arrivals.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  return {
    nextEvent,
    close: () => {
      sub.unsubscribe();
      close();
    },
  };
}

let token: string;
let api: ApiClient;
let agentId = "";
const mintedKeyIds: string[] = [];

test.beforeAll(async () => {
  token = await getAccessToken();
  api = createApiClient(token);
  await acceptTerms(api);
});

test.afterAll(async () => {
  if (agentId) await api.agents.delete.mutate({ id: agentId }).catch(() => {});
  for (const id of mintedKeyIds)
    await api.apiKeys.revoke.mutate({ id }).catch(() => {});
});

test.describe("events.owner live stream", () => {
  test("opens with a sync event", async () => {
    const stream = openOwnerStream(token);
    try {
      expect(await stream.nextEvent()).toEqual({ topic: "sync" });
    } finally {
      stream.close();
    }
  });

  test("a create over HTTP surfaces as an agents hint on the socket", async () => {
    test.setTimeout(120_000);

    const stream = openOwnerStream(token);
    try {
      expect(await stream.nextEvent()).toEqual({ topic: "sync" });

      const created = await api.agents.create.mutate({
        name: AGENT_NAME,
        templateId: harnessName,
      });
      agentId = created.id;

      for (;;) {
        const event = await stream.nextEvent(30_000);
        if (event.topic === "agents" && event.agentId === agentId) break;
      }
    } finally {
      stream.close();
    }
  });

  test("refuses an agent-bound API key", async () => {
    expect(agentId, "needs the agent from the previous test").toBeTruthy();
    const { key, plaintext } = await api.apiKeys.create.mutate({
      name: "e2e-live-events-bound",
      scopes: ["agents:read"],
      agentIds: [agentId],
    });
    mintedKeyIds.push(key.id);

    const stream = openOwnerStream(plaintext);
    try {
      const outcome = await stream.nextEvent().then(
        (event) => ({ event }),
        (err: unknown) => ({ err }),
      );
      expect("err" in outcome, "expected the stream to be refused").toBe(true);
      if ("err" in outcome) {
        expect(outcome.err).toBeInstanceOf(TRPCClientError);
        expect((outcome.err as TRPCClientError<AppRouter>).data?.code).toBe(
          "FORBIDDEN",
        );
      }
    } finally {
      stream.close();
    }
  });
});
