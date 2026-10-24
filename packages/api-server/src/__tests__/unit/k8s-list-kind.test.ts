import { describe, expect, it } from "vitest";
import { listCustomObjectsOrEmpty } from "../../modules/agents/infrastructure/k8s.js";

// TEST_OVERVIEW: A kind whose CRD has been retired holds no objects, and the absorb that follows a retirement must read that as an empty fleet rather than crash-loop. Any other read failure is still a failure: a Forbidden or a timeout must never become "nothing to absorb".

const failure = (code: number): Error =>
  Object.assign(new Error("api error"), { code });

describe("listing a kind that may no longer exist", () => {
  // TEST_SCENARIO: After the cluster-wide retirement the CRD is gone, and the API server answers 404 for the kind. That is an empty set, not a fault: a fresh install or a reinstall absorbs zero resources and writes its switch stamp.
  it("reads a missing kind as empty", async () => {
    expect(
      await listCustomObjectsOrEmpty(async () => {
        throw failure(404);
      }),
    ).toEqual([]);
    expect(await listCustomObjectsOrEmpty(async () => ["one"])).toEqual([
      "one",
    ]);
  });

  // TEST_SCENARIO: A 403 or a 500 is a read that did not happen, and an absorb that treated it as empty would delete every machine of a fleet it could not see. It propagates.
  it("propagates every other failure", async () => {
    for (const code of [403, 500, 503]) {
      await expect(
        listCustomObjectsOrEmpty(async () => {
          throw failure(code);
        }),
      ).rejects.toThrow("api error");
    }
  });
});
