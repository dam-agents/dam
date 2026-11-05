// TEST_OVERVIEW: "Reset user onboarding" asks first, and only its confirmation changes anything: the reset, the fresh answers, the released one-shot and the entry route happen in that order, so the person is routed by the same first-open logic a new person is. Cancel leaves every one of them alone.
import { describe, expect, it } from "vitest";

import {
  RESET_ONBOARDING_TITLE,
  resetOnboardingBody,
  runResetOnboarding,
} from "../../modules/assistants/lib/reset-onboarding.js";

function world(confirmed: boolean) {
  const steps: string[] = [];
  return {
    steps,
    deps: {
      assistantName: "Dambledore",
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

describe("resetting a person's onboarding", () => {
  // TEST_SCENARIO: the person confirms: the reset runs, the answers are fetched again, the one-shot is released and only then does the app go to its entry route, in that order.
  it("resets, refreshes, releases the landing, then goes home", async () => {
    const w = world(true);
    expect(await runResetOnboarding(w.deps)).toBe(true);
    expect(w.steps).toEqual([
      `confirm:${RESET_ONBOARDING_TITLE}:Reset`,
      "reset",
      "refresh",
      "release",
      "home",
    ]);
  });

  // TEST_SCENARIO: cancel does nothing at all — no reset, no refetch, no landing, no navigation.
  it("does nothing when the person cancels", async () => {
    const w = world(false);
    expect(await runResetOnboarding(w.deps)).toBe(false);
    expect(w.steps).toEqual([`confirm:${RESET_ONBOARDING_TITLE}:Reset`]);
  });

  // TEST_SCENARIO: the dialog says what starts again and that nothing is deleted, naming the install's own assistant.
  it("says what starts again and that nothing is deleted", () => {
    expect(resetOnboardingBody("Dambledore")).toBe(
      "Dambledore greets you as on your first open again, and the Get started checklist starts over. Nothing is deleted: not your assistant, its chats or its files.",
    );
  });
});
