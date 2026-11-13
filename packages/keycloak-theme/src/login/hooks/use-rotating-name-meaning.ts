import { useEffect, useMemo, useState } from "react";

import { useReducedMotion } from "../components/illustration-kit.js";
import {
  parseNameMeanings,
  planMeaningSequence,
} from "../lib/name-meanings.js";

const FIRST_HOLD_MS = 1200;
const HOLD_MS = 2030;

// UNIT_BOUNDARY_DESCRIPTION: which meaning of the brand name the sign-in page shows now. It starts on the install's first meaning, moves to the next one of planMeaningSequence after a short hold, and stops for good on the last one, which is the first meaning again. With reduced motion it shows the first meaning and never moves.
export function useRotatingNameMeaning(
  rawMeanings: string,
): string | undefined {
  const reduceMotion = useReducedMotion();
  const sequence = useMemo(
    () => planMeaningSequence(parseNameMeanings(rawMeanings)),
    [rawMeanings],
  );
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (reduceMotion || step >= sequence.length - 1) return;
    const timer = setTimeout(
      () => setStep(step + 1),
      step === 0 ? FIRST_HOLD_MS : HOLD_MS,
    );
    return () => clearTimeout(timer);
  }, [reduceMotion, sequence, step]);

  return reduceMotion
    ? sequence[0]
    : sequence[Math.min(step, sequence.length - 1)];
}
