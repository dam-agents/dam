import { describe, expect, it } from "vitest";

import { createOwnerActiveProbe } from "../../modules/api-keys/services/owner-active-probe.js";

/**
 * TEST_OVERVIEW: whether an API key's owner may still act. The probe answers
 * `active` only when the identity provider says so, and caches that answer for
 * a minute so a busy key costs one read; `inactive` is answered as it is; a
 * directory that does not answer is `unknown`, never `active`, because an API
 * key outlives the sign-in that made it and a probe that failed open would keep
 * a disabled person's key working for as long as the directory is down.
 */
describe("the owner-active probe", () => {
  // TEST_SCENARIO: the directory fails, and the answer is `unknown` on every call — nothing caches a success that was never given.
  it("answers unknown when the directory does not answer", async () => {
    let calls = 0;
    const probe = createOwnerActiveProbe({
      directory: {
        isActive: async () => {
          calls += 1;
          throw new Error("keycloak down");
        },
      },
    });
    expect(await probe("alice")).toBe("unknown");
    expect(await probe("alice")).toBe("unknown");
    expect(calls).toBe(2);
  });

  // TEST_SCENARIO: an owner the directory calls disabled is refused, and nothing keeps answering for them.
  it("answers inactive for a disabled owner", async () => {
    const probe = createOwnerActiveProbe({
      directory: { isActive: async () => false },
    });
    expect(await probe("alice")).toBe("inactive");
  });

  // TEST_SCENARIO: a success is kept for one minute — the ceiling on how long a person disabled now stays usable — and then asked again, so the refusal lands within it.
  it("keeps a success for a minute, then asks again", async () => {
    const answers = [true, false];
    let calls = 0;
    const probe = createOwnerActiveProbe({
      directory: { isActive: async () => answers[calls++] ?? false },
    });
    const started = Date.now();
    expect(await probe("alice")).toBe("active");
    expect(await probe("alice")).toBe("active");
    expect(calls).toBe(1);

    const realNow = Date.now;
    Date.now = () => started + 61_000;
    try {
      expect(await probe("alice")).toBe("inactive");
    } finally {
      Date.now = realNow;
    }
    expect(calls).toBe(2);
  });
});
