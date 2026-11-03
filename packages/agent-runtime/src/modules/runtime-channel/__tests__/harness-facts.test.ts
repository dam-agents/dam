import { describe, expect, it } from "vitest";
import { runtimeManifestSchema } from "../manifest.js";
import { harnessFacts } from "../domain/harness-facts.js";

/**
 * TEST_OVERVIEW: hello carries what each harness's manifest says about it —
 * the model APIs it speaks through the Model Router and its ACP agent's title
 * — so a harness the install's catalog does not list can still be offered.
 */
describe("harnessFacts", () => {
  /**
   * TEST_SCENARIO: an image's own routed harness declares its dialects and
   * its agent's title, and both reach hello as the manifest states them.
   */
  it("should report a routed harness's dialects and title", () => {
    const manifest = runtimeManifestSchema.parse({
      manifestVersion: 1,
      modelRouter: {
        dialects: ["openai-chat"],
        sessionModel: { configOption: "model" },
      },
      initializeCapabilities: {
        agentCapabilities: {},
        agentInfo: { name: "image-agent", title: "Image Agent" },
      },
    });
    expect(harnessFacts(manifest)).toEqual({
      dialects: ["openai-chat"],
      title: "Image Agent",
    });
  });

  /**
   * TEST_SCENARIO: a harness that the Model Router does not serve and whose
   * manifest names no agent reports neither fact, so hello stays as before.
   */
  it("should report nothing for a harness that is not routed and has no title", () => {
    const manifest = runtimeManifestSchema.parse({ manifestVersion: 1 });
    expect(harnessFacts(manifest)).toEqual({});
    expect(harnessFacts(undefined)).toEqual({});
  });
});
