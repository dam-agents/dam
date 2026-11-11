import { describe, expect, it, vi } from "vitest";

vi.mock("../../store.js", () => ({ useStore: {} }));

import { promptsNewestFirst } from "../../modules/sessions/hooks/use-prompt-history.js";
import type { Message } from "../../types.js";

function user(text: string, extra: Partial<Message> = {}): Message {
  return {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ kind: "text", text }],
    streaming: false,
    ...extra,
  };
}

const CAPABILITIES =
  '<a2ui-capabilities>\n{"v1.0":{"supportedCatalogIds":[]}}\n</a2ui-capabilities>';

describe("promptsNewestFirst", () => {
  it("recalls what the person typed, without the capabilities block", () => {
    const history = promptsNewestFirst([
      user(`after that change the controller is obsolete?\n\n${CAPABILITIES}`),
    ]);
    expect(history).toEqual(["after that change the controller is obsolete?"]);
  });

  it("skips a prompt that held only renderer blocks, such as a form submit", () => {
    const action =
      '<a2ui-message>\n{"version":"v1.0","action":{}}\n</a2ui-message>';
    const history = promptsNewestFirst([
      user("first"),
      user(`${action}\n\n${CAPABILITIES}`),
    ]);
    expect(history).toEqual(["first"]);
  });

  it("skips notices and agent replies", () => {
    const history = promptsNewestFirst([
      user("typed"),
      { ...user("Older messages not shown"), role: "assistant", notice: true },
      user("a notice", { notice: true }),
    ]);
    expect(history).toEqual(["typed"]);
  });
});
