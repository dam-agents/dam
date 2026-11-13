// TEST_OVERVIEW: A relayed artifact download names the file the way the response's Content-Disposition says — the RFC 5987 `filename*` form when the header carries one, so a Czech or emoji file name lands on disk as itself and not as the ASCII fallback.
import { describe, expect, it } from "vitest";

import { filenameFromDisposition } from "../../modules/artifacts/lib/transfer.js";

describe("filenameFromDisposition", () => {
  // TEST_SCENARIO: the api-server answers with an ASCII fallback plus `filename*`; the browser saving the blob must use the real name.
  it("prefers the UTF-8 form over the ASCII fallback", () => {
    expect(
      filenameFromDisposition(
        `attachment; filename="qa-qft weird _.exe"; filename*=UTF-8''qa-qft%20weird%20%C5%BE.exe`,
      ),
    ).toBe("qa-qft weird ž.exe");
    expect(
      filenameFromDisposition(
        `attachment; filename="graf _.png"; filename*=UTF-8''graf%20%F0%9F%8E%A8.png`,
      ),
    ).toBe("graf 🎨.png");
  });

  it("reads the plain form when there is no UTF-8 one", () => {
    expect(
      filenameFromDisposition('attachment; filename="timeline.ndjson"'),
    ).toBe("timeline.ndjson");
    expect(filenameFromDisposition('attachment; filename="a;b.txt"')).toBe(
      "a;b.txt",
    );
    expect(filenameFromDisposition("attachment; filename=a%20b.txt")).toBe(
      "a%20b.txt",
    );
    expect(filenameFromDisposition(null)).toBeNull();
  });
});
