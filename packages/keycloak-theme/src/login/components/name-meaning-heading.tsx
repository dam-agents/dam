import { useEffect, useState } from "react";

import { MEANING_LINES, splitMeaningLines } from "../lib/name-meanings.js";

const LINE_STAGGER_MS = 70;
const OUT_MS = 180;

type Phase = "rest" | "out" | "in";

function RollingLine({ text, index }: { text: string; index: number }) {
  const [shown, setShown] = useState(text);
  const [phase, setPhase] = useState<Phase>("rest");

  useEffect(() => {
    if (text === shown) return;
    const timers = [
      setTimeout(() => setPhase("out"), index * LINE_STAGGER_MS),
      setTimeout(
        () => {
          setShown(text);
          setPhase("in");
        },
        index * LINE_STAGGER_MS + OUT_MS,
      ),
    ];
    return () => timers.forEach(clearTimeout);
  }, [text, shown, index]);

  const cap = shown.slice(0, 1);
  const rest = shown.slice(1);
  return (
    <span className="flex h-[1.2em]">
      <span className="shrink-0">{cap}</span>
      <span className="pointer-events-none relative h-[1.2em] w-[24ch] shrink-0 overflow-hidden">
        <span
          key={`${shown}-${phase === "out" ? "out" : "on"}`}
          className={
            phase === "out"
              ? "name-roll-out absolute top-0 left-0 whitespace-pre"
              : phase === "in"
                ? "name-roll-in absolute top-0 left-0 whitespace-pre"
                : "absolute top-0 left-0 whitespace-pre"
          }
        >
          {rest}
        </span>
      </span>
    </span>
  );
}

// UNIT_BOUNDARY_DESCRIPTION: the sign-in page's first heading, drawn as three lines that never change height, so the form below it never moves. When the meaning changes, the first letter of each line stays in place and only the rest of the word rolls: the old word rises, blurs and fades out, then the new word rises in, one line slightly after the other. Each line clips its own band, so no two words ever overlap. Screen readers read the whole meaning once, not the rolling parts.
export function NameMeaningHeading({
  meaning,
  className,
}: {
  meaning: string;
  className?: string;
}) {
  const lines = splitMeaningLines(meaning);
  return (
    <h1 className={className}>
      <span className="sr-only">{meaning}</span>
      <span aria-hidden="true" className="block h-[3.6em] whitespace-nowrap">
        {Array.from({ length: MEANING_LINES }, (_, i) => (
          <RollingLine key={i} index={i} text={lines[i] ?? ""} />
        ))}
      </span>
    </h1>
  );
}
