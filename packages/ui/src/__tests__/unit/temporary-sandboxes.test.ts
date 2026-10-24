import { describe, expect, test } from "vitest";

import { splitTemporarySandboxes } from "../../modules/agents/utils/temporary-sandboxes.js";
import type { AgentView } from "../../types.js";

const agent = (id: string, overrides: Partial<AgentView> = {}): AgentView => ({
  id,
  name: id,
  avatar: null,
  templateId: null,
  templateUpdate: null,
  features: { liveUpdates: true },
  kbTemplateId: null,
  starterKit: null,
  starterKitOnboarded: null,
  image: "x:latest",
  hibernationTimeoutMin: 60,
  requireConnectionAddress: false,
  whisper: true,
  grantedSecretIds: [],
  grantedConnectionIds: [],
  stopRequested: false,
  disabled: false,
  overBudget: false,
  state: "running",
  podRestarts: 0,
  contributionFailures: [],
  unsupportedContributionKinds: [],
  workspaceFailures: [],
  channels: [],
  spawnedBy: null,
  environmentOf: null,
  access: { role: "owner", editors: [] },
  ...overrides,
});

describe("splitTemporarySandboxes", () => {
  test("hides targets and counts them against the driver", () => {
    const { visible, temporaryCountByDriver } = splitTemporarySandboxes([
      agent("driver"),
      agent("t1", { spawnedBy: "driver" }),
      agent("t2", { spawnedBy: "driver" }),
      agent("plain"),
    ]);
    expect(visible.map((a) => a.id)).toEqual(["driver", "plain"]);
    expect(temporaryCountByDriver.get("driver")).toBe(2);
  });

  test("hides a hibernated target but keeps it out of the count", () => {
    const { visible, temporaryCountByDriver } = splitTemporarySandboxes([
      agent("driver"),
      agent("t1", { spawnedBy: "driver", state: "hibernated" }),
    ]);
    expect(visible.map((a) => a.id)).toEqual(["driver"]);
    expect(temporaryCountByDriver.size).toBe(0);
  });

  test("counts a starting target", () => {
    const { temporaryCountByDriver } = splitTemporarySandboxes([
      agent("t1", { spawnedBy: "driver", state: "starting" }),
    ]);
    expect(temporaryCountByDriver.get("driver")).toBe(1);
  });
});
