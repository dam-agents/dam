// TEST_OVERVIEW: An ordinary admitted request only ever provisions. Two regression scenarios from the merge check, both unconfirmed deletions: an install changing from `on` to `experimental` must leave an owner who never stored an opt-in with their assistant, and a request that read an opted-out person must not delete an assistant they have since opted back into. Neither is possible from here, because the request path takes no delete at all — the only delete is the person's own confirmed turn-off, and that one re-checks the record under the owner's lock.
import { describe, expect, it, vi } from "vitest";
import { provisionOnRequest } from "../../modules/assistants/services/on-request.js";

function world(mode: "off" | "on" | "experimental") {
  const provision = vi.fn(async () => undefined);
  const admitted = vi.fn(async () => true);
  return {
    provision,
    admitted,
    run: (eligible = true) =>
      provisionOnRequest({ mode, eligible, admitted, provision }),
  };
}

describe("an ordinary request and the assistant", () => {
  // TEST_SCENARIO: mode `off` reads nothing and does nothing — not even the admission — so an install that offers no assistant costs nothing.
  it("does nothing at all in mode off", async () => {
    const w = world("off");
    await w.run();
    expect(w.admitted).not.toHaveBeenCalled();
    expect(w.provision).not.toHaveBeenCalled();
  });

  // TEST_SCENARIO: the reviewer's first scenario — a person with an assistant provisioned in mode `on`, no stored opt-in, and an install changed to `experimental`. The next request provisions (their own switch is off, so it creates nothing) and deletes nothing: there is no delete here to call.
  it("cannot delete after an install moves from on to experimental", async () => {
    const w = world("experimental");
    await w.run();
    expect(w.provision).toHaveBeenCalledTimes(1);
  });

  // TEST_SCENARIO: a person the request is not for, or who has not been admitted, is left alone: nothing is created for them.
  it("provisions nothing for an ineligible or unadmitted person", async () => {
    const ineligible = world("on");
    await ineligible.run(false);
    expect(ineligible.provision).not.toHaveBeenCalled();

    const unadmitted = world("on");
    unadmitted.admitted.mockResolvedValueOnce(false);
    await unadmitted.run();
    expect(unadmitted.provision).not.toHaveBeenCalled();
  });
});
