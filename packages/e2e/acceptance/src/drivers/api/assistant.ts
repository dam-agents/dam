import { test } from "@playwright/test";

import type { World } from "../../world.js";
import type { AssistantDriver } from "../driver.js";

/**
 * UNIT_BOUNDARY_DESCRIPTION: the assistant over the public API: the person's own switch for it is a feature flag. Its greeting and the ideas it offers are drawn by the web UI, so those checks skip here.
 */
export function apiAssistant(world: World): AssistantDriver {
  return {
    async switchTo(person, on) {
      await person.api.features.setFlag.mutate({
        feature: "dambledore",
        enabled: on,
      });
      world.note({ step: "assistant switched", persona: person.persona, on });
    },
    async openChat() {
      test.skip(true, "the assistant's greeting is drawn by the web UI");
    },
    async expectGreeting() {
      test.skip(true, "the assistant's greeting is drawn by the web UI");
    },
    async pickIdea() {
      test.skip(true, "the assistant's ideas are drawn by the web UI");
    },
    async expectComposerHolds() {
      test.skip(true, "the composer is the web UI's");
    },
  };
}
