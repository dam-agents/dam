import { useEffect, useState } from "react";

export interface RotatingPlaceholder {
  text: string;
  fading: boolean;
}

const EXAMPLES: string[] = [
  "Find why the login test is flaky and fix it",
  "Every weekday at 9am, summarise overnight CI failures",
  "Make a skill that runs our release checklist",
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
      }, 300);
    }, 4000);
    return () => clearInterval(interval);
  }, [examples]);

  return { text: examples[index]!, fading };
}
