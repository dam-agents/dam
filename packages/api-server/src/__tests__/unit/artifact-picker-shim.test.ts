// TEST_OVERVIEW: The element picker runs inside the in-app artifact preview. The app asks it to start; the user clicks an element or drags a rectangle, and the picker sends back each picked element's selector and markup snippet. While it runs, the page's own handlers never see the clicks.
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  ARTIFACT_PICK_CANCEL_TYPE,
  ARTIFACT_PICK_SNIPPET_MAX_LENGTH,
  ARTIFACT_PICK_START_TYPE,
  ARTIFACT_PICK_STOP_TYPE,
  ARTIFACT_PICK_TYPE,
  artifactPickMessageSchema,
} from "api-server-api";

import { ARTIFACT_PICKER_SHIM_BODY } from "../../modules/artifact-library/viewer/picker-shim.js";
import { renderTextKindInner } from "../../modules/artifact-library/viewer/renderer.js";

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

class FakeElement {
  readonly tagName: string;
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  id = "";
  text = "";
  textContent = "";
  box: Box = { left: 0, top: 0, width: 0, height: 0 };
  readonly style: Record<string, string> = {};
  private readonly attrs = new Set<string>();

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }

  get innerText(): string {
    return [this.text, ...this.children.map((c) => c.innerText)].join(" ");
  }

  get outerHTML(): string {
    const tag = this.tagName.toLowerCase();
    const id = this.id ? ` id="${this.id}"` : "";
    const inner = this.text + this.children.map((c) => c.outerHTML).join("");
    return `<${tag}${id}>${inner}</${tag}>`;
  }

  getBoundingClientRect() {
    const { left, top, width, height } = this.box;
    return {
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
    };
  }

  setAttribute(name: string) {
    this.attrs.add(name);
  }

  hasAttribute(name: string) {
    return this.attrs.has(name);
  }

  append(child: FakeElement) {
    child.parentElement = this;
    this.children.push(child);
  }

  remove() {
    const siblings = this.parentElement?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }

  contains(other: FakeElement | null): boolean {
    for (let node = other; node; node = node.parentElement) {
      if (node === this) return true;
    }
    return false;
  }

  descendants(): FakeElement[] {
    return this.children.flatMap((c) => [c, ...c.descendants()]);
  }

  querySelectorAll(): FakeElement[] {
    return this.descendants();
  }
}

function el(
  tag: string,
  box: Box,
  props: { id?: string; text?: string } = {},
  children: FakeElement[] = [],
): FakeElement {
  const node = new FakeElement(tag);
  node.box = box;
  node.id = props.id ?? "";
  node.text = props.text ?? "";
  for (const child of children) node.append(child);
  return node;
}

function page(content: FakeElement[]) {
  const html = new FakeElement("html");
  const body = el(
    "body",
    { left: 0, top: 0, width: 800, height: 800 },
    {},
    content,
  );
  html.append(body);
  const parent = { postMessage: vi.fn() };
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const elementFromPoint = (x: number, y: number) => {
    let hit: FakeElement = body;
    for (const node of body.descendants()) {
      const r = node.getBoundingClientRect();
      const under = x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      if (under && !node.hasAttribute("data-platform-pick")) hit = node;
    }
    return hit;
  };
  const window = {
    parent,
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, [...(listeners.get(type) ?? []), listener]),
  };
  const document = {
    body,
    documentElement: html,
    createElement: (tag: string) => new FakeElement(tag),
    elementFromPoint,
  };
  runInNewContext(ARTIFACT_PICKER_SHIM_BODY, { window, document, setTimeout });

  const fire = (type: string, init: Record<string, unknown> = {}) => {
    const event = {
      type,
      button: 0,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn(),
      ...init,
    };
    for (const listener of listeners.get(type) ?? []) listener(event);
    return event;
  };
  const fromApp = (type: string, source: unknown = parent) =>
    fire("message", { source, data: { type } });
  const click = (x: number, y: number) => {
    fire("pointerdown", { clientX: x, clientY: y });
    fire("pointerup", { clientX: x, clientY: y });
    return fire("click", { clientX: x, clientY: y });
  };
  const drag = (from: [number, number], to: [number, number]) => {
    fire("pointerdown", { clientX: from[0], clientY: from[1] });
    fire("pointermove", { clientX: to[0], clientY: to[1] });
    fire("pointerup", { clientX: to[0], clientY: to[1] });
  };
  const sent = () =>
    parent.postMessage.mock.calls.map(([message]) => message as unknown);
  return { fromApp, fire, click, drag, sent, html };
}

function report() {
  return page([
    el("main", { left: 0, top: 0, width: 400, height: 400 }, {}, [
      el(
        "h1",
        { left: 10, top: 10, width: 200, height: 30 },
        { id: "title", text: "Revenue" },
      ),
      el("section", { left: 10, top: 50, width: 300, height: 200 }, {}, [
        el(
          "p",
          { left: 20, top: 60, width: 100, height: 20 },
          { text: "First" },
        ),
        el(
          "p",
          { left: 20, top: 90, width: 100, height: 20 },
          { text: "Second" },
        ),
      ]),
    ]),
  ]);
}

describe("artifact element picker", () => {
  // TEST_SCENARIO: the user clicks one paragraph while picking; the app gets that paragraph's path and markup. The browser sends the click after the pointer is up, when the pick is already done, and the page must not get it either.
  it("sends a clicked element's selector and snippet and swallows the click", async () => {
    const { fromApp, click, sent } = report();
    fromApp(ARTIFACT_PICK_START_TYPE);
    const pageClick = click(50, 100);
    expect(sent()).toEqual([
      {
        type: ARTIFACT_PICK_TYPE,
        elements: [
          {
            selector: "main > section > p:nth-of-type(2)",
            snippet: "<p>Second</p>",
          },
        ],
      },
    ]);
    expect(pageClick.preventDefault).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(click(50, 100).preventDefault).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(1);
  });

  // TEST_SCENARIO: an element with an id is named by that id, since the id is the shortest path the Agent can find in the source.
  it("stops the selector at an element's id", () => {
    const { fromApp, click, sent } = report();
    fromApp(ARTIFACT_PICK_START_TYPE);
    click(50, 20);
    expect(sent()).toEqual([
      {
        type: ARTIFACT_PICK_TYPE,
        elements: [
          { selector: "h1#title", snippet: '<h1 id="title">Revenue</h1>' },
        ],
      },
    ]);
  });

  // TEST_SCENARIO: a dragged rectangle around a heading and a section picks those two, not the paragraphs inside the section, and not the page wrapper that reaches past the rectangle.
  it("picks the outermost elements fully inside a dragged rectangle", () => {
    const { fromApp, drag, sent } = report();
    fromApp(ARTIFACT_PICK_START_TYPE);
    drag([5, 5], [320, 260]);
    const [message] = sent();
    const parsed = artifactPickMessageSchema.parse(message);
    expect(parsed).toMatchObject({
      type: ARTIFACT_PICK_TYPE,
      elements: [{ selector: "h1#title" }, { selector: "main > section" }],
    });
  });

  // TEST_SCENARIO: a big element's markup does not fit the cap, so the snippet keeps its opening tag and its text, and stays valid for the app's schema.
  it("shortens a large element to its opening tag and text", () => {
    const long = "word ".repeat(400).trim();
    const { fromApp, click, sent } = page([
      el(
        "article",
        { left: 0, top: 0, width: 300, height: 300 },
        { id: "story", text: long },
      ),
    ]);
    fromApp(ARTIFACT_PICK_START_TYPE);
    click(10, 10);
    const parsed = artifactPickMessageSchema.parse(sent()[0]);
    const [picked] = parsed.type === ARTIFACT_PICK_TYPE ? parsed.elements : [];
    expect(picked.snippet.startsWith('<article id="story"> word word')).toBe(
      true,
    );
    expect(picked.snippet).toHaveLength(ARTIFACT_PICK_SNIPPET_MAX_LENGTH);
  });

  // TEST_SCENARIO: Escape leaves pick mode, tells the app, and later clicks reach the page again.
  it("cancels on Escape and hands clicks back to the page", () => {
    const { fromApp, fire, click, sent } = report();
    fromApp(ARTIFACT_PICK_START_TYPE);
    fire("keydown", { key: "Escape" });
    expect(sent()).toEqual([{ type: ARTIFACT_PICK_CANCEL_TYPE }]);
    const pageClick = click(50, 100);
    expect(pageClick.preventDefault).not.toHaveBeenCalled();
    expect(sent()).toHaveLength(1);
  });

  // TEST_SCENARIO: the app turns pick mode off itself; the picker removes its overlay and sends nothing.
  it("stops quietly when the app says so", () => {
    const { fromApp, click, sent, html } = report();
    fromApp(ARTIFACT_PICK_START_TYPE);
    fromApp(ARTIFACT_PICK_STOP_TYPE);
    click(50, 100);
    expect(sent()).toEqual([]);
    expect(html.children.map((c) => c.tagName)).toEqual(["BODY"]);
  });

  // TEST_SCENARIO: only the app's window can start pick mode; a message from anywhere else, such as a popup the page opened, is ignored.
  it("ignores a start from any window other than the app", () => {
    const { fromApp, click, sent } = report();
    fromApp(ARTIFACT_PICK_START_TYPE, {});
    const pageClick = click(50, 100);
    expect(sent()).toEqual([]);
    expect(pageClick.preventDefault).not.toHaveBeenCalled();
  });
});

describe("where the picker is rendered", () => {
  // TEST_SCENARIO: the in-app preview asks for the picker and gets it in the page head; a share page never asks, so its frame has no picker.
  it("adds the picker only when the renderer is asked to", () => {
    const opts = { title: "Report", fileName: "report.html" };
    const source = "<html><head><title>x</title></head><body></body></html>";
    expect(renderTextKindInner("html", source, opts)).not.toContain(
      ARTIFACT_PICK_START_TYPE,
    );
    expect(
      renderTextKindInner("html", source, { ...opts, picker: true }),
    ).toMatch(/^<html><head><script>[\s\S]*artifact\.pick\.start/);
  });
});
