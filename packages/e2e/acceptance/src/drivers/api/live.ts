import { expect } from "@playwright/test";
import { createTRPCClient, createWSClient, wsLink } from "@trpc/client";
import type { AppRouter, LiveEvent } from "api-server-api";

import { baseUrl } from "../../config.js";
import type { World } from "../../world.js";
import type { LiveDriver } from "../driver.js";

const liveWithinMs = 10_000;

/**
 * UNIT_BOUNDARY_DESCRIPTION: an owner's live view over the public API: the one events subscription every browser tab holds, over the tRPC WebSocket. A change made elsewhere reaches it as a hint naming what changed, and the view re-reads that; the subscription opens with a sync hint, which says the view is up to date.
 */
export function apiLive(world: World): LiveDriver {
  const events = new Map<string, LiveEvent[]>();
  return {
    async watchAgents(person) {
      const received: LiveEvent[] = [];
      events.set(person.persona, received);
      const ws = createWSClient({
        url: `${baseUrl.replace(/^http/, "ws")}/api/trpc-ws`,
        connectionParams: { token: await person.token() },
        retryDelayMs: () => 3_600_000,
      });
      const api = createTRPCClient<AppRouter>({
        links: [wsLink({ client: ws })],
      });
      const sub = api.events.owner.subscribe(undefined, {
        onData: (event) => received.push(event),
      });
      world.closers.push(() => {
        sub.unsubscribe();
        ws.close();
      });
      await expect
        .poll(() => received.some((e) => e.topic === "sync"), {
          message: `${person.persona}'s live view never synced`,
        })
        .toBe(true);
    },
    async expectAgentChanged(person, agentName) {
      const received = events.get(person.persona);
      expect(received, `${person.persona} watches nothing`).toBeDefined();
      const { id } = world.agent(agentName);
      await expect
        .poll(
          () =>
            received!.some(
              (e) => e.topic === "agents" && "agentId" in e && e.agentId === id,
            ),
          {
            timeout: liveWithinMs,
            message: `${person.persona}'s live view heard nothing of ${agentName}`,
          },
        )
        .toBe(true);
    },
  };
}
