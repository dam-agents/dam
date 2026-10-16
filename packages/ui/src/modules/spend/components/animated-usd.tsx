import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { useEffect } from "react";

export function AnimatedUsd({ value }: { value: number }) {
  const shown = useMotionValue(value);
  const text = useTransform(shown, (v) => `$${v.toFixed(2)}`);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const controls = animate(shown, value, {
      duration: reduceMotion ? 0 : 0.6,
      ease: "easeOut",
    });
    return () => controls.stop();
  }, [shown, value, reduceMotion]);
  return <motion.span>{text}</motion.span>;
}
