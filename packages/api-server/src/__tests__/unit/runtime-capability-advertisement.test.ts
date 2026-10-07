/** TEST_OVERVIEW: how the hello payload reads the kind sets an agent
 *  advertises. The lists are a capability advertisement, not a command: an
 *  agent image is built at one commit and the api-server runs at another, so
 *  the two sets of known kinds never have to match. A kind the server does not
 *  recognise — one a later image added, or one a release removed while older
 *  images still advertise it — must therefore drop out of the parsed set and
 *  leave the rest of the handshake intact. Rejecting the payload instead would
 *  close the runtime channel for the whole fleet, and no trigger, schedule or
 *  harness-config event would reach any agent. */
import { describe, it, expect } from "vitest";
import { capabilities } from "agent-runtime-api";

describe("capabilities", () => {
  // TEST_SCENARIO: The ordinary case — an agent built at the same commit as the server advertises kinds the server knows, and gets all of them back.
  it("keeps every kind it recognises", () => {
    expect(
      capabilities.parse({
        contributions: ["env", "skill-ref"],
        events: ["trigger", "harness-config"],
      }),
    ).toEqual({
      contributions: ["env", "skill-ref"],
      events: ["trigger", "harness-config"],
    });
  });

  // TEST_SCENARIO: A pre-existing agent image still advertises an event kind a later release deleted from the enum. This is the fleet-breaking shape: every agent boots with the old set, so a rejected handshake takes down delivery everywhere. The unknown kind is dropped and the handshake stands.
  it("drops a kind it does not recognise", () => {
    expect(
      capabilities.parse({
        contributions: ["env", "a-contribution-kind-from-another-release"],
        events: ["trigger", "experiment-execute"],
      }),
    ).toEqual({ contributions: ["env"], events: ["trigger"] });
  });

  // TEST_SCENARIO: An agent that advertises nothing the server knows still completes the handshake — it receives an empty payload from capability filtering, which is a degraded agent, not a broken channel.
  it("accepts a set with no recognised kind in it", () => {
    expect(
      capabilities.parse({
        contributions: ["something-else"],
        events: ["something-else"],
      }),
    ).toEqual({ contributions: [], events: [] });
  });

  // TEST_SCENARIO: Looseness covers unknown members, not a malformed advertisement. A kind list that is not a list of strings is a broken client, and the handshake is refused so the fault is visible.
  it("refuses an advertisement that is not a list of kinds", () => {
    expect(
      capabilities.safeParse({ contributions: "env", events: [] }).success,
    ).toBe(false);
    expect(
      capabilities.safeParse({ contributions: [], events: [42] }).success,
    ).toBe(false);
  });
});
