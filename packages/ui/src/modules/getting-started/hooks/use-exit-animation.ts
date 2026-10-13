import { useEffect, useRef, useState } from "react";

const EXIT_MS = 300;

export function useExitAnimation(onDone: () => void): {
  exiting: boolean;
  exit: () => void;
} {
  const [exiting, setExiting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  return {
    exiting,
    exit: () => {
      setExiting(true);
      timer.current = setTimeout(onDone, EXIT_MS);
    },
  };
}
