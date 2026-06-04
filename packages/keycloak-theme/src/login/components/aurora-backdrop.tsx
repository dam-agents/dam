interface BlobSpec {
  top: string;
  right: string;
  width: string;
  blur: number;
  duration: number;
  keyframe: "blob-a" | "blob-b" | "blob-c" | "blob-d";
  colorVar: "--blob-a" | "--blob-b" | "--blob-c" | "--blob-d";
}

// Aurora palette via CSS custom properties — light/dark variants live
// in index.css. Choreography is shared; only the saturation/luminance
// shifts between themes.
const BLOBS: BlobSpec[] = [
  {
    top: "-12%",
    right: "5%",
    width: "55%",
    blur: 75,
    duration: 14,
    keyframe: "blob-a",
    colorVar: "--blob-a",
  },
  {
    top: "20%",
    right: "-12%",
    width: "52%",
    blur: 85,
    duration: 17,
    keyframe: "blob-b",
    colorVar: "--blob-b",
  },
  {
    top: "50%",
    right: "28%",
    width: "48%",
    blur: 90,
    duration: 20,
    keyframe: "blob-c",
    colorVar: "--blob-c",
  },
  {
    top: "72%",
    right: "-8%",
    width: "44%",
    blur: 80,
    duration: 24,
    keyframe: "blob-d",
    colorVar: "--blob-d",
  },
];

export function AuroraBackdrop() {
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
      <div
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 z-0 hidden h-full w-1/2 overflow-hidden md:block"
      >
        {BLOBS.map((b, i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              top: b.top,
              right: b.right,
              width: b.width,
              aspectRatio: "1",
              background: `radial-gradient(circle, var(${b.colorVar}) 0%, transparent 70%)`,
              filter: `blur(${b.blur}px)`,
              animation: `${b.keyframe} ${b.duration}s ease-in-out infinite`,
            }}
          />
        ))}
      </div>
    </>
  );
}
