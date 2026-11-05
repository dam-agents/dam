import type {
  MouseEvent as ReactMouseEvent,
  TouchEvent as ReactTouchEvent,
} from "react";
import { useEffect, useRef, useState } from "react";

import { useReducedMotion } from "./illustration-kit.js";
import { SHAPE_COLOR } from "./sections/section-kit.js";

type Spring = { x: number; y: number; vx: number; vy: number };
type Point = [number, number];

const VIEWBOX = 125;
const STIFFNESS = 0.14;
const DAMPING = 0.78;
const REST = 0.04;
const MAX_DRAG = 18;

const EYE_RIGHT: Point = [75.74, 62.52];
const EYE_LEFT: Point = [49.25, 62.52];
const EYE_RADIUS = 12;

const WINGS = [
  "M88.32 39.20L108.71 57.14L108.72 29.25C108.63 24.26 106.21 18.62 99.75 16.58C93.04 14.47 85.81 18.22 83.69 24.93C81.90 30.62 84.20 35.53 88.32 39.20Z",
  "M36.43 39.20L16.04 57.14L16.03 29.25C16.12 24.26 18.54 18.62 24.99 16.58C31.71 14.47 38.94 18.22 41.06 24.93C42.85 30.62 40.55 35.53 36.43 39.20Z",
  "M36.43 85.79L16.04 67.84L16.03 95.73C16.12 100.73 18.54 106.37 24.99 108.40C31.71 110.52 38.94 106.77 41.06 100.05C42.85 94.36 40.55 89.45 36.43 85.79Z",
  "M88.32 85.79L108.71 67.84L108.72 95.73C108.63 100.73 106.21 106.37 99.75 108.40C93.04 110.52 85.81 106.77 83.69 100.05C81.90 94.36 84.20 89.45 88.32 85.79Z",
];

const PIECE_CENTERS: Point[] = [
  [96, 36],
  [29, 36],
  [29, 89],
  [96, 89],
  EYE_RIGHT,
  EYE_LEFT,
];

const FLUTTER = [
  {
    origin: "108.75px 57.125px",
    animation: "compass-flutter-l 0.5s ease-in-out 0.12s",
  },
  {
    origin: "16px 57.125px",
    animation: "compass-flutter-r 0.5s ease-in-out 0.06s",
  },
  {
    origin: "16px 67.875px",
    animation: "compass-flutter-l 0.5s ease-in-out 0s",
  },
  {
    origin: "108.75px 67.875px",
    animation: "compass-flutter-r 0.5s ease-in-out 0.18s",
  },
];

function useBlink(minMs: number, maxMs: number) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          setBlink(true);
          timer = setTimeout(() => {
            setBlink(false);
            schedule();
          }, 150);
        },
        minMs + Math.random() * (maxMs - minMs),
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [minMs, maxMs]);
  return blink;
}

function distance([ax, ay]: Point, [bx, by]: Point) {
  return Math.hypot(ax - bx, ay - by);
}

function clientPoint(
  e: MouseEvent | TouchEvent | ReactMouseEvent | ReactTouchEvent,
) {
  return "touches" in e
    ? { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY }
    : { x: e.clientX, y: e.clientY };
}

/* UNIT_BOUNDARY_DESCRIPTION: The compass character beside the second sign-in
 * form: four green wings and two pink eyes that blink. A click pushes the
 * pieces away from the pointer and a drag pulls one piece, and each springs
 * back; hovering makes the wings flutter. A drag listens on the window until
 * the pointer is released, or until the character unmounts mid-drag. The flutter is skipped when the
 * user prefers reduced motion. It is decoration only, hidden below lg. */
export function CompassCharacter() {
  const svgRef = useRef<SVGSVGElement>(null);
  const pieceRefs = useRef<(SVGGElement | null)[]>([]);
  const springs = useRef<Spring[]>(
    PIECE_CENTERS.map(() => ({ x: 0, y: 0, vx: 0, vy: 0 })),
  );
  const frame = useRef<number | undefined>(undefined);
  const dragging = useRef<{
    idx: number;
    startX: number;
    startY: number;
  } | null>(null);
  const fluttering = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const endDrag = useRef<(() => void) | null>(null);
  const reduceMotion = useReducedMotion();
  const blink = useBlink(2200, 4800);
  const [pokedEye, setPokedEye] = useState<"left" | "right" | null>(null);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
      pending.forEach(clearTimeout);
      endDrag.current?.();
    };
  }, []);

  function later(fn: () => void, ms: number) {
    timers.current.push(setTimeout(fn, ms));
  }

  function applyTransforms() {
    springs.current.forEach((s, i) => {
      pieceRefs.current[i]?.setAttribute(
        "transform",
        `translate(${s.x.toFixed(2)}, ${s.y.toFixed(2)})`,
      );
    });
  }

  function startLoop() {
    if (frame.current !== undefined) return;
    const tick = () => {
      let moving = false;
      springs.current.forEach((s, i) => {
        if (dragging.current?.idx === i) {
          moving = true;
          return;
        }
        s.vx = (s.vx - s.x * STIFFNESS) * DAMPING;
        s.vy = (s.vy - s.y * STIFFNESS) * DAMPING;
        s.x += s.vx;
        s.y += s.vy;
        if ([s.x, s.y, s.vx, s.vy].some((v) => Math.abs(v) > REST))
          moving = true;
        else s.x = s.y = s.vx = s.vy = 0;
      });
      applyTransforms();
      frame.current = moving ? requestAnimationFrame(tick) : undefined;
    };
    frame.current = requestAnimationFrame(tick);
  }

  function toSvg(e: ReactMouseEvent): Point | null {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return [
      ((e.clientX - rect.left) / rect.width) * VIEWBOX,
      ((e.clientY - rect.top) / rect.height) * VIEWBOX,
    ];
  }

  function onPoke(e: ReactMouseEvent) {
    if (dragging.current) return;
    const pt = toSvg(e);
    if (!pt) return;

    const eye =
      distance(pt, EYE_RIGHT) < EYE_RADIUS
        ? "right"
        : distance(pt, EYE_LEFT) < EYE_RADIUS
          ? "left"
          : null;
    if (eye) {
      setPokedEye(eye);
      later(() => setPokedEye(null), 700);
    }

    springs.current.forEach((s, i) => {
      const [px, py] = PIECE_CENTERS[i]!;
      const dx = px - pt[0];
      const dy = py - pt[1];
      const dist = Math.hypot(dx, dy) || 1;
      const force = Math.min(5, 65 / dist);
      s.vx += (dx / dist) * force;
      s.vy += (dy / dist) * force;
    });
    startLoop();
  }

  function onHover() {
    if (reduceMotion || fluttering.current) return;
    fluttering.current = true;
    FLUTTER.forEach(({ origin, animation }, i) => {
      const g = pieceRefs.current[i];
      if (!g) return;
      g.removeAttribute("transform");
      g.style.transformOrigin = origin;
      g.style.animation = animation;
    });
    later(() => {
      FLUTTER.forEach((_, i) => {
        const g = pieceRefs.current[i];
        if (!g) return;
        g.style.animation = "";
        g.style.transformOrigin = "";
      });
      fluttering.current = false;
    }, 700);
  }

  function onPieceDown(idx: number, e: ReactMouseEvent | ReactTouchEvent) {
    e.stopPropagation();
    const start = clientPoint(e);
    dragging.current = { idx, startX: start.x, startY: start.y };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const drag = dragging.current;
      const rect = svgRef.current?.getBoundingClientRect();
      if (!drag || !rect) return;
      const pointer = clientPoint(ev);
      const scale = VIEWBOX / rect.width;
      let dx = (pointer.x - drag.startX) * scale;
      let dy = (pointer.y - drag.startY) * scale;
      const dist = Math.hypot(dx, dy);
      if (dist > MAX_DRAG) {
        dx *= MAX_DRAG / dist;
        dy *= MAX_DRAG / dist;
      }
      springs.current.forEach((s, i) => {
        const pull = i === drag.idx ? 1 : 0.12;
        s.x = dx * pull;
        s.y = dy * pull;
        if (i === drag.idx) s.vx = s.vy = 0;
      });
      applyTransforms();
    };

    const removeListeners = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
      endDrag.current = null;
    };

    const onUp = () => {
      dragging.current = null;
      startLoop();
      removeListeners();
    };

    endDrag.current?.();
    endDrag.current = removeListeners;
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onUp);
  }

  const piece = (idx: number) => ({
    ref: (el: SVGGElement | null) => {
      pieceRefs.current[idx] = el;
    },
    onMouseDown: (e: ReactMouseEvent) => onPieceDown(idx, e),
    onTouchStart: (e: ReactTouchEvent) => onPieceDown(idx, e),
    style: { cursor: "grab" as const },
  });

  const eye = (center: Point, closed: boolean) => {
    const [cx, cy] = center;
    const r = 8.94;
    return closed ? (
      <path
        d={`M${cx - r},${cy} A${r},${r} 0 0 0 ${cx + r},${cy}`}
        fill="none"
        stroke={SHAPE_COLOR.pink}
        strokeWidth="5.74"
      />
    ) : (
      <circle cx={cx} cy={cy} r={r} fill={SHAPE_COLOR.pink} />
    );
  };

  return (
    <div
      className="relative hidden flex-1 lg:flex lg:items-center lg:justify-center"
      onMouseEnter={onHover}
    >
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        fill="none"
        aria-hidden="true"
        className="w-full max-w-[440px] cursor-pointer drop-shadow-[0_8px_24px_rgba(63,108,69,0.18)]"
        onClick={onPoke}
      >
        {WINGS.map((d, i) => (
          <g key={d} {...piece(i)}>
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d={d}
              fill={SHAPE_COLOR.green}
            />
          </g>
        ))}
        <g {...piece(4)}>{eye(EYE_RIGHT, blink || pokedEye === "right")}</g>
        <g {...piece(5)}>{eye(EYE_LEFT, blink || pokedEye === "left")}</g>
      </svg>
    </div>
  );
}
