import type { ReactNode } from "react";
import { useLayoutEffect, useRef, useState } from "react";

/* UNIT_BOUNDARY_DESCRIPTION: Draws its children on a fixed width x height
 * stage and scales the whole stage uniformly to the width of the box it is
 * placed in, so a composition laid out in design pixels keeps its exact look
 * and aspect ratio at every page width: nothing inside reflows. The box takes
 * the stage's scaled height. Children that reach outside the stage are drawn
 * too, scaled with it. */
export function ScaledStage({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const fit = () => setScale(box.clientWidth / width);
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(box);
    return () => observer.disconnect();
  }, [width]);

  return (
    <div
      ref={boxRef}
      className="relative w-full"
      style={{ height: height * scale }}
    >
      <div
        className="absolute top-0 left-0 origin-top-left"
        style={{ width, height, transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}
