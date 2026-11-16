// TEST_OVERVIEW: The confirm dialog an Agent's Update opens says what the update is for and what it costs, in one paragraph: the platform's name from the brand, the restart that interrupts ongoing work, and the question. It carries no image reference, no version and no release-notes link.
import { expect, it, vi } from "vitest";

vi.mock("../../brand.js", () => ({ getBrand: () => ({ name: "Acme" }) }));

const { updateDialogMessage } =
  await import("../../modules/agents/lib/update-copy.js");

// TEST_SCENARIO: the body is the product's sentence, with the name the install
// TEST_SCENARIO: renders, and nothing the owner has to decode.
it("names the platform, what the update is for and what it costs", () => {
  expect(updateDialogMessage()).toBe(
    "This agent needs to update to support the latest Acme features. Updating restarts the agent, interrupting ongoing work. Update now?",
  );
});
