import { useEffect, useState } from "react";

export interface RotatingPlaceholder {
  text: string;
  fading: boolean;
}

const EXAMPLES: string[] = [
  "Every Friday, file GitHub issues for usability problems raised in #team-help",
  "Make a skill that prototypes GitHub issues and posts them to my Slack DMs for review",
  "List this week’s bugs from #team-dev and who’s on each",
  "Turn this research into a shareable report with charts",
  "Review every new pull request in our repo and leave comments",
  "Add PRs waiting on me to my to-do list and DM it to me at 9am",
  "Remember I like answers short and technical",
];

export function getDefaultExamples(): string[] {
  return EXAMPLES;
}

export function useRotatingPlaceholder(
  examples: string[],
): RotatingPlaceholder {
  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    setIndex(0);
    setFading(false);
  }, [examples]);

  useEffect(() => {
    const interval = setInterval(() => {
      setFading(true);
      setTimeout(() => {
        setIndex((i) => (i + 1) % examples.length);
        setFading(false);
      }, 400);
    }, 6000);
    return () => clearInterval(interval);
  }, [examples]);

  return { text: examples[index]!, fading };
}
