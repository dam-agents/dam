/**
 * Dev-only visual mockup of a future custom login page. Purely illustrative —
 * no real auth. Shown so designers can hand off a target for the real
 * Keycloak theme work. See ./README.md.
 */
import {
  Close as X,
} from "@carbon/icons-react";
import { useEffect, useState } from "react";

import ibmLogo from "@/assets/ibm-logo.svg";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginPreview({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[200] overflow-y-auto bg-background">
      {/* Preview mode chrome — makes it obvious this isn't the real login */}
      <div className="sticky top-0 z-[50] border-b bg-background/95 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-6 py-3 flex items-center gap-3">
          <Badge variant="secondary">Design preview</Badge>
          <div className="ml-auto">
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X />
            </Button>
          </div>
        </div>
      </div>

      {/* Split layout — centered content well so the two columns stay
          together as the viewport grows wider. */}
      <div className="relative min-h-[calc(100dvh-57px)] flex items-center justify-center px-6 py-12 md:px-12 md:py-16">
        <AuroraBackdrop />
        <div className="relative z-10 w-full max-w-[1400px] flex flex-col md:flex-row md:items-center gap-12 md:gap-16">
        {/* Left: sign-in form */}
        <div className="md:w-1/2 flex">
          <div className="w-full max-w-sm space-y-6">
            <h1 className="text-2xl font-semibold leading-none tracking-tight">
              Sign in to DAM
            </h1>

            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                /* preview only */
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="login-preview-username">Username</Label>
                <Input
                  id="login-preview-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-preview-password">Password</Label>
                <Input
                  id="login-preview-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" className="w-full" size="lg">
                Sign in
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center">
                <span className="bg-background px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Or
                </span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="lg"
              className="w-full justify-center font-semibold"
              onClick={(e) => e.preventDefault()}
            >
              <img src={ibmLogo} alt="IBM" className="h-2.5 w-auto shrink-0" />
              Continue with w3id
            </Button>

            <p className="text-xs text-muted-foreground">
              Secure sign-in powered by Keycloak
            </p>
          </div>
        </div>

        {/* Right: marketing headline */}
        <div className="hidden md:flex md:w-1/2">
          <div className="max-w-xl space-y-6">
            <h2 className="text-[5rem] lg:text-[8rem] font-light tracking-tight leading-[0.95]">
              <span className="block">Deploy</span>
              <span className="block">Agents</span>
              <span className="block">Massively</span>
            </h2>
            <p className="text-xl text-muted-foreground leading-relaxed">
              Run agent harnesses like Claude Code headless in the cloud, on a
              schedule, connected to your tools — without exposing your tokens.
            </p>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

const BackdropShell = ({ children }: { children: React.ReactNode }) => (
  <div
    aria-hidden
    className="absolute top-0 right-0 w-1/2 h-full overflow-hidden pointer-events-none z-0"
  >
    {children}
  </div>
);

/**
 * Aurora backdrop — four blurred brand-colored blobs (blue 40, purple 40,
 * magenta 40, purple 60) drifting and pulsing on independent slow loops
 * anchored to the right half of the viewport.
 */
interface AuroraBlob {
  top: string;
  right: string;
  width: string;
  color: string;
  blur: number;
  duration: number;
  keyframe: "aurora-a" | "aurora-b" | "aurora-c" | "aurora-d";
}

const BLOBS: AuroraBlob[] = [
  { top: "-12%", right: "5%", width: "55%", color: "#78a9ff", blur: 75, duration: 14, keyframe: "aurora-a" },
  { top: "20%", right: "-12%", width: "52%", color: "#be95ff", blur: 85, duration: 17, keyframe: "aurora-b" },
  { top: "50%", right: "28%", width: "48%", color: "#ff7eb6", blur: 90, duration: 20, keyframe: "aurora-c" },
  { top: "72%", right: "-8%", width: "44%", color: "#8a3ffc", blur: 80, duration: 24, keyframe: "aurora-d" },
];

function AuroraBackdrop() {
  return (
    <>
      <style>{`
        @keyframes aurora-a {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.55; }
          33% { transform: translate(-70px, 80px) scale(1.2); opacity: 0.85; }
          66% { transform: translate(55px, -65px) scale(0.85); opacity: 0.42; }
        }
        @keyframes aurora-b {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.5; }
          33% { transform: translate(80px, -55px) scale(0.85); opacity: 0.35; }
          66% { transform: translate(-50px, 75px) scale(1.22); opacity: 0.78; }
        }
        @keyframes aurora-c {
          0%, 100% { transform: translate(0, 0) scale(1); opacity: 0.4; }
          33% { transform: translate(-60px, -75px) scale(1.18); opacity: 0.68; }
          66% { transform: translate(70px, 60px) scale(0.88); opacity: 0.3; }
        }
        @keyframes aurora-d {
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
              background: `radial-gradient(circle, ${b.color} 0%, transparent 70%)`,
              filter: `blur(${b.blur}px)`,
              animation: `${b.keyframe} ${b.duration}s ease-in-out infinite`,
            }}
          />
        ))}
      </BackdropShell>
    </>
  );
}

