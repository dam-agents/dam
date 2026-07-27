import { describe, expect, it } from "vitest";
import type { TraceFeed } from "api-server-api";
import {
  hasFeedSnapshot,
  injectFeedSnapshot,
} from "../../modules/experiments/domain/feed-snapshot.js";

const feed = {
  experiment: { id: "exp-1", name: "evolver", status: "completed" },
  stages: [],
  scoreSeries: [],
  recentSpans: [],
  invocations: [],
} as unknown as TraceFeed;

describe("injectFeedSnapshot", () => {
  it("injects before </body> so the dashboard's listeners register first", () => {
    const html = "<html><body><script>listen()</script></body></html>";
    const out = injectFeedSnapshot(html, feed);
    expect(hasFeedSnapshot(out)).toBe(true);
    expect(out.indexOf("listen()")).toBeLessThan(
      out.indexOf("experiment-feed-snapshot"),
    );
    expect(out.indexOf("experiment-feed-snapshot")).toBeLessThan(
      out.indexOf("</body>"),
    );
  });

  it("appends when there is no </body>", () => {
    const out = injectFeedSnapshot("<div>bare fragment</div>", feed);
    expect(hasFeedSnapshot(out)).toBe(true);
    expect(out.startsWith("<div>bare fragment</div>")).toBe(true);
  });

  it("escapes payload so it cannot terminate the script element", () => {
    const hostile = {
      ...feed,
      experiment: { ...feed.experiment, name: "</script><script>pwn()" },
    } as TraceFeed;
    const out = injectFeedSnapshot("<body></body>", hostile);
    expect(out).not.toContain("</script><script>pwn()");
    expect(out).toContain("\\u003c/script>");
  });

  it("replaces a previous snapshot instead of accumulating replays", () => {
    const once = injectFeedSnapshot("<body></body>", feed);
    const updated = {
      ...feed,
      experiment: { ...feed.experiment, status: "failed" },
    } as TraceFeed;
    const twice = injectFeedSnapshot(once, updated);
    expect(twice.match(/experiment-feed-snapshot/g)?.length).toBe(
      once.match(/experiment-feed-snapshot/g)?.length,
    );
    expect(twice).toContain('"failed"');
    expect(twice).not.toContain('"completed"');
  });
});
