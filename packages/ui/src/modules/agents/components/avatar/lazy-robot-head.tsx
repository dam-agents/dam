import { lazy, Suspense } from "react";

import { cn } from "@/lib/utils";

import type { RobotHeadProps } from "./robot-head.js";

const RobotHead = lazy(() =>
  import("./robot-head.js").then((m) => ({ default: m.RobotHead })),
);

export function LazyRobotHead(props: RobotHeadProps) {
  const size = props.size ?? 24;
  return (
    <Suspense
      fallback={
        <span
          aria-hidden
          className={cn("inline-block shrink-0", props.className)}
          style={{ width: size, height: size }}
        />
      }
    >
      <RobotHead {...props} />
    </Suspense>
  );
}
