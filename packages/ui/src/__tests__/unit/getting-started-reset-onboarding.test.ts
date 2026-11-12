// TEST_OVERVIEW: the one onboarding reset, offered by the card at the bottom of
// TEST_OVERVIEW: Settings › Experimental features: it asks first, and only its
// TEST_OVERVIEW: confirmation changes anything — the reset, the fresh answers, and,
// TEST_OVERVIEW: for a person the assistant is on for, the released one-shot and the
// TEST_OVERVIEW: entry route, so they are routed by the same first-open logic a new
// TEST_OVERVIEW: person is. A person the assistant is off for keeps where they are.
// TEST_OVERVIEW: Cancel leaves every one of them alone.
import { describe, expect, it } from "vitest";

import {
  RESET_ONBOARDING_BODY,
  RESET_ONBOARDING_TITLE,
  runResetOnboarding,
} from "../../modules/getting-started/lib/reset-onboarding.js";

function world(confirmed: boolean, onboard = true) {
  const steps: string[] = [];
  return {
    steps,
    deps: {
      onboard,
      confirm: async (
        _body: string,
        title: string,
        options: { confirmLabel: string },
      ) => {
        steps.push(`confirm:${title}:${options.confirmLabel}`);
        return confirmed;
      },
      reset: async () => {
        steps.push("reset");
      },
      refresh: async () => {
        steps.push("refresh");
      },
      releaseLanding: () => {
        steps.push("release");
      },
      goHome: () => {
        steps.push("home");
      },
    },
  };
}

describe("restarting a person's onboarding", () => {
  // TEST_SCENARIO: the person confirms and the assistant is on for them: the reset runs, the answers are fetched again, the one-shot is released and only then does the app go to its entry route, in that order.
  it("resets, refreshes, releases the landing, then goes home", async () => {
    const w = world(true);
    expect(await runResetOnboarding(w.deps)).toBe(true);
    expect(w.steps).toEqual([
      `confirm:${RESET_ONBOARDING_TITLE}:Restart`,
      "reset",
      "refresh",
      "release",
      "home",
    ]);
  });

  // TEST_SCENARIO: the assistant is off for the person, so the checklist and its avatars start over and nothing takes them anywhere: there is no first open to be routed to.
  it("resets without routing a person the assistant is off for", async () => {
    const w = world(true, false);
    expect(await runResetOnboarding(w.deps)).toBe(true);
    expect(w.steps).toEqual([
      `confirm:${RESET_ONBOARDING_TITLE}:Restart`,
      "reset",
      "refresh",
    ]);
  });

  // TEST_SCENARIO: cancel does nothing at all — no reset, no refetch, no landing, no navigation.
  it("does nothing when the person cancels", async () => {
    const w = world(false);
    expect(await runResetOnboarding(w.deps)).toBe(false);
    expect(w.steps).toEqual([`confirm:${RESET_ONBOARDING_TITLE}:Restart`]);
  });

  // TEST_SCENARIO: the confirm says what starts again, that agents keep their avatars, and that nothing is deleted.
  it("says what starts again and that nothing is deleted", () => {
    expect(RESET_ONBOARDING_BODY).toBe(
      "Every avatar locks again and the Get started checklist starts over. Avatars already on your agents stay, and nothing in your account is deleted.",
    );
  });
});
