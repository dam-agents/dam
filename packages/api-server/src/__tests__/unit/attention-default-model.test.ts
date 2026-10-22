// TEST_OVERVIEW: Home lists the default-model notices beside the attention record. A dismissal of a notice lasts only while that notice holds, so the same state coming back later is shown again, and a failing notice read leaves the rest of the feed working.
import { describe, expect, it, vi } from "vitest";
import type { DefaultModelNotice } from "api-server-api";

import type { DismissalRow } from "../../modules/attention/domain/types.js";
import type { AttentionRepository } from "../../modules/attention/infrastructure/attention-repository.js";
import { createAttentionService } from "../../modules/attention/services/attention-service.js";

const notSet: DefaultModelNotice = {
  id: "agent-a:not-set",
  agentId: "agent-a",
  kinds: ["chat", "channel", "scheduled"],
  state: "not-set",
  harness: "claude-code",
  model: null,
  changedFrom: null,
};

const dismissal = (
  kind: DismissalRow["kind"],
  itemId: string,
): DismissalRow => ({
  kind,
  itemId,
  dismissedAt: new Date("2026-10-01T10:00:00Z"),
});

function service(
  dismissals: DismissalRow[],
  notices: () => Promise<DefaultModelNotice[]>,
) {
  const deleteDismissals = vi.fn(async () => {});
  const repo = {
    listForOwner: async () => [],
    listDismissals: async () => dismissals,
    deleteDismissals,
  } as unknown as AttentionRepository;
  return {
    deleteDismissals,
    attention: createAttentionService({
      repo,
      ownerSub: "owner-1",
      ownsApproval: async () => false,
      ownsAgent: async () => true,
      defaultModelNotices: notices,
      outageAlerts: async () => [],
      log: () => {},
    }),
  };
}

describe("attention.listForOwner with default-model notices", () => {
  // TEST_SCENARIO: a dismissal whose notice still holds is kept; one whose notice resolved (a default was saved, the agent is gone) is deleted and not returned, while other kinds of dismissal are left alone.
  it("drops the dismissal of a notice that no longer holds", async () => {
    const { attention, deleteDismissals } = service(
      [
        dismissal("default-model", "agent-a:not-set"),
        dismissal("default-model", "agent-b:provider-gone"),
        dismissal("approval", "ap-1"),
      ],
      async () => [notSet],
    );
    const list = await attention.listForOwner();
    expect(list.defaultModels).toEqual([notSet]);
    expect(list.dismissed.map((d) => d.id)).toEqual([
      "agent-a:not-set",
      "ap-1",
    ]);
    expect(deleteDismissals).toHaveBeenCalledWith("owner-1", "default-model", [
      "agent-b:provider-gone",
    ]);
  });

  // TEST_SCENARIO: when the notices cannot be read, the feed still answers with its sessions and dismissals, and no dismissal is deleted for a notice that only failed to load.
  it("keeps the feed and the dismissals when the notices fail", async () => {
    const { attention, deleteDismissals } = service(
      [dismissal("default-model", "agent-a:not-set")],
      async () => {
        throw new Error("agent store unavailable");
      },
    );
    const list = await attention.listForOwner();
    expect(list.defaultModels).toEqual([]);
    expect(list.dismissed.map((d) => d.id)).toEqual(["agent-a:not-set"]);
    expect(deleteDismissals).not.toHaveBeenCalled();
  });
});
