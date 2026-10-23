// TEST_OVERVIEW: The composer holds a prompt until the agent's provider lists are read, so a send never plans its provider on lists still loading or failed. Once they are read, it holds a prompt only for an agent with no provider and nothing to attach, and for a chat form that locks it.
import { describe, expect, it } from "vitest";

import { COMPOSER_LOCKED_REASON } from "../../modules/a2ui/lib/composer-lock.js";
import { composerBlock } from "../../modules/sessions/lib/composer-block.js";

const settled = {
  agentId: "agent-1",
  providers: { loaded: true, failed: false },
  noProviders: false,
  noGrantedProvider: false,
  sharedCurveBender: false,
  formLocked: false,
};

describe("the composer block", () => {
  // TEST_SCENARIO: while the provider lists load, the send would find nothing to attach, so the composer waits, and its block opens nothing when clicked.
  it("waits for the provider lists", () => {
    expect(
      composerBlock({
        ...settled,
        providers: { loaded: false, failed: false },
        sharedCurveBender: true,
      })?.kind,
    ).toBe("providers-loading");
  });

  // TEST_SCENARIO: a failed read of the provider lists is not an empty one: the composer says it failed rather than sending with no provider.
  it("holds the prompt when the provider lists failed", () => {
    expect(
      composerBlock({
        ...settled,
        providers: { loaded: false, failed: true },
      })?.kind,
    ).toBe("providers-failed");
  });

  // TEST_SCENARIO: a refetch that fails over lists already read keeps them, so the send plans on those and the composer stays open.
  it("stays open when a refetch fails over read lists", () => {
    expect(
      composerBlock({
        ...settled,
        providers: { loaded: true, failed: true },
      }),
    ).toBeNull();
  });

  // TEST_SCENARIO: with no agent selected nothing reads the lists, so the composer shows no loading block.
  it("does not wait with no agent", () => {
    expect(
      composerBlock({
        ...settled,
        agentId: null,
        providers: { loaded: false, failed: false },
      }),
    ).toBeNull();
  });

  // TEST_SCENARIO: an agent with no provider, on an owner with none, asks to connect one; with one the owner holds, it asks to attach it.
  it("asks for a provider when there is nothing to attach", () => {
    expect(
      composerBlock({ ...settled, noGrantedProvider: true, noProviders: true })
        ?.kind,
    ).toBe("connect");
    expect(composerBlock({ ...settled, noGrantedProvider: true })?.kind).toBe(
      "attach",
    );
  });

  // TEST_SCENARIO: the install's shared CurveBender is attached at send, so an agent holding no provider is not blocked.
  it("lets the send attach the shared CurveBender", () => {
    expect(
      composerBlock({
        ...settled,
        noGrantedProvider: true,
        sharedCurveBender: true,
      }),
    ).toBeNull();
  });

  // TEST_SCENARIO: a chat form that locks the composer still locks it once the providers are read.
  it("keeps the chat form lock", () => {
    expect(composerBlock({ ...settled, formLocked: true })).toEqual({
      kind: "form",
      reason: COMPOSER_LOCKED_REASON,
    });
  });

  it("lets a settled agent with a provider send", () => {
    expect(composerBlock(settled)).toBeNull();
  });
});
