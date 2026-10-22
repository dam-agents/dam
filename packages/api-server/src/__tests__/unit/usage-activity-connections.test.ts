// TEST_OVERVIEW: the activity log records the Connections a user adds. The deployment's CurveBender is created for every user by the deployment itself, so it records none.
import type { Subscription } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { emit, EventType } from "../../events.js";
import type { ActivityEventRow } from "../../modules/usage/domain/types.js";
import { startPersistActivitySaga } from "../../modules/usage/sagas/persist-activity.js";

const rows: ActivityEventRow[] = [];
let sub: Subscription | null = null;

afterEach(() => {
  sub?.unsubscribe();
  sub = null;
  rows.splice(0);
});

const connectionCreated = (templateId: string) =>
  emit({
    type: EventType.ConnectionCreated,
    actorSub: "u1",
    connectionKey: "conn",
    templateId,
    kind: "oauth_app",
  });

describe("connection activity", () => {
  // TEST_SCENARIO: a user's own connection is still recorded, and the deployment's CurveBender, created by a listing every user makes, is not.
  it("records the user's own connection and not the deployment's", async () => {
    sub = startPersistActivitySaga({
      insert: async (row) => void rows.push(row),
    });

    connectionCreated("curve-bender-deployment");
    connectionCreated("curve-bender");

    await vi.waitFor(() => expect(rows).toHaveLength(1));
    expect(rows[0]).toMatchObject({
      type: "connection_added",
      payload: { templateId: "curve-bender" },
    });
  });
});
