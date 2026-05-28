/**
 * Login-page backdrop variations. Each component fills the right half of
 * the login screen and is purely decorative (`pointer-events-none`).
 *
 * Two families:
 *   1. Color-gradient blobs (Aurora / Sunset / Forest) — soft drifting
 *      blurred blobs, palette varies.
 *   2. Animated dot canvases (Pulse / Constellation / Swarm) — black dots
 *      representing agents working in the cloud, each with a different
 *      motion concept.
 */
import { useEffect, useRef } from "react";

const BackdropShell = ({ children }: { children: React.ReactNode }) => (
  <div
    aria-hidden
    className="absolute top-0 right-0 w-1/2 h-full overflow-hidden pointer-events-none z-0"
  >
    {children}
  </div>
);

// ============================================================
// Gradient backdrops — same blob choreography, different palette
// ============================================================

interface BlobPalette {
  a: string;
  b: string;
  c: string;
  d: string;
}

const PALETTES: Record<"aurora" | "sunset" | "forest", BlobPalette> = {
  aurora: { a: "#78a9ff", b: "#be95ff", c: "#ff7eb6", d: "#8a3ffc" },
  sunset: { a: "#ffae6b", b: "#ff8389", c: "#fa75a3", d: "#d12771" },
  forest: { a: "#82cfff", b: "#08bdba", c: "#00b386", d: "#005d5d" },
};

interface BlobSpec {
  top: string;
  right: string;
  width: string;
  blur: number;
  duration: number;
  keyframe: "blob-a" | "blob-b" | "blob-c" | "blob-d";
  colorKey: keyof BlobPalette;
}

const BLOBS: BlobSpec[] = [
  {
    top: "-12%",
    right: "5%",
    width: "55%",
    blur: 75,
    duration: 14,
    keyframe: "blob-a",
    colorKey: "a",
  },
  {
    top: "20%",
    right: "-12%",
    width: "52%",
    blur: 85,
    duration: 17,
    keyframe: "blob-b",
    colorKey: "b",
  },
  {
    top: "50%",
    right: "28%",
    width: "48%",
    blur: 90,
    duration: 20,
    keyframe: "blob-c",
    colorKey: "c",
  },
  {
    top: "72%",
    right: "-8%",
    width: "44%",
    blur: 80,
    duration: 24,
    keyframe: "blob-d",
    colorKey: "d",
  },
];

function GradientBackdrop({ palette }: { palette: BlobPalette }) {
  return (
    <>
      <style>{`
        @keyframes blob-a {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.55; }
          33% { transform: translate(-70px, 80px) scale(1.2); opacity: 0.85; }
          66% { transform: translate(55px, -65px) scale(0.85); opacity: 0.42; }
        }
        @keyframes blob-b {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.5; }
          33% { transform: translate(80px, -55px) scale(0.85); opacity: 0.35; }
          66% { transform: translate(-50px, 75px) scale(1.22); opacity: 0.78; }
        }
        @keyframes blob-c {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.4; }
          33% { transform: translate(-60px, -75px) scale(1.18); opacity: 0.68; }
          66% { transform: translate(70px, 60px) scale(0.88); opacity: 0.3; }
        }
        @keyframes blob-d {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.45; }
          33% { transform: translate(45px, 90px) scale(0.9); opacity: 0.28; }
          66% { transform: translate(-80px, -50px) scale(1.25); opacity: 0.72; }
        }
      `}</style>
      <BackdropShell>
        {BLOBS.map((b, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              top: b.top,
              right: b.right,
              width: b.width,
              aspectRatio: "1",
              background: `radial-gradient(circle, ${palette[b.colorKey]} 0%, transparent 70%)`,
              filter: `blur(${b.blur}px)`,
              animation: `${b.keyframe} ${b.duration}s ease-in-out infinite`,
            }}
          />
        ))}
      </BackdropShell>
    </>
  );
}

export const AuroraBackdrop = () => (
  <GradientBackdrop palette={PALETTES.aurora} />
);
export const SunsetBackdrop = () => (
  <GradientBackdrop palette={PALETTES.sunset} />
);
export const ForestBackdrop = () => (
  <GradientBackdrop palette={PALETTES.forest} />
);

// ============================================================
// Animated-dot backdrops — black dots representing agents
// ============================================================

/**
 * Reusable canvas wrapper that handles DPR-aware sizing and animation
 * lifecycle. The `draw` callback is called each frame with a normalized
 * 2D context (origin at 0,0, dimensions in CSS pixels).
 */
function CanvasBackdrop({
  draw,
  setup,
}: {
  setup: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  draw: (
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    t: number,
  ) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let cssW = 0;
    let cssH = 0;
    const dpr = window.devicePixelRatio || 1;

    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      cssW = rect.width;
      cssH = rect.height;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setup(ctx, cssW, cssH);
    };
    fit();

    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      draw(ctx, cssW, cssH, t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [draw, setup]);

  return (
    <BackdropShell>
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
    </BackdropShell>
  );
}

/**
 * Pulse — dots arranged in a loose grid, each pulsing in scale + opacity.
 * The pulse offset is a function of position, so a slow wave appears to
 * sweep diagonally across the field. Concept: a fleet of agents activating
 * in turn as work flows through the system.
 */
export function PulseBackdrop() {
  const dotsRef = useRef<{ x: number; y: number; phase: number }[]>([]);

  return (
    <CanvasBackdrop
      setup={(_, w, h) => {
        const cols = Math.max(8, Math.round(w / 60));
        const rows = Math.max(10, Math.round(h / 60));
        const stepX = w / (cols + 1);
        const stepY = h / (rows + 1);
        const dots: { x: number; y: number; phase: number }[] = [];
        for (let r = 1; r <= rows; r++) {
          for (let c = 1; c <= cols; c++) {
            const x = c * stepX;
            const y = r * stepY;
            // diagonal wave + slight randomness
            const phase = (x + y) / 220 + Math.sin(c * 1.3 + r * 0.7) * 0.3;
            dots.push({ x, y, phase });
          }
        }
        dotsRef.current = dots;
      }}
      draw={(ctx, w, h, t) => {
        ctx.clearRect(0, 0, w, h);
        const speed = 1.2;
        for (const d of dotsRef.current) {
          const phase = t * speed - d.phase;
          // Sharper, narrower pulse → most dots are small, the wavefront pops.
          const wave = Math.max(0, Math.cos(phase) ** 6);
          const radius = 1.4 + wave * 4.2;
          const alpha = 0.18 + wave * 0.7;
          ctx.beginPath();
          ctx.arc(d.x, d.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(15, 15, 20, ${alpha})`;
          ctx.fill();
        }
      }}
    />
  );
}

/**
 * Constellation — dots scatter across the field and drift slowly. When
 * two dots are close enough, a thin line connects them with opacity
 * proportional to proximity. Connections form and dissolve as dots move.
 * Concept: agents talking to each other in an emergent, mesh-like network.
 */
export function ConstellationBackdrop() {
  const stateRef = useRef<{
    dots: { x: number; y: number; vx: number; vy: number }[];
    w: number;
    h: number;
  }>({ dots: [], w: 0, h: 0 });

  return (
    <CanvasBackdrop
      setup={(_, w, h) => {
        const count = Math.max(28, Math.round((w * h) / 14000));
        const dots = Array.from({ length: count }, () => ({
          x: Math.random() * w,
          y: Math.random() * h,
          vx: (Math.random() - 0.5) * 0.15,
          vy: (Math.random() - 0.5) * 0.15,
        }));
        stateRef.current = { dots, w, h };
      }}
      draw={(ctx, w, h) => {
        ctx.clearRect(0, 0, w, h);
        const { dots } = stateRef.current;
        // Drift + soft wraparound so the field never empties at the edges.
        for (const d of dots) {
          d.x += d.vx;
          d.y += d.vy;
          if (d.x < -10) d.x = w + 10;
          if (d.x > w + 10) d.x = -10;
          if (d.y < -10) d.y = h + 10;
          if (d.y > h + 10) d.y = -10;
        }
        const linkDist = 130;
        // Lines first so dots paint on top.
        ctx.lineWidth = 1;
        for (let i = 0; i < dots.length; i++) {
          for (let j = i + 1; j < dots.length; j++) {
            const dx = dots[i]!.x - dots[j]!.x;
            const dy = dots[i]!.y - dots[j]!.y;
            const dist = Math.hypot(dx, dy);
            if (dist < linkDist) {
              const alpha = (1 - dist / linkDist) * 0.35;
              ctx.strokeStyle = `rgba(15, 15, 20, ${alpha})`;
              ctx.beginPath();
              ctx.moveTo(dots[i]!.x, dots[i]!.y);
              ctx.lineTo(dots[j]!.x, dots[j]!.y);
              ctx.stroke();
            }
          }
        }
        for (const d of dots) {
          ctx.beginPath();
          ctx.arc(d.x, d.y, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(15, 15, 20, 0.78)";
          ctx.fill();
        }
      }}
    />
  );
}

/**
 * Swarm — dots wander with continuous low-amplitude drift; every so often
 * a random dot "fires", briefly glowing and enlarging before fading back.
 * Concept: agents working in parallel, occasionally completing a task or
 * waking up to handle an event.
 */
export function SwarmBackdrop() {
  const stateRef = useRef<{
    dots: {
      x: number;
      y: number;
      vx: number;
      vy: number;
      flash: number; // 0 → 1 active, decays back to 0
    }[];
    nextFlash: number;
  }>({ dots: [], nextFlash: 0 });
  const lastT = useRef(0);

  return (
    <CanvasBackdrop
      setup={(_, w, h) => {
        const count = Math.max(40, Math.round((w * h) / 9000));
        stateRef.current = {
          dots: Array.from({ length: count }, () => ({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.5,
            vy: (Math.random() - 0.5) * 0.5,
            flash: 0,
          })),
          nextFlash: 0,
        };
        lastT.current = 0;
      }}
      draw={(ctx, w, h, t) => {
        const dt = Math.min(0.05, t - lastT.current);
        lastT.current = t;
        ctx.clearRect(0, 0, w, h);
        const s = stateRef.current;

        // Trigger a flash on a random dot at irregular intervals.
        if (t > s.nextFlash) {
          const idx = Math.floor(Math.random() * s.dots.length);
          if (s.dots[idx]) s.dots[idx].flash = 1;
          s.nextFlash = t + 0.2 + Math.random() * 0.6;
        }

        for (const d of s.dots) {
          // Wobble velocity so motion looks organic, not linear.
          d.vx += (Math.random() - 0.5) * 0.04;
          d.vy += (Math.random() - 0.5) * 0.04;
          // Damping keeps speed bounded.
          d.vx *= 0.985;
          d.vy *= 0.985;
          d.x += d.vx;
          d.y += d.vy;
          if (d.x < 0 || d.x > w) d.vx *= -1;
          if (d.y < 0 || d.y > h) d.vy *= -1;
          d.x = Math.max(0, Math.min(w, d.x));
          d.y = Math.max(0, Math.min(h, d.y));

          d.flash = Math.max(0, d.flash - dt * 2.2);

          // Idle dot
          ctx.beginPath();
          ctx.arc(d.x, d.y, 1.8 + d.flash * 3.5, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(15, 15, 20, ${0.5 + d.flash * 0.45})`;
          ctx.fill();

          // Glow halo on flashing dots
          if (d.flash > 0.05) {
            const grd = ctx.createRadialGradient(d.x, d.y, 0, d.x, d.y, 22);
            grd.addColorStop(0, `rgba(15, 15, 20, ${d.flash * 0.4})`);
            grd.addColorStop(1, "rgba(15, 15, 20, 0)");
            ctx.fillStyle = grd;
            ctx.beginPath();
            ctx.arc(d.x, d.y, 22, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }}
    />
  );
}
