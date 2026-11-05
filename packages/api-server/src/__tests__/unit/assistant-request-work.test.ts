// TEST_OVERVIEW: What one admitted request does about the assistant. An install whose mode is off does nothing and reads nothing; `on` provisions for everyone, since that mode leaves nobody opted out; `experimental` provisions for a person with the switch on and otherwise reconciles, which is where an opt-out whose delete could not take the owner's lock is finished.
import { describe, expect, it } from "vitest";
import { assistantRequestWork } from "../../modules/assistants/domain/on-request.js";

describe("what a request does about the assistant", () => {
  // TEST_SCENARIO: the mode decides first: off does nothing at all, on provisions whoever the stored switch says, and experimental follows that switch — provision when on, reconciliation when off.
  it("follows the mode, and the switch only in experimental", () => {
    expect(assistantRequestWork("off", false)).toBe("none");
    expect(assistantRequestWork("off", true)).toBe("none");
    expect(assistantRequestWork("on", false)).toBe("provision");
    expect(assistantRequestWork("on", true)).toBe("provision");
    expect(assistantRequestWork("experimental", true)).toBe("provision");
    expect(assistantRequestWork("experimental", false)).toBe("reconcile");
  });
});
