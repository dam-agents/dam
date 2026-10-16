// TEST_OVERVIEW: the browser panel's address bar and toolbar act on the tab the panel shows, named by its target id; right after "New tab" the runtime has not reported the new tab yet, so an action waits for the new tab's id and acts on it, never on the tab shown before.
import { describe, expect, test } from "vitest";

import { createTabTarget } from "../../modules/browser/lib/tab-target.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createTabTarget", () => {
  // TEST_SCENARIO: with no new tab on its way, an action acts on the tab shown when it runs.
  test("acts on the shown tab", async () => {
    const target = createTabTarget();
    expect(await target.target(() => "A")).toBe("A");
  });

  // TEST_SCENARIO: the user opens a new tab and presses Enter on an address before the runtime reports it: the navigation waits for the new tab's id and goes there, while the panel still shows the old tab; the next report of the tabs ends the wait.
  test("waits for a new tab and acts on it", async () => {
    const target = createTabTarget();
    const opened = deferred<string | null>();
    target.open(opened.promise);
    const navigation = target.target(() => "A");
    opened.resolve("N");
    expect(await navigation).toBe("N");
    expect(await target.target(() => "A")).toBe("N");
    target.reported("N");
    expect(await target.target(() => "B")).toBe("B");
  });

  // TEST_SCENARIO: the runtime reported the new tab as active before its id came back; the wait ends at once, and the shown tab is the target again.
  test("ends the wait when the new tab is already reported", async () => {
    const target = createTabTarget();
    target.reported("N");
    target.open(Promise.resolve("N"));
    expect(await target.target(() => "N")).toBe("N");
    expect(await target.target(() => "B")).toBe("B");
  });

  // TEST_SCENARIO: a new tab the runtime refused has no id; an action falls back to the tab the panel shows, which is the one on screen.
  test("falls back to the shown tab when the new tab failed", async () => {
    const target = createTabTarget();
    target.open(Promise.resolve(null));
    expect(await target.target(() => "A")).toBe("A");
  });

  // TEST_SCENARIO: the user selects or closes a tab while the new tab is on its way: that choice wins, and later actions act on the tab shown.
  test("a select or close ends the wait", async () => {
    const target = createTabTarget();
    target.open(new Promise<string | null>(() => {}));
    target.clear();
    expect(await target.target(() => "B")).toBe("B");
  });
});
