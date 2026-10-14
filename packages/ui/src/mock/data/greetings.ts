import type { Message } from "../../types.js";

export const experimentGreeting: Message = {
  id: "mock-experiment-greeting",
  role: "assistant",
  streaming: false,
  parts: [
    {
      kind: "text",
      text: "This sandbox runs an experiment loop you write in Python — a design→build→test→learn cycle that the platform watches live. You'll see a graph of your loop's stages, per-stage progress, and a chart of whatever score your code reports. The platform never runs the loop itself or interprets the score; it just observes what your code tells it.\n\nWhat would you like to optimize? You could evolve a prompt against a scorer, sweep hyperparameters, benchmark several approaches against one task, iterate on code until a test passes — or describe your own goal in your own words.",
    },
  ],
};

export const knowledgeBaseGreeting: Message = {
  id: "mock-kb-greeting",
  role: "assistant",
  streaming: false,
  parts: [
    {
      kind: "text",
      text: "Welcome! This knowledge base is set up and ready to start building a wiki from whatever sources you point it at — repos, documentation sites, conversation transcripts, or anything else you'd like indexed.\n\nWhat would you like to build a knowledge base around? You can paste a repo URL, describe a topic, or just tell me what you're trying to make easier to find later.",
    },
  ],
};
