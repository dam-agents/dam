// TEST_OVERVIEW: Two gates that must ask the right question. The assistant's Channels paragraph belongs to the assistant's kind, because an Agent Editor lacks `channelBinding` on every Agent and would otherwise read it on an ordinary one; the rename banner belongs to the person having the assistant, because a turn-off leaves the cached record behind and Home would keep speaking of an assistant that no longer exists.
import type { AgentAccess } from "api-server-api";
import { describe, expect, it } from "vitest";

import { renameNoticeOf } from "../../modules/assistants/lib/rename-notice.js";
import {
  canAddChannel,
  showsAssistantChannelsNotice,
} from "../../modules/sandboxes/lib/channels-binding.js";

const owner: AgentAccess = {
  role: "owner",
  editors: [],
  permissions: ["view", "settings", "channels", "channelBinding"],
};
const editor: AgentAccess = {
  role: "editor",
  ownerEmail: "alice@example.com",
  editors: ["bob@example.com"],
  permissions: ["view", "settings"],
};
const assistantOwner: AgentAccess = {
  role: "owner",
  editors: [],
  permissions: ["view", "settings", "channels"],
};

describe("the assistant's Channels paragraph", () => {
  // TEST_SCENARIO: an Agent Editor opening an ordinary Agent's Channels page reads only the owner-only notice, never the assistant's paragraph, though they lack `channelBinding` and so see no add control either.
  it("is not shown to an editor of an ordinary agent", () => {
    expect(showsAssistantChannelsNotice(undefined)).toBe(false);
    expect(canAddChannel(editor, undefined)).toBe(false);
  });

  // TEST_SCENARIO: the assistant's own owner — who also lacks `channelBinding` — reads the paragraph and has no add control, while an ordinary Agent's owner has the controls and no paragraph.
  it("is shown for the assistant, and only for it", () => {
    expect(showsAssistantChannelsNotice("assistant")).toBe(true);
    expect(canAddChannel(assistantOwner, "assistant")).toBe(false);
    expect(canAddChannel(owner, "knowledge-base")).toBe(true);
    expect(showsAssistantChannelsNotice("knowledge-base")).toBe(false);
  });
});

describe("the rename banner", () => {
  const notice = { renamedFrom: "Dambledore", renamedTo: "Dambledore (yours)" };

  // TEST_SCENARIO: while the person has the assistant, the record's news shows.
  it("shows while the assistant is on", () => {
    expect(renameNoticeOf({ notice }, true)).toEqual(notice);
    expect(renameNoticeOf({ notice: null }, true)).toBeNull();
  });

  // TEST_SCENARIO: the reviewer's case — the person turns the assistant off, so the query stops but its cached row, with its news, is still there; the banner must not speak for an assistant that no longer exists.
  it("shows nothing once the assistant is off, even with a cached row", () => {
    expect(renameNoticeOf({ notice }, false)).toBeNull();
    expect(renameNoticeOf(undefined, false)).toBeNull();
  });
});
