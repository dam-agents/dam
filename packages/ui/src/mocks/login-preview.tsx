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

import { AuroraBackdrop } from "./login-backdrops.js";

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
