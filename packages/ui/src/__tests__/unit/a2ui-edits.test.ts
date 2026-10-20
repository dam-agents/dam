// TEST_OVERVIEW: the user's unsent chat form edits stay in the store per session under a key that survives a reload of the transcript, so a form is still filled in after the user works in another session and comes back.
import { A2UI_BASIC_CATALOG_ID as BASIC_CATALOG_ID } from "api-server-api/chat-forms";
import { describe, expect, test } from "vitest";
import { create } from "zustand";

import { buildConversation } from "../../modules/a2ui/lib/build-conversation.js";
import {
  a2uiEditKey,
  type A2uiSlice,
  createA2uiSlice,
} from "../../modules/a2ui/store.js";

const CREATE = JSON.stringify([
  {
    version: "v1.0",
    createSurface: {
      surfaceId: "team",
      catalogId: BASIC_CATALOG_ID,
      components: [{ id: "root", component: "Text", text: "Team" }],
      dataModel: { team: "" },
    },
  },
]);

const DELETE = JSON.stringify([
  { version: "v1.0", deleteSurface: { surfaceId: "team" } },
]);

function replay(...replies: { messageId: string; source: string }[]) {
  const conversation = buildConversation(
    replies.map(({ messageId, source }) => ({
      key: `${messageId}:0:0`,
      messageId,
      source,
      closed: true,
    })),
  );
  const surface = conversation.surfaces.get("team");
  if (!surface) throw new Error("surface missing");
  return surface;
}

describe("chat form edits", () => {
  test("a session reloaded with new message ids finds the edits it had before another session was edited", () => {
    const store = create<A2uiSlice>()(createA2uiSlice);

    store
      .getState()
      .setA2uiEdit(
        a2uiEditKey("session-a", replay({ messageId: "m1", source: CREATE })),
        { team: "Platform" },
      );
    store
      .getState()
      .setA2uiEdit(
        a2uiEditKey("session-b", replay({ messageId: "m2", source: CREATE })),
        { team: "Infra" },
      );

    const reloaded = replay({ messageId: "m3", source: CREATE });
    expect(
      store.getState().a2uiEdits[a2uiEditKey("session-a", reloaded)],
    ).toEqual({ team: "Platform" });
  });

  test("a surface created again after a delete does not take the edits of the deleted one", () => {
    const first = replay({ messageId: "m1", source: CREATE });
    const again = replay(
      { messageId: "m1", source: CREATE },
      { messageId: "m2", source: DELETE },
      { messageId: "m3", source: CREATE },
    );

    expect(a2uiEditKey("session-a", again)).not.toBe(
      a2uiEditKey("session-a", first),
    );
  });
});
