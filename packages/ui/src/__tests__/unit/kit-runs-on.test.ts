// TEST_OVERVIEW: the kit modal's "Runs on" line names the harness the kit pins, or the
// TEST_OVERVIEW: model it pins instead, because the created Agent takes the kit's
// TEST_OVERVIEW: declaration rather than the user's default; a kit that pins neither says
// TEST_OVERVIEW: nothing, since the platform default is not in the kit's data.
import type { StarterKitView } from "api-server-api";
import { describe, expect, test } from "vitest";

import { kitRunsOn } from "../../modules/starter-kits/lib/runs-on.js";

const kit = (fields: Partial<StarterKitView>) =>
  fields as Pick<StarterKitView, "image" | "harnesses" | "defaultModel">;

describe("kitRunsOn", () => {
  test("names the first harness the kit lists", () => {
    expect(kitRunsOn(kit({ harnesses: ["claude-code", "pi"] }))).toBe(
      "Runs on Claude",
    );
  });

  test("names an image's own harness over the kit's list", () => {
    expect(
      kitRunsOn(
        kit({
          image: { ref: "ghcr.io/dam-agents/nous:1", harness: "pi" },
          harnesses: ["claude-code"],
        }),
      ),
    ).toBe("Runs on Pi");
  });

  test("names the model the kit pins, prettified", () => {
    expect(kitRunsOn(kit({ defaultModel: "claude-opus-4-5" }))).toBe(
      "Runs on Claude Opus 4.5",
    );
  });

  test("keeps a model id the chat has no pretty name for", () => {
    expect(kitRunsOn(kit({ defaultModel: "zeta-instruct" }))).toBe(
      "Runs on zeta-instruct",
    );
  });

  test("says nothing about a kit that pins neither", () => {
    expect(kitRunsOn(kit({ providers: ["ibm-litellm"] }))).toBeNull();
  });
});
