import { useEffect, useMemo, useState } from "react";

import { parseNameMeanings, pickNextMeaning } from "../lib/name-meanings.js";

const ROTATION_INTERVAL_MS = 4000;

export function useRotatingNameMeaning(
  rawMeanings: string,
): string | undefined {
  const meanings = useMemo(() => parseNameMeanings(rawMeanings), [rawMeanings]);
  const [meaning, setMeaning] = useState(() =>
    pickNextMeaning(meanings, undefined),
  );

  useEffect(() => {
    if (meanings.length < 2) return;
    const timer = setInterval(
      () => setMeaning((current) => pickNextMeaning(meanings, current)),
      ROTATION_INTERVAL_MS,
    );
    return () => clearInterval(timer);
  }, [meanings]);

  return meaning;
}
