import { describe, expect, it } from "vitest";

import { createReadyWatch } from "../../modules/agents/infrastructure/ready-watch.js";
import type { KubeObject } from "../../modules/agents/infrastructure/k8s.js";

// TEST_OVERVIEW: state held back while an Agent was not Ready goes out when
// TEST_OVERVIEW: its Ready condition turns True again, once per transition.

function agent(ready: "True" | "False"): KubeObject {
  return {
    metadata: { name: "a1" },
    status: { conditions: [{ type: "Ready", status: ready }] },
  } as KubeObject;
}

describe("ready watch", () => {
  // TEST_SCENARIO: a grant rolls the gateway, Ready drops and comes back with
  // TEST_SCENARIO: the agent's machine untouched; only the return to True calls back.
  it("calls back when Ready turns True, not while it stays True", () => {
    const calls: string[] = [];
    const watch = createReadyWatch((id) => calls.push(id));
    watch("add", agent("True"));
    watch("update", agent("True"));
    watch("update", agent("False"));
    expect(calls).toEqual([]);
    watch("update", agent("True"));
    watch("update", agent("True"));
    expect(calls).toEqual(["a1"]);
  });

  // TEST_SCENARIO: an informer start or relist sees every Agent as "add"; a
  // TEST_SCENARIO: restarted api-server must not re-deliver to all of them.
  it("takes the first sighting as the baseline", () => {
    const calls: string[] = [];
    const watch = createReadyWatch((id) => calls.push(id));
    watch("add", agent("False"));
    watch("add", agent("True"));
    expect(calls).toEqual([]);
  });
});
