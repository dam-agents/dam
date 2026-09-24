import { useCallback, useEffect, useRef, useState } from "react";

const GRAVITY = 0.15;
const BOUNCE = 0.78;
const HIT_UP = -3.5;
const HIT_ACROSS = 2.8;
const AI_SPEED = 2.2;
const GRAB_RADIUS = 80;

const ICON_PX = 56;
const S = ICON_PX / 125;

const BALL_R = 3.5;
const BAR_W = 17.5;
const BAR_H = 7;
const WING_W = 12;
const WING_H = 21;

const COL_WING = "#0e6027";
const COL_EYE = "#9f1853";
const COL_BODY = "#d2a106";

const LW_VB = "7.73 15.39 27.50 46.96";
const LW_D =
  "M7.73483 29.1436C7.73483 25.6279 9.06296 22.1123 11.7583 19.417C14.4536 16.7217 17.9692 15.3936 21.4848 15.3936C23.2817 15.3936 25.0395 15.7451 26.602 16.3701C28.2817 17.0342 29.8442 18.0498 31.2114 19.417C33.7114 21.917 35.2348 25.3545 35.2348 29.1436V62.3467L11.7583 38.8701C9.06296 36.1748 7.73483 32.6592 7.73483 29.1436Z";
const RW_VB = "90.0 15.63 27.19 46.48";
const RW_D =
  "M113.243 38.8706L90.0005 62.1128V29.2222C90.0005 25.4722 91.5239 22.0737 93.9848 19.6128C95.313 18.2847 96.8755 17.269 98.5161 16.605C100.079 15.98 101.797 15.6284 103.594 15.6284C107.071 15.6284 110.547 16.9565 113.204 19.6128C115.86 22.269 117.188 25.7456 117.188 29.2222C117.188 32.6987 115.86 36.1753 113.204 38.8315L113.243 38.8706Z";

interface Vec2 {
  x: number;
  y: number;
}

interface State {
  ball: Vec2 & { vx: number; vy: number };
  leftWing: Vec2;
  rightWing: Vec2 & { vy: number };
  phase: "intact" | "breaking" | "dropped" | "playing";
  grabbed: boolean;
  served: boolean;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function rectsOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number,
) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

export function BeePongInline({
  className,
  areaW,
  areaH,
}: {
  className?: string;
  areaW: number;
  areaH: number;
}) {
  const cx = areaW / 2;
  const cy = areaH / 2;

  const iconL = cx - ICON_PX / 2;
  const iconT = cy - ICON_PX / 2;

  const barX = iconL + 43.15 * S;
  const bar1Y = iconT + 46.8 * S;
  const bar2Y = iconT + 70.24 * S;
  const bar3Y = iconT + 93.68 * S;
  const floor = bar3Y + BAR_H;

  const eyeLX = iconL + 51.055 * S;
  const eyeRX = iconL + 74.414 * S;
  const eyeY = iconT + 31.1 * S;
  const eyeR = 7.8125 * S;

  const lwStartX = iconL + 7.73 * S;
  const lwStartY = iconT + 15.39 * S;
  const rwStartX = iconL + 90.0 * S;
  const rwStartY = iconT + 15.63 * S;
  const ballStartX = iconL + 62.73 * S;
  const ballStartY = iconT + 31.1 * S;

  const init = useCallback(
    (): State => ({
      ball: { x: ballStartX, y: ballStartY, vx: 0, vy: 0 },
      leftWing: { x: lwStartX, y: lwStartY },
      rightWing: { x: rwStartX, y: rwStartY, vy: 0 },
      phase: "intact",
      grabbed: false,
      served: false,
    }),
    [ballStartX, ballStartY, lwStartX, lwStartY, rwStartX, rwStartY],
  );

  const [state, setState] = useState<State>(init);
  const rafRef = useRef(0);
  const mouseRef = useRef<Vec2>({ x: cx + 80, y: floor - 30 });
  const mouseDownRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const t = setTimeout(() => {
      stateRef.current = { ...stateRef.current, phase: "breaking" };
      setState(stateRef.current);
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  const doServe = useCallback((s: State) => {
    s.ball.x = s.leftWing.x + WING_W + BALL_R + 2;
    s.ball.y = s.leftWing.y;
    s.ball.vx = HIT_ACROSS;
    s.ball.vy = HIT_UP + (Math.random() - 0.5) * 0.3;
    s.served = true;
  }, []);

  const tick = useCallback(() => {
    const prev = stateRef.current;
    const s: State = {
      ...prev,
      ball: { ...prev.ball },
      leftWing: { ...prev.leftWing },
      rightWing: { ...prev.rightWing },
    };

    if (s.phase === "intact") {
      stateRef.current = s;
      setState(s);
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    if (s.phase === "breaking") {
      const leftTarget = cx - 60;
      const leftYTarget = floor - WING_H;
      s.leftWing.x += (leftTarget - s.leftWing.x) * 0.07;
      s.leftWing.y += (leftYTarget - s.leftWing.y) * 0.07;

      const rightXTarget = cx + 50;
      s.rightWing.vy += GRAVITY;
      s.rightWing.y += s.rightWing.vy;
      s.rightWing.x += (rightXTarget - s.rightWing.x) * 0.06;

      if (s.rightWing.y + WING_H > floor) {
        s.rightWing.y = floor - WING_H;
        s.rightWing.vy *= -0.25;
        if (Math.abs(s.rightWing.vy) < 0.4) {
          s.rightWing.vy = 0;
          s.phase = "dropped";
        }
      }

      s.ball.x += (s.leftWing.x + WING_W + 10 - s.ball.x) * 0.07;
      s.ball.y += (s.leftWing.y - s.ball.y) * 0.07;

      stateRef.current = s;
      setState(s);
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    if (!s.served) {
      s.ball.x = s.leftWing.x + WING_W + BALL_R + 2;
      s.ball.y = s.leftWing.y;
      const t = (performance.now() % 2400) / 2400;
      if (t < 0.012) doServe(s);
      stateRef.current = s;
      setState(s);
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    s.ball.vy += GRAVITY;
    s.ball.x += s.ball.vx;
    s.ball.y += s.ball.vy;

    if (s.ball.y + BALL_R > floor) {
      s.ball.y = floor - BALL_R;
      s.ball.vy = -Math.abs(s.ball.vy) * BOUNCE;
      s.ball.vx *= 0.97;
    }
    if (s.ball.y - BALL_R < 0) {
      s.ball.y = BALL_R;
      s.ball.vy = Math.abs(s.ball.vy) * BOUNCE;
    }

    if (s.ball.x - BALL_R < 0) {
      s.ball.x = BALL_R;
      s.ball.vx = Math.abs(s.ball.vx) * BOUNCE;
    }
    if (s.ball.x + BALL_R > areaW) {
      s.ball.x = areaW - BALL_R;
      s.ball.vx = -Math.abs(s.ball.vx) * BOUNCE;
    }

    for (const by of [bar1Y, bar2Y, bar3Y]) {
      if (
        rectsOverlap(
          s.ball.x - BALL_R,
          s.ball.y - BALL_R,
          BALL_R * 2,
          BALL_R * 2,
          barX,
          by,
          BAR_W,
          BAR_H,
        )
      ) {
        if (s.ball.vx > 0) {
          s.ball.x = barX - BALL_R;
        } else {
          s.ball.x = barX + BAR_W + BALL_R;
        }
        s.ball.vx *= -BOUNCE;
      }
    }

    const aiTargetX = clamp(s.ball.x - WING_W / 2, 4, barX - WING_W - 4);
    const aiDx = aiTargetX - s.leftWing.x;
    s.leftWing.x += clamp(aiDx, -AI_SPEED, AI_SPEED);
    s.leftWing.y = floor - WING_H;

    if (
      s.ball.x + BALL_R > s.leftWing.x &&
      s.ball.x - BALL_R < s.leftWing.x + WING_W &&
      s.ball.y + BALL_R > s.leftWing.y &&
      s.ball.y - BALL_R < s.leftWing.y + WING_H
    ) {
      s.ball.vy = HIT_UP + (Math.random() - 0.5) * 0.4;
      s.ball.vx = Math.abs(HIT_ACROSS) + Math.random() * 0.3;
      s.ball.y = s.leftWing.y - BALL_R;
    }

    if (s.grabbed && mouseDownRef.current) {
      s.rightWing.x = clamp(
        mouseRef.current.x - WING_W / 2,
        barX + BAR_W + 4,
        areaW - WING_W,
      );
      s.rightWing.y = clamp(
        mouseRef.current.y - WING_H / 2,
        0,
        floor - WING_H,
      );
      s.rightWing.vy = 0;
      if (s.phase === "dropped") s.phase = "playing";
    } else {
      s.grabbed = false;
      s.rightWing.vy += GRAVITY;
      s.rightWing.y += s.rightWing.vy;
      if (s.rightWing.y + WING_H > floor) {
        s.rightWing.y = floor - WING_H;
        s.rightWing.vy = 0;
      }
    }

    if (
      s.ball.x + BALL_R > s.rightWing.x &&
      s.ball.x - BALL_R < s.rightWing.x + WING_W &&
      s.ball.y + BALL_R > s.rightWing.y &&
      s.ball.y - BALL_R < s.rightWing.y + WING_H
    ) {
      s.ball.vy = HIT_UP + (Math.random() - 0.5) * 0.4;
      s.ball.vx = -(Math.abs(HIT_ACROSS) + Math.random() * 0.3);
      s.ball.y = s.rightWing.y - BALL_R;
    }

    const speed = Math.sqrt(s.ball.vx * s.ball.vx + s.ball.vy * s.ball.vy);
    if (speed < 0.3 && s.ball.y >= floor - BALL_R - 2) {
      s.served = false;
    }

    stateRef.current = s;
    setState(s);
    rafRef.current = requestAnimationFrame(tick);
  }, [areaW, cx, floor, barX, bar1Y, bar2Y, bar3Y, doServe]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [tick]);

  const toGame = useCallback(
    (clientX: number, clientY: number): Vec2 => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return mouseRef.current;
      return {
        x: ((clientX - rect.left) / rect.width) * areaW,
        y: ((clientY - rect.top) / rect.height) * areaH,
      };
    },
    [areaW, areaH],
  );

  const tryGrab = useCallback((pos: Vec2) => {
    const s = stateRef.current;
    if (s.grabbed) return;
    if (s.phase !== "dropped" && s.phase !== "playing") return;
    const dx = pos.x - (s.rightWing.x + WING_W / 2);
    const dy = pos.y - (s.rightWing.y + WING_H / 2);
    if (Math.sqrt(dx * dx + dy * dy) < GRAB_RADIUS) {
      stateRef.current = { ...stateRef.current, grabbed: true };
    }
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      mouseRef.current = toGame(e.clientX, e.clientY);
    },
    [toGame],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      mouseDownRef.current = true;
      const pos = toGame(e.clientX, e.clientY);
      mouseRef.current = pos;
      tryGrab(pos);
    },
    [toGame, tryGrab],
  );

  const handleMouseUp = useCallback(() => {
    mouseDownRef.current = false;
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      mouseDownRef.current = true;
      const pos = toGame(touch.clientX, touch.clientY);
      mouseRef.current = pos;
      tryGrab(pos);
    },
    [toGame, tryGrab],
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const touch = e.touches[0];
      if (!touch) return;
      mouseRef.current = toGame(touch.clientX, touch.clientY);
    },
    [toGame],
  );

  const handleTouchEnd = useCallback(() => {
    mouseDownRef.current = false;
  }, []);

  const isIntact = state.phase === "intact";

  return (
    <div
      ref={containerRef}
      onMouseMove={isIntact ? undefined : handleMouseMove}
      onMouseDown={isIntact ? undefined : handleMouseDown}
      onMouseUp={isIntact ? undefined : handleMouseUp}
      onMouseLeave={isIntact ? undefined : handleMouseUp}
      onTouchStart={isIntact ? undefined : handleTouchStart}
      onTouchMove={isIntact ? undefined : handleTouchMove}
      onTouchEnd={isIntact ? undefined : handleTouchEnd}
      className={className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        cursor: state.grabbed ? "none" : "default",
      }}
    >
      <svg
        viewBox={`0 0 ${areaW} ${areaH}`}
        className="absolute inset-0 h-full w-full"
        style={{ overflow: "hidden" }}
      >
        {/* body bars — always at exact icon position */}
        <rect x={barX} y={bar1Y} width={BAR_W} height={BAR_H} rx={1} fill={COL_BODY} />
        <rect x={barX} y={bar2Y} width={BAR_W} height={BAR_H} rx={1} fill={COL_BODY} />
        <rect x={barX} y={bar3Y} width={BAR_W} height={BAR_H} rx={1} fill={COL_BODY} />

        {/* eyes — visible only during intact, then merge into ball */}
        {isIntact && (
          <>
            <circle cx={eyeLX} cy={eyeY} r={eyeR} fill={COL_EYE} />
            <circle cx={eyeRX} cy={eyeY} r={eyeR} fill={COL_EYE} />
          </>
        )}

        {/* left wing */}
        <svg
          x={state.leftWing.x}
          y={state.leftWing.y}
          width={WING_W}
          height={WING_H}
          viewBox={LW_VB}
          overflow="visible"
        >
          <path d={LW_D} fill={COL_WING} />
        </svg>

        {/* right wing */}
        <svg
          x={state.rightWing.x}
          y={state.rightWing.y}
          width={WING_W}
          height={WING_H}
          viewBox={RW_VB}
          overflow="visible"
        >
          <path d={RW_D} fill={COL_WING} />
        </svg>

        {/* ball — hidden during intact */}
        {!isIntact && (
          <circle cx={state.ball.x} cy={state.ball.y} r={BALL_R} fill={COL_EYE} />
        )}
      </svg>

      {state.phase === "dropped" && !state.grabbed && (
        <div
          className="pointer-events-none absolute animate-pulse text-sm text-muted-foreground/70"
          style={{
            left: `${(state.rightWing.x / areaW) * 100}%`,
            top: `${((state.rightWing.y - 22) / areaH) * 100}%`,
            transform: "translateX(-10%)",
          }}
        >
          click &amp; hold
        </div>
      )}
    </div>
  );
}
