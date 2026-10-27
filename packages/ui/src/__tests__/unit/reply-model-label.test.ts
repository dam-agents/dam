// TEST_OVERVIEW: Replies use the picker's model label and preserve unknown ids and the stored-id tooltip.
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { ChatMessage } from "../../modules/sessions/components/chat-message.js";
import { prettyModelLabel } from "../../modules/sessions/lib/model-families.js";

vi.hoisted(() => vi.stubGlobal("window", new EventTarget()));
vi.mock("../../store.js", () => ({
  useStore: (select: (store: unknown) => unknown) =>
    select({ sessionId: null, pendingPermissions: [] }),
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ content, children }: { content: string; children: ReactNode }) =>
    createElement("div", { title: content }, children),
}));

it.each([
  ["ibm/aws/claude-opus-5-5", "Claude Opus 5.5"],
  ["cb/rits/zai-org/glm-5-3", "GLM 5.3"],
  ["unknown/variant-X", "unknown/variant-X"],
])(
  "labels %s like the picker and keeps its exact id in the tooltip",
  (model, label) => {
    const html = renderToStaticMarkup(
      createElement(ChatMessage, {
        message: {
          id: "reply",
          role: "assistant",
          parts: [],
          streaming: false,
          model,
        },
        showModel: true,
        isLast: false,
        hasPendingPermission: false,
        timeLabel: "now",
        timeTitle: "Today",
        onRetry: vi.fn(),
        onFileClick: vi.fn(),
        onDelete: vi.fn(),
      }),
    );
    expect(prettyModelLabel(model) ?? model).toBe(label);
    expect(html).toContain(`>${label}</span>`);
    expect(html).toContain(`title="${model}"`);
  },
);
