// TEST_OVERVIEW: An agent's reply can carry markup the agent wrote itself. The session view shows a `<thinking>` passage as a thought and drops echoed framing tags, but leaves a tag quoted in a sentence or in code as written.
import { expect, it } from "vitest";

import { withoutAgentMarkup } from "../../modules/sessions/lib/agent-markup.js";

const split = (text: string) => withoutAgentMarkup([{ kind: "text", text }]);

// TEST_SCENARIO: thinking becomes a thought, a framing tag disappears, and quoted markup stays.
it("folds thinking, drops framing and keeps quoted markup", () => {
  expect(
    split(
      "<how-to-respond>x</how-to-respond>\nDone.\n<thinking>Still weighing",
    ),
  ).toEqual([
    { kind: "text", text: "Done." },
    { kind: "thought", text: "Still weighing" },
  ]);
  const quoted = "The `<thinking>` tag.\n\n```\n<thinking>x</thinking>\n```";
  expect(split(quoted)).toEqual([{ kind: "text", text: quoted }]);
});
