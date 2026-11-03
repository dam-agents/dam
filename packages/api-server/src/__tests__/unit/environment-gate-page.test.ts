// TEST_OVERVIEW: The gate's loading page as a browser runs it. It shows a working indicator and announces its message to screen readers; it asks the gate's status every two seconds, and reloads once the status says ready or failed, so the gate's own page says which and the wording lives in one place. A start that takes longer than five minutes is not a failure: the page says it is still starting and asks every fifteen seconds until the app answers. The page for a start that failed waits for nothing and offers one "Try again" button.
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { renderGatePage } from "../../modules/environments/gate/pages.js";

const STATUS = "/.platform/status";

// UNIT_BOUNDARY_DESCRIPTION: the loading page's script run with a fake browser: a clock the test moves, timers on it, the status the gate answers, and what the page did — its title, its message, its reloads and the status checks it made.
function browser(slowAfterMs = 300_000) {
  const html = renderGatePage({
    brandName: "Test",
    title: "Starting…",
    body: "The Environment is starting.",
    waitFor: { statusPath: STATUS, slowAfterMs },
  });
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
  let now = 0;
  let timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const page = {
    state: "starting",
    checks: [] as number[],
    reloads: 0,
    title: "Starting…",
    heading: "Starting…",
    message: "The Environment is starting.",
  };
  const element = (key: "heading" | "message") => ({
    set textContent(v: string) {
      page[key] = v;
    },
  });
  const context = {
    Date: { now: () => now },
    setTimeout: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimeout: (id: number) => {
      timers = timers.filter((t) => t.id !== id);
    },
    fetch: async (url: string) => {
      expect(url).toBe(STATUS);
      page.checks.push(now);
      return { ok: true, json: async () => ({ state: page.state }) };
    },
    location: { reload: () => void (page.reloads += 1) },
    document: {
      set title(v: string) {
        page.title = v;
      },
      getElementById: (id: string) =>
        element(id === "title" ? "heading" : "message"),
    },
  };
  vm.runInNewContext(script, context);
  async function advance(ms: number) {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > until) break;
      timers.shift();
      now = next.at;
      next.fn();
      await new Promise((r) => setImmediate(r));
    }
    now = until;
  }
  return { html, page, advance };
}

describe("the loading page", () => {
  // TEST_SCENARIO: the page shows a working indicator, so a visitor sees that something happens, and its message is a live region, so a screen reader hears the change to "still starting".
  it("shows that it is working and announces its message", () => {
    const { html } = browser();

    expect(html).toContain('class="spinner"');
    expect(html).toContain('<p id="message" aria-live="polite">');
  });

  // TEST_SCENARIO: the page asks every two seconds while the app starts, and reloads into the app once the status says ready.
  it("reloads once the app is ready", async () => {
    const { page, advance } = browser();

    await advance(6_000);
    expect(page.checks).toEqual([2_000, 4_000, 6_000]);
    expect(page.reloads).toBe(0);

    page.state = "ready";
    await advance(2_000);
    expect(page.reloads).toBe(1);
  });

  // TEST_SCENARIO: a failed start reloads too, so the visitor reads the gate's own "did not start" page, with its button, rather than a second wording the script would write.
  it("reloads into the gate's page when the start failed", async () => {
    const { page, advance } = browser();

    page.state = "failed";
    await advance(2_000);

    expect(page.reloads).toBe(1);
    expect(page.heading).toBe("Starting…");
  });

  // TEST_SCENARIO: an install that takes fifteen minutes is still waited for: past five minutes the page says "still starting", asks every fifteen seconds, and still opens the app without a reload by hand.
  it("keeps waiting, more slowly, after five minutes", async () => {
    const { page, advance } = browser(10_000);

    await advance(12_000);
    expect(page.heading).toBe("Still starting");
    expect(page.title).toBe("Still starting");
    expect(page.message).toMatch(/keeps checking/);
    const before = page.checks.length;

    await advance(30_000);
    expect(page.checks.length - before).toBe(2);
    expect(page.reloads).toBe(0);

    page.state = "ready";
    await advance(15_000);
    expect(page.reloads).toBe(1);
  });

  // TEST_SCENARIO: the page for a start that failed waits for nothing and offers exactly one way on, a "Try again" link, the gate's primary button.
  it("offers one Try again on a failed start", () => {
    const html = renderGatePage({
      brandName: "Test",
      title: "Did not start",
      body: "The Environment could not be started.",
      retry: "/.platform/start?next=%2F",
    });

    expect(html).not.toContain("<script>");
    expect(html.match(/Try again/g)).toHaveLength(1);
    expect(html).toContain(
      '<a class="button primary" href="/.platform/start?next=%2F">Try again</a>',
    );
  });
});
