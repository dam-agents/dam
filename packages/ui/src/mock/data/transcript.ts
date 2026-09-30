import type { Message } from "../../types.js";

export const SAMPLE_TRANSCRIPT: Message[] = [
  {
    id: "sample-1",
    role: "user",
    streaming: false,
    parts: [
      {
        kind: "text",
        text: "Make three hero banner variants for the spring campaign using the new palette.",
      },
    ],
  },
  {
    id: "sample-2",
    role: "assistant",
    streaming: false,
    parts: [
      {
        kind: "thought",
        text: "Checking the spring palette and the logo lockup rules before generating anything.",
      },
      {
        kind: "tool",
        toolCallId: "t1",
        title: "Read brand/palette-spring.json",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "t2",
        title: "Read brand/guidelines.md",
        status: "completed",
      },
      {
        kind: "text",
        text: "I pulled the spring palette (sage, coral, butter) and the logo lockup rules. Here's the plan:\n\n1. **Bold** — full-bleed coral, product centered\n2. **Soft** — sage gradient, product offset right\n3. **Editorial** — butter background, large serif headline\n\nGenerating all three at 1920×640.",
      },
      {
        kind: "tool",
        toolCallId: "t3",
        title: "Generate hero-spring-bold.png",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "t4",
        title: "Generate hero-spring-soft.png",
        status: "completed",
      },
      {
        kind: "tool",
        toolCallId: "t5",
        title: "Generate hero-spring-editorial.png",
        status: "completed",
      },
      {
        kind: "text",
        text: "All three are in `artifacts/hero-spring/`. The editorial one is closest to last season's top performer.",
      },
    ],
  },
  {
    id: "sample-3",
    role: "user",
    streaming: false,
    parts: [
      {
        kind: "text",
        text: "Love the soft one. Try it with the product on the left and add a “Shop spring” button.",
      },
    ],
  },
  {
    id: "sample-4",
    role: "assistant",
    streaming: true,
    parts: [
      {
        kind: "tool",
        toolCallId: "t6",
        title: "Edit hero-spring-soft.png",
        status: "in_progress",
      },
    ],
  },
];
