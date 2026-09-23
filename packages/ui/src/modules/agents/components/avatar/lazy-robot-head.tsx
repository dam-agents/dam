import { Component, lazy, type ReactNode, Suspense } from "react";

import { cn } from "@/lib/utils";

import type { RobotHeadProps } from "./robot-head.js";

const RobotHead = lazy(() =>
  import("./robot-head.js").then((m) => ({ default: m.RobotHead })),
);

class AvatarBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function LazyRobotHead(props: RobotHeadProps) {
  const size = props.size ?? 24;
  const placeholder = (
    <span
      aria-hidden
      className={cn("inline-block shrink-0", props.className)}
      style={{ width: size, height: size }}
    />
  );
  return (
    <AvatarBoundary fallback={placeholder}>
      <Suspense fallback={placeholder}>
        <RobotHead {...props} />
      </Suspense>
    </AvatarBoundary>
  );
}
