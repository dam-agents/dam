import type { ToolCallContent, ToolKind } from "@agentclientprotocol/sdk";
import type { createTRPCClient } from "@trpc/client";
import type { AppRouter, DirEntry, PodSession } from "agent-runtime-api";

import type { ReplayFrame } from "./acp-agent";
import { ago, IDS, whenPopulated } from "./scenario";
import { answers, type Fixtures, NotFound } from "./trpc-server";

type AgentRuntime = ReturnType<typeof createTRPCClient<AppRouter>>;
const at = answers<AgentRuntime>();

/** The harness's working directory inside the agent pod. */
const WORK = "/home/agent/work";

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function session(
  over: Partial<PodSession> & Pick<PodSession, "sessionId" | "createdAt">,
): PodSession {
  return {
    mode: "chat",
    type: "regular",
    updatedAt: over.createdAt,
    title: null,
    scheduleId: null,
    threadTs: null,
    seenAt: over.updatedAt ?? over.createdAt,
    runStartedAt: null,
    runTotalMs: null,
    runCount: null,
    running: false,
    ...over,
  };
}

export const SESSIONS: Record<string, PodSession[]> = {
  [IDS.codingAgent]: [
    session({
      sessionId: IDS.session1,
      title: "Fix one-cent rounding error on discounted carts",
      createdAt: ago(38),
      updatedAt: ago(14),
      runTotalMs: 312_000,
      runCount: 2,
    }),
    session({
      sessionId: IDS.session2,
      title: "Add idempotency keys to the refund endpoint",
      createdAt: ago(60 * 5),
      updatedAt: ago(60 * 4 + 20),
      runTotalMs: 544_000,
      runCount: 3,
    }),
    session({
      sessionId: IDS.session3,
      title: "Why is the webhook retry test flaky?",
      createdAt: ago(60 * 26),
      updatedAt: ago(60 * 25 + 30),
      runTotalMs: 188_000,
      runCount: 1,
    }),
  ],
  [IDS.kbAgent]: [
    session({
      sessionId: "5d1a7e20-0001-4b0c-9a55-2f4e6c8d0a11",
      title: "Ingest the new egress-rules architecture page",
      createdAt: ago(60 * 3),
      updatedAt: ago(60 * 3 - 6),
      runTotalMs: 204_000,
      runCount: 1,
    }),
    session({
      sessionId: "5d1a7e20-0002-4b0c-9a55-2f4e6c8d0a12",
      title: "How does credential injection work?",
      createdAt: ago(60 * 24 * 2),
      updatedAt: ago(60 * 24 * 2 - 3),
      runTotalMs: 41_000,
      runCount: 1,
    }),
  ],
  [IDS.slackAgent]: [
    session({
      sessionId: "9b3c4d10-0001-4e2f-8a1b-6c7d8e9f0a21",
      type: "channel_slack",
      title: "Agent pod stuck in ContainerCreating",
      threadTs: "1759138201.402119",
      createdAt: ago(45),
      updatedAt: ago(40),
      runTotalMs: 62_000,
      runCount: 1,
    }),
    session({
      sessionId: "9b3c4d10-0002-4e2f-8a1b-6c7d8e9f0a22",
      type: "channel_slack",
      title: "How do I rotate a GitHub connection token?",
      threadTs: "1759051803.118804",
      createdAt: ago(60 * 22),
      updatedAt: ago(60 * 22 - 4),
      runTotalMs: 35_000,
      runCount: 1,
    }),
  ],
};

// ---------------------------------------------------------------------------
// Workspace files
// ---------------------------------------------------------------------------

type Tree = Record<string, DirEntry[]>;
const dir = (name: string): DirEntry => ({ name, type: "dir" });
const file = (name: string): DirEntry => ({ name, type: "file" });

const DISCOUNT_TS = `import type { CartLine, Discount } from "../types";

/**
 * Applies a cart-level discount and spreads it across the lines, so the
 * per-line amounts on receipts always add up to the charged total.
 */
export function allocateLineTotals(
  lines: CartLine[],
  discount: Discount | null,
): number[] {
  const gross = lines.map((l) => l.unitPriceCents * l.quantity);
  if (!discount) return gross;

  const subtotal = gross.reduce((a, b) => a + b, 0);
  const total = applyDiscount(subtotal, discount);

  // Largest-remainder allocation: floor each share, then hand the leftover
  // cents to the lines with the biggest fractional parts.
  const exact = gross.map((g) => (g * total) / subtotal);
  const floored = exact.map(Math.floor);
  let leftover = total - floored.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (leftover-- <= 0) break;
    floored[i] += 1;
  }
  return floored;
}

export function applyDiscount(amountCents: number, discount: Discount): number {
  switch (discount.kind) {
    case "percent":
      return Math.round(amountCents * (1 - discount.percent / 100));
    case "fixed":
      return Math.max(0, amountCents - discount.amountCents);
  }
}
`;

const CART_TOTAL_TS = `import type { Cart } from "../types";
import { allocateLineTotals } from "./discount";
import { taxCents } from "./tax";

export interface CartTotals {
  lines: number[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

export function cartTotals(cart: Cart): CartTotals {
  const lines = allocateLineTotals(cart.lines, cart.discount);
  const subtotalCents = lines.reduce((a, b) => a + b, 0);
  const tax = taxCents(subtotalCents, cart.region);
  return {
    lines,
    subtotalCents,
    taxCents: tax,
    totalCents: subtotalCents + tax,
  };
}
`;

const README_MD = `# checkout-service

Payments and checkout API for the storefront.

## Development

\`\`\`sh
pnpm install
pnpm dev        # http://localhost:4010
pnpm test       # vitest
\`\`\`

## Layout

- \`src/api\` — HTTP routes (Hono)
- \`src/pricing\` — cart totals, discounts, tax
- \`src/payments\` — Stripe client and webhook handling
- \`src/invoices\` — receipt and invoice rendering
`;

const PACKAGE_JSON = `{
  "name": "checkout-service",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "eslint src"
  },
  "dependencies": {
    "hono": "^4.6.3",
    "stripe": "^17.2.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "tsx": "^4.19.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.2"
  }
}
`;

const CODING_TREE: Tree = {
  "": [
    dir(".github"),
    dir("src"),
    dir("test"),
    file(".env.example"),
    file(".gitignore"),
    file("CLAUDE.md"),
    file("README.md"),
    file("package.json"),
    file("pnpm-lock.yaml"),
    file("tsconfig.json"),
    file("vitest.config.ts"),
  ],
  ".github": [dir("workflows")],
  ".github/workflows": [file("ci.yml")],
  src: [
    dir("api"),
    dir("invoices"),
    dir("payments"),
    dir("pricing"),
    file("server.ts"),
    file("types.ts"),
  ],
  "src/api": [file("carts.ts"), file("checkout.ts"), file("refunds.ts")],
  "src/invoices": [file("render.ts"), file("templates.ts")],
  "src/payments": [file("stripe.ts"), file("webhooks.ts")],
  "src/pricing": [
    file("cart-total.ts"),
    file("discount.test.ts"),
    file("discount.ts"),
    file("tax.ts"),
  ],
  test: [dir("fixtures"), file("checkout.e2e.test.ts")],
  "test/fixtures": [file("carts.json")],
};

export const CODING_FILES: Record<string, string> = {
  "README.md": README_MD,
  "package.json": PACKAGE_JSON,
  "src/pricing/discount.ts": DISCOUNT_TS,
  "src/pricing/cart-total.ts": CART_TOTAL_TS,
  "CLAUDE.md": `# checkout-service

- Money is always integer cents. Never use floats for stored amounts.
- Run \`pnpm test\` and \`pnpm build\` before finishing a change.
- Stripe calls go through \`src/payments/stripe.ts\` only.
`,
};

const KB_TREE: Tree = {
  "": [
    dir("raw"),
    dir("wiki"),
    file("AGENTS.md"),
    file("index.md"),
    file("log.md"),
  ],
  raw: [
    file("architecture-egress-rules.md"),
    file("architecture-credentials.md"),
    file("architecture-scheduling.md"),
  ],
  wiki: [dir("concepts"), dir("subsystems"), file("glossary.md")],
  "wiki/concepts": [
    file("agent-harness.md"),
    file("credential-injection.md"),
    file("hibernation.md"),
  ],
  "wiki/subsystems": [
    file("api-server.md"),
    file("controller.md"),
    file("egress-rules.md"),
  ],
};

const KB_FILES: Record<string, string> = {
  "index.md": `# Platform knowledge base

- [Glossary](wiki/glossary.md)
- Concepts: [Agent harness](wiki/concepts/agent-harness.md), [Credential injection](wiki/concepts/credential-injection.md), [Hibernation](wiki/concepts/hibernation.md)
- Subsystems: [API server](wiki/subsystems/api-server.md), [Controller](wiki/subsystems/controller.md), [Egress rules](wiki/subsystems/egress-rules.md)
`,
};

const SLACK_TREE: Tree = {
  "": [dir("runbooks"), file("AGENTS.md"), file("faq.md")],
  runbooks: [file("pod-stuck.md"), file("rotate-tokens.md")],
};

const TREES: Record<string, { tree: Tree; files: Record<string, string> }> = {
  [IDS.codingAgent]: { tree: CODING_TREE, files: CODING_FILES },
  [IDS.kbAgent]: { tree: KB_TREE, files: KB_FILES },
  [IDS.slackAgent]: { tree: SLACK_TREE, files: {} },
};

function mimeOf(path: string): string {
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".ts")) return "text/typescript";
  if (path.endsWith(".yml") || path.endsWith(".yaml")) return "text/yaml";
  return "text/plain";
}

// ---------------------------------------------------------------------------
// Harness config (the model shown under the chat input)
// ---------------------------------------------------------------------------

const MODELS: Record<string, { model: string; names: [string, string][] }> = {
  [IDS.codingAgent]: {
    model: "claude-sonnet-4-5",
    names: [
      ["claude-sonnet-4-5", "Claude Sonnet 4.5"],
      ["claude-opus-4-1", "Claude Opus 4.1"],
      ["claude-haiku-4-5", "Claude Haiku 4.5"],
    ],
  },
  [IDS.kbAgent]: {
    model: "claude-sonnet-4-5",
    names: [
      ["claude-sonnet-4-5", "Claude Sonnet 4.5"],
      ["claude-haiku-4-5", "Claude Haiku 4.5"],
    ],
  },
  [IDS.slackAgent]: {
    model: "gpt-5-codex",
    names: [
      ["gpt-5-codex", "GPT-5 Codex"],
      ["gpt-5", "GPT-5"],
    ],
  },
};

export function agentFixtures(agentId: string): Fixtures {
  const sessions = whenPopulated(SESSIONS[agentId] ?? [], []);
  const ws = TREES[agentId] ?? { tree: {}, files: {} };
  const models = MODELS[agentId];
  return Object.fromEntries([
    at("sessions.list", (input) => {
      const matching = sessions.filter(
        (s) => !input?.sessionId || s.sessionId === input.sessionId,
      );
      return { sessions: matching, nextCursor: null };
    }),
    at("files.listDirs", ({ paths }) => ({
      results: paths.map((path) => {
        const entries = ws.tree[path];
        return entries
          ? { path, ok: true as const, entries }
          : { path, ok: false as const, error: "not-found" as const };
      }),
    })),
    at("files.read", ({ path }) => {
      const parent = path.includes("/")
        ? path.slice(0, path.lastIndexOf("/"))
        : "";
      const name = path.slice(path.lastIndexOf("/") + 1);
      const listed = ws.tree[parent]?.some(
        (e) => e.type === "file" && e.name === name,
      );
      if (!listed) throw new NotFound();
      return {
        path,
        content: ws.files[path] ?? "",
        binary: false,
        mimeType: mimeOf(path),
        mtimeMs: Date.parse(ago(60 * 3)),
      };
    }),
    at("harnessConfig.current", {
      model: models?.model ?? null,
      mode: "default",
      configOptions: {},
      availableModels:
        models?.names.map(([value, name]) => ({ value, name })) ?? null,
    }),
  ]);
}

// ---------------------------------------------------------------------------
// ACP transcripts, replayed on session/load
// ---------------------------------------------------------------------------

/** Builds a transcript whose frames are stamped at increasing times. */
function transcript(startMinutesAgo: number) {
  const frames: ReplayFrame[] = [];
  let minutes = startMinutesAgo;
  let toolSeq = 0;
  const stamp = () => ago(minutes);
  const api = {
    /** Advance the clock by `seconds`. */
    wait(seconds: number) {
      minutes -= seconds / 60;
      return api;
    },
    user(text: string) {
      frames.push({
        at: stamp(),
        update: {
          sessionUpdate: "user_message_chunk",
          messageId: crypto.randomUUID(),
          content: { type: "text", text },
        },
      });
      return api;
    },
    thought(text: string) {
      frames.push({
        at: stamp(),
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text },
        },
      });
      return api;
    },
    say(text: string) {
      frames.push({
        at: stamp(),
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text },
        },
      });
      return api;
    },
    /** A tool call that starts, then settles with `result` after `seconds`. */
    tool(
      kind: ToolKind,
      title: string,
      opts: {
        path?: string;
        result?: string;
        diff?: { path: string; oldText: string; newText: string };
        status?: "completed" | "failed";
        seconds?: number;
      } = {},
    ) {
      const toolCallId = `toolu_${String(++toolSeq).padStart(2, "0")}${Math.random().toString(36).slice(2, 10)}`;
      frames.push({
        at: stamp(),
        update: {
          sessionUpdate: "tool_call",
          toolCallId,
          title,
          kind,
          status: "pending",
          ...(opts.path && { locations: [{ path: opts.path }] }),
        },
      });
      api.wait(opts.seconds ?? 2);
      const content: ToolCallContent[] = [];
      if (opts.diff) content.push({ type: "diff", ...opts.diff });
      if (opts.result !== undefined)
        content.push({
          type: "content",
          content: { type: "text", text: opts.result },
        });
      frames.push({
        at: stamp(),
        update: {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: opts.status ?? "completed",
          ...(content.length > 0 && { content }),
        },
      });
      return api;
    },
    frames: () => frames,
  };
  return api;
}

const fence = (lang: string, body: string) => `\`\`\`${lang}\n${body}\n\`\`\``;

const OLD_DISCOUNT = `export function discountedLineCents(line: CartLine, discount: Discount | null): number {
  if (!discount || discount.kind !== "percent") return line.unitPriceCents * line.quantity;
  const unit = Math.round(line.unitPriceCents * (1 - discount.percent / 100));
  return unit * line.quantity;
}`;

const checkoutFix = () =>
  transcript(38)
    .user(
      "Finance flagged that some checkout totals are a cent off from what the receipt shows. It seems to happen on multi-item carts with a percentage discount. Can you find the cause and fix it? Please add a regression test.",
    )
    .wait(4)
    .thought(
      "A one-cent drift on percentage discounts smells like rounding at the wrong level — probably per unit or per line instead of once on the subtotal. Let me find where percentage discounts are applied.",
    )
    .say("I'll start by finding where percentage discounts are applied.")
    .tool("search", `grep -rn "percent" ${WORK}/src/pricing`, {
      result: fence(
        "",
        `src/pricing/discount.ts:5:  if (!discount || discount.kind !== "percent") return line.unitPriceCents * line.quantity;
src/pricing/discount.ts:6:  const unit = Math.round(line.unitPriceCents * (1 - discount.percent / 100));
src/pricing/discount.ts:13:    case "percent":
src/pricing/discount.ts:14:      return Math.round(amountCents * (1 - discount.percent / 100));
src/pricing/discount.test.ts:9:  it("applies a 10 percent discount", () => {`,
      ),
    })
    .tool("read", `Read ${WORK}/src/pricing/discount.ts`, {
      path: `${WORK}/src/pricing/discount.ts`,
      result: fence(
        "ts",
        `import type { CartLine, Discount } from "../types";

${OLD_DISCOUNT}

export function applyDiscount(amountCents: number, discount: Discount): number {
  switch (discount.kind) {
    case "percent":
      return Math.round(amountCents * (1 - discount.percent / 100));
    case "fixed":
      return Math.max(0, amountCents - discount.amountCents);
  }
}`,
      ),
    })
    .tool("read", `Read ${WORK}/src/pricing/cart-total.ts`, {
      path: `${WORK}/src/pricing/cart-total.ts`,
      result: fence(
        "ts",
        `import type { Cart } from "../types";
import { discountedLineCents } from "./discount";
import { taxCents } from "./tax";

export function cartTotals(cart: Cart) {
  const lines = cart.lines.map((l) => discountedLineCents(l, cart.discount));
  const subtotalCents = lines.reduce((a, b) => a + b, 0);
  const tax = taxCents(subtotalCents, cart.region);
  return { lines, subtotalCents, taxCents: tax, totalCents: subtotalCents + tax };
}`,
      ),
    })
    .tool("read", `Read ${WORK}/src/invoices/render.ts (1 - 40)`, {
      path: `${WORK}/src/invoices/render.ts`,
      result: fence(
        "ts",
        `// ...
  const discounted = applyDiscount(subtotal(cart.lines), cart.discount);
// ...`,
      ),
    })
    .wait(3)
    .thought(
      "Checkout rounds the discounted *unit* price and multiplies by quantity, while the invoice applies the discount once to the subtotal. For 3 × 3.33 at 15% off: checkout gives round(283.05) × 3 = 849, the invoice gives round(849.15) = 849 — fine — but 7 × 1.99 at 15%: round(169.15) × 7 = 1183 vs round(1184.05) = 1184. That's the cent.",
    )
    .say(
      "Found it. `discountedLineCents` rounds the discounted **unit** price and then multiplies by quantity, while the invoice renderer applies the discount once to the subtotal. The two disagree whenever the per-unit rounding error adds up across a quantity. I'll reproduce it with a failing test first.",
    )
    .tool("edit", `Edit \`${WORK}/src/pricing/discount.test.ts\``, {
      path: `${WORK}/src/pricing/discount.test.ts`,
      diff: {
        path: `${WORK}/src/pricing/discount.test.ts`,
        oldText: `});`,
        newText: `  it("line totals add up to the discounted subtotal", () => {
    const cart = cartOf([line(199, 7), line(333, 3)], percent(15));
    const { lines, subtotalCents } = cartTotals(cart);
    expect(subtotalCents).toBe(applyDiscount(199 * 7 + 333 * 3, percent(15)));
    expect(lines.reduce((a, b) => a + b, 0)).toBe(subtotalCents);
  });
});`,
      },
    })
    .tool("execute", "`pnpm vitest run src/pricing`", {
      status: "failed",
      seconds: 6,
      result: fence(
        "console",
        ` FAIL  src/pricing/discount.test.ts > discount > line totals add up to the discounted subtotal
AssertionError: expected 2032 to be 2033 // Object.is equality

- Expected
+ Received

- 2033
+ 2032

 ❯ src/pricing/discount.test.ts:31:27

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed (7)`,
      ),
    })
    .say(
      "Reproduced: checkout computes 2032¢ where the receipt shows 2033¢. Now the fix — apply the discount once to the subtotal and allocate it across lines so the per-line amounts still sum to the total.",
    )
    .tool("edit", `Edit \`${WORK}/src/pricing/discount.ts\``, {
      path: `${WORK}/src/pricing/discount.ts`,
      seconds: 3,
      diff: {
        path: `${WORK}/src/pricing/discount.ts`,
        oldText: OLD_DISCOUNT,
        newText: DISCOUNT_TS.split("export function applyDiscount")[0]!.split(
          `import type { CartLine, Discount } from "../types";\n\n`,
        )[1]!,
      },
    })
    .tool("edit", `Edit \`${WORK}/src/pricing/cart-total.ts\``, {
      path: `${WORK}/src/pricing/cart-total.ts`,
      diff: {
        path: `${WORK}/src/pricing/cart-total.ts`,
        oldText: `const lines = cart.lines.map((l) => discountedLineCents(l, cart.discount));`,
        newText: `const lines = allocateLineTotals(cart.lines, cart.discount);`,
      },
    })
    .tool("execute", "`pnpm vitest run src/pricing`", {
      seconds: 5,
      result: fence(
        "console",
        ` ✓ src/pricing/discount.test.ts (7 tests) 14ms
 ✓ src/pricing/tax.test.ts (5 tests) 6ms

 Test Files  2 passed (2)
      Tests  12 passed (12)
   Duration  412ms`,
      ),
    })
    .tool("execute", "`pnpm test && pnpm build`", {
      seconds: 21,
      result: fence(
        "console",
        ` Test Files  14 passed (14)
      Tests  96 passed (96)
   Duration  3.81s

> checkout-service@ build /home/agent/work
> tsc -p tsconfig.json`,
      ),
    })
    .wait(3)
    .say(
      `Fixed. The checkout total and the receipt now always agree.

**Cause** — \`discountedLineCents\` rounded the discounted *unit* price and multiplied by quantity. Rounding errors of up to half a cent per unit accumulated, so a cart like 7 × $1.99 at 15% off came to $11.83 at checkout but $11.84 on the receipt, which discounts the subtotal once.

**Fix** (\`src/pricing/discount.ts\`)
- The discount is now applied once to the subtotal, matching the invoice renderer.
- New \`allocateLineTotals\` spreads the discounted total across lines with largest-remainder rounding, so line amounts on the receipt still add up exactly.
- \`cartTotals\` uses it; \`discountedLineCents\` is removed (it had no other callers).

**Test** — added \`line totals add up to the discounted subtotal\`, which failed before the change (2032¢ vs 2033¢) and passes now. Full suite (96 tests) and \`tsc\` are green.

| Cart | Before | After | Receipt |
| --- | ---: | ---: | ---: |
| 7 × $1.99, 15% off | $11.83 | $11.84 | $11.84 |
| 3 × $3.33, 15% off | $8.49 | $8.49 | $8.49 |

I haven't committed anything — want me to open a PR?`,
    )
    .wait(60 * 22)
    .user("Yes please, open a PR against main.")
    .wait(3)
    .tool(
      "execute",
      '`git checkout -b fix/discount-rounding && git commit -am "fix(pricing): apply percentage discounts to the subtotal"`',
      {
        seconds: 2,
        result: fence(
          "console",
          `Switched to a new branch 'fix/discount-rounding'
[fix/discount-rounding 4e1c9a2] fix(pricing): apply percentage discounts to the subtotal
 3 files changed, 41 insertions(+), 7 deletions(-)`,
        ),
      },
    )
    .tool(
      "execute",
      "`git push -u origin fix/discount-rounding && gh pr create --fill --base main`",
      {
        seconds: 6,
        result: fence(
          "console",
          `branch 'fix/discount-rounding' set up to track 'origin/fix/discount-rounding'.
https://github.com/acme/checkout-service/pull/482`,
        ),
      },
    )
    .say(
      "Opened [acme/checkout-service#482](https://github.com/acme/checkout-service/pull/482) — *fix(pricing): apply percentage discounts to the subtotal*. CI is running; I'll leave the review to you.",
    )
    .frames();

const refundIdempotency = () =>
  transcript(60 * 5)
    .user(
      "Clients sometimes retry POST /refunds after a timeout and we end up refunding twice. Add idempotency-key support to that endpoint.",
    )
    .wait(5)
    .tool("read", `Read ${WORK}/src/api/refunds.ts`, {
      path: `${WORK}/src/api/refunds.ts`,
    })
    .tool("read", `Read ${WORK}/src/payments/stripe.ts`, {
      path: `${WORK}/src/payments/stripe.ts`,
    })
    .say(
      "The route calls `stripe.refunds.create` directly with no key, so every retry creates a new refund. I'll accept an `Idempotency-Key` header, pass it through to Stripe, and cache the first response for 24 hours so retries return the same body.",
    )
    .tool("edit", `Edit \`${WORK}/src/api/refunds.ts\``, {
      path: `${WORK}/src/api/refunds.ts`,
      seconds: 4,
    })
    .tool("execute", "`pnpm vitest run src/api/refunds`", {
      seconds: 5,
      result: fence(
        "console",
        ` ✓ src/api/refunds.test.ts (9 tests) 38ms

 Test Files  1 passed (1)
      Tests  9 passed (9)`,
      ),
    })
    .say(
      "Done. `POST /refunds` now honours an `Idempotency-Key` header: the key is forwarded to Stripe and the first response is replayed for repeats within 24 hours. Requests without a key behave as before. Added three tests covering a replayed key, a reused key with a different body (422), and no key.",
    )
    .frames();

const flakyWebhook = () =>
  transcript(60 * 26)
    .user(
      "`webhooks.test.ts > retries failed deliveries` fails about 1 in 10 CI runs. Why?",
    )
    .wait(4)
    .tool("read", `Read ${WORK}/src/payments/webhooks.ts`, {
      path: `${WORK}/src/payments/webhooks.ts`,
    })
    .thought(
      "The retry backoff uses real timers and the test waits a fixed 500ms. With jitter up to 250ms on the second attempt, the total can exceed the wait.",
    )
    .say(
      "The test waits a fixed 500 ms for two retries, but the backoff adds up to 250 ms of random jitter per attempt, so the second retry sometimes lands after the assertion. Switching the test to `vi.useFakeTimers()` and advancing time explicitly makes it deterministic — want me to make that change?",
    )
    .frames();

const kbIngest = () =>
  transcript(60 * 3)
    .user("Ingest raw/architecture-egress-rules.md into the wiki.")
    .wait(4)
    .tool("read", `Read ${WORK}/raw/architecture-egress-rules.md`, {
      path: `${WORK}/raw/architecture-egress-rules.md`,
    })
    .tool("edit", `Write ${WORK}/wiki/subsystems/egress-rules.md`, {
      path: `${WORK}/wiki/subsystems/egress-rules.md`,
      seconds: 5,
    })
    .tool("edit", `Edit \`${WORK}/index.md\``, { path: `${WORK}/index.md` })
    .tool("edit", `Edit \`${WORK}/log.md\``, { path: `${WORK}/log.md` })
    .say(
      "Added **Egress rules** under `wiki/subsystems/`, linked it from the index and the glossary entries for *allowlist* and *waypoint*, and logged the ingest.",
    )
    .frames();

const kbQuestion = () =>
  transcript(60 * 24 * 2)
    .user("How does credential injection work?")
    .wait(3)
    .tool("read", `Read ${WORK}/wiki/concepts/credential-injection.md`, {
      path: `${WORK}/wiki/concepts/credential-injection.md`,
    })
    .say(
      "Agents never see raw secrets. Each granted connection is resolved by the platform at request time and injected into outbound traffic by the egress proxy, so the harness only holds a placeholder. See [Credential injection](wiki/concepts/credential-injection.md) for the full flow.",
    )
    .frames();

const HISTORY: Record<string, () => Record<string, ReplayFrame[]>> = {
  [IDS.codingAgent]: () => ({
    [IDS.session1]: checkoutFix(),
    [IDS.session2]: refundIdempotency(),
    [IDS.session3]: flakyWebhook(),
  }),
  [IDS.kbAgent]: () => ({
    "5d1a7e20-0001-4b0c-9a55-2f4e6c8d0a11": kbIngest(),
    "5d1a7e20-0002-4b0c-9a55-2f4e6c8d0a12": kbQuestion(),
  }),
};

export function agentHistory(agentId: string): Record<string, ReplayFrame[]> {
  return whenPopulated(HISTORY[agentId]?.() ?? {}, {});
}
