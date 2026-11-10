// TEST_OVERVIEW: A new chat shows the CurveBender notice only when the person holds the deployment's shared CurveBender Connection and the chat's pair has answered: "setup" when the pair already runs on that Connection, "offer" otherwise, including when the pair read fails for lack of a default model.
import { describe, expect, it } from "vitest";

import { curveBenderNotice } from "../../modules/sessions/lib/curve-bender.js";

const onShared = { harness: "pi", provider: "conn-shared", model: "cb/x" };
const onOther = { harness: "claude-code", provider: "conn-ibm", model: null };
const base = {
  sessionId: null,
  sharedId: "conn-shared",
  pair: onShared,
  pairSettled: true,
};

describe("which CurveBender notice a chat shows", () => {
  // TEST_SCENARIO: a new chat whose pair runs on the shared Connection is told it is set up.
  it("says setup on the shared Connection", () => {
    expect(curveBenderNotice(base)).toBe("setup");
  });

  // TEST_SCENARIO: a new chat on another provider, or one whose pair read failed and so has no pair, is offered CurveBender.
  it("offers CurveBender elsewhere", () => {
    expect(curveBenderNotice({ ...base, pair: onOther })).toBe("offer");
    expect(curveBenderNotice({ ...base, pair: undefined })).toBe("offer");
  });

  // TEST_SCENARIO: an existing chat, a person without the shared Connection, and a pair still loading show nothing, so a chat on CurveBender never flashes the offer.
  it("shows nothing otherwise", () => {
    expect(curveBenderNotice({ ...base, sessionId: "s-1" })).toBeNull();
    expect(curveBenderNotice({ ...base, sharedId: undefined })).toBeNull();
    expect(
      curveBenderNotice({ ...base, pair: undefined, pairSettled: false }),
    ).toBeNull();
  });
});
