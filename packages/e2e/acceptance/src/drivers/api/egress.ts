import { expect, test } from "@playwright/test";

import { waitingApprovals } from "../../egress.js";
import type { World } from "../../world.js";
import type { EgressDriver } from "../driver.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: an agent's egress over the public API: its rules, written and listed, and the network approvals that wait for its owner, answered once or always. Which approvals a chat shows is the web UI's, so those checks skip here; a verdict given in the chat is the same verdict given here.
 */
export function apiEgress(world: World): EgressDriver {
  const answerOnce = async (
    person: Parameters<EgressDriver["answer"]>[0],
    agentName: string,
  ) => {
    const held = world.held.get(agentName);
    expect(held, `${agentName} holds no request`).toBeDefined();
    await person.api.approvals.approveOnce.mutate({ id: held!.approvalId });
  };
  return {
    async allow(person, agentName, method, host, pathPattern) {
      const agentId = world.agent(agentName).id;
      const rule = await person.api.egressRules.create.mutate({
        agentId,
        host,
        method,
        pathPattern,
        verdict: "allow",
      });
      world.undo.push(() =>
        person.api.egressRules.revoke.mutate({ id: rule.id }),
      );
    },
    async expectRule(person, agentName, rule, present) {
      const rules = await person.api.egressRules.listForAgent.query({
        agentId: world.agent(agentName).id,
      });
      world.note({ step: "rules listed", agentName, rules });
      expect(
        rules.some(
          (r) =>
            r.host === rule.host &&
            r.method === rule.method &&
            r.pathPattern === rule.pathPattern &&
            r.verdict === rule.verdict,
        ),
      ).toBe(present);
    },
    async expectWaiting(person, agentName, request) {
      const agentId = world.agent(agentName).id;
      if (request === undefined) {
        expect(await waitingApprovals(person, agentId)).toHaveLength(0);
        return;
      }
      await expect
        .poll(
          async () => (await waitingApprovals(person, agentId, request)).length,
          {
            timeout: 30_000,
            message: `no approval waits for ${request.method} ${request.host}${request.path}`,
          },
        )
        .toBe(1);
    },
    async answer(person, agentName, verdict) {
      if (verdict === "once") return answerOnce(person, agentName);
      const held = world.held.get(agentName);
      expect(held, `${agentName} holds no request`).toBeDefined();
      await person.api.approvals.approvePermanent.mutate({
        id: held!.approvalId,
      });
    },
    async openChat() {
      test.skip(true, "which approvals a chat shows is the web UI's");
    },
    async expectWaitingInChat() {
      test.skip(true, "which approvals a chat shows is the web UI's");
    },
    answerOnceInChat: answerOnce,
  };
}
