import { ArrowRight, Information } from "@carbon/icons-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

import { useStore } from "../store.js";

interface MarkerPosition {
  top: number;
  left: number;
  anchored: boolean;
}

export function PointerMarkerOverlay() {
  const step = useStore((s) => s.onboardingStep);
  const steps = useStore((s) => s.currentTranscriptSteps);
  const kitMode = useStore((s) => s.starterKitMode);
  const [pos, setPos] = useState<MarkerPosition | null>(null);
  const rafRef = useRef(0);

  const current = steps[step];
  const active =
    kitMode &&
    current?.kind === "outside-chat" &&
    current.pointer != null;
  const target = current?.pointer?.target;

  useEffect(() => {
    if (!active || !target) {
      setPos(null);
      return;
    }

    function measure() {
      const el = document.querySelector(
        `[data-pointer-target="${target}"]`,
      );
      if (el) {
        const rect = el.getBoundingClientRect();
        setPos({
          top: rect.top + rect.height / 2,
          left: rect.right + 12,
          anchored: true,
        });
      } else {
        setPos({ top: 80, left: window.innerWidth - 380, anchored: false });
      }
      rafRef.current = requestAnimationFrame(measure);
    }
    measure();
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, target]);

  if (!active || !pos || !current?.pointer) return null;

  const label = current.pointer.target;
  const stepLabel = current.label;

  return createPortal(
    <div
      className={cn(
        "pointer-events-none fixed z-[9998] flex items-center gap-3 rounded-xl border px-4 py-3 shadow-xl transition-all duration-300",
        pos.anchored
          ? "border-preset-border bg-preset-light/90 backdrop-blur-sm"
          : "border-warning/40 bg-warning/10 backdrop-blur-sm",
      )}
      style={{ top: pos.top - 22, left: pos.left }}
    >
      <span
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-full text-[14px] font-bold text-white",
          pos.anchored ? "bg-preset" : "bg-warning",
        )}
      >
        {step + 1}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="text-[14px] font-medium text-foreground">
          {stepLabel}
        </span>
        <span className="flex items-center gap-1.5 text-[14px] text-muted-foreground">
          {pos.anchored ? (
            <ArrowRight size={16} className="shrink-0" />
          ) : (
            <Information size={16} className="shrink-0" />
          )}
          {pos.anchored ? label : `Open ${label}`}
        </span>
      </div>
    </div>,
    document.body,
  );
}
