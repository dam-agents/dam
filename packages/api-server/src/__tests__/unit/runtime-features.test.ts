/** TEST_OVERVIEW: feature detection over a runtime's stored capability set.
 *  A runtime advertises which optional surfaces its image serves, and the
 *  platform reads one of those claims to decide whether it may watch that pod.
 *  The read must depend on the claim it is asking about and nothing else: a
 *  neighbouring member the platform's own schema does not know — a newer agent
 *  advertising something this replica predates — must not decide the answer,
 *  because that would put a newer runtime on the compatibility path and show
 *  it the outdated-runtime notice. Absence, a wrong type, and a missing
 *  capability set all mean the surface is not served. */
import { describe, it, expect } from "vitest";
import { runtimeFeaturesOf } from "agent-runtime-api";

describe("runtimeFeaturesOf", () => {
  // TEST_SCENARIO: The ordinary case — a runtime that serves the watch surface
  // claims it, and a runtime built before the surface existed says nothing.
  it("reads the claim a runtime makes", () => {
    expect(
      runtimeFeaturesOf({ contributions: [], events: [], liveUpdates: true }),
    ).toEqual({ liveUpdates: true });
    expect(runtimeFeaturesOf({ contributions: [], events: [] })).toEqual({
      liveUpdates: false,
    });
  });

  // TEST_SCENARIO: A newer agent advertises an event kind this replica's schema
  // does not know. Parsing the whole capability set would reject it wholesale
  // and report the watch surface as unserved, degrading a newer runtime to
  // polling. The claim being read is well-formed, so it must be honoured.
  it("honours the claim when a neighbouring member is unknown", () => {
    expect(
      runtimeFeaturesOf({
        contributions: ["something-new"],
        events: ["an-event-kind-from-a-later-release"],
        liveUpdates: true,
      }),
    ).toEqual({ liveUpdates: true });
  });

  // TEST_SCENARIO: Nothing outside the claim can decide it — a malformed
  // neighbour is still not this read's concern.
  it("honours the claim when a neighbouring member is malformed", () => {
    expect(
      runtimeFeaturesOf({
        events: null,
        harnessConfigCatalog: 42,
        liveUpdates: true,
      }),
    ).toEqual({ liveUpdates: true });
  });

  // TEST_SCENARIO: Detection fails closed. An agent that has never said hello
  // has no stored capability set, and a claim of the wrong shape is not a
  // claim — both leave the agent on the polled path, which serves every
  // runtime, rather than on a transport its image may not have.
  it("fails closed when the claim is absent or not a boolean", () => {
    expect(runtimeFeaturesOf(null)).toEqual({ liveUpdates: false });
    expect(runtimeFeaturesOf(undefined)).toEqual({ liveUpdates: false });
    expect(runtimeFeaturesOf({ liveUpdates: false })).toEqual({
      liveUpdates: false,
    });
    expect(runtimeFeaturesOf({ liveUpdates: "yes" })).toEqual({
      liveUpdates: false,
    });
    expect(runtimeFeaturesOf("not an object")).toEqual({ liveUpdates: false });
  });
});
