import { describe, expect, it } from "vitest";

import { withAttachmentNames } from "../../modules/files/lib/upload-path.js";

// TEST_OVERVIEW: an approval prompt about a file the user attached names it by the file name, not by the internal path the platform stored it under.

describe("withAttachmentNames", () => {
  // TEST_SCENARIO: a harness that still asks before reading an attachment shows "Read <path>". The prompt names the attached file instead of the session id folder and the unique prefix.
  it("names a web UI attachment by its file name", () => {
    expect(
      withAttachmentNames(
        "Read /home/agent/.uploads/26cf4cd6-6ab6-4bfc-b431-c35722cde4e4/3544448d-qa-chat-note.txt",
      ),
    ).toBe("Read attached file qa-chat-note.txt");
  });

  it("names a file a channel brought in", () => {
    expect(
      withAttachmentNames(".uploads/C0123_1790000000.1234/F07ABC12-report.pdf"),
    ).toBe("attached file report.pdf");
  });

  it("leaves every other path as it is", () => {
    expect(withAttachmentNames("Read /home/agent/work/src/index.ts")).toBe(
      "Read /home/agent/work/src/index.ts",
    );
  });
});
