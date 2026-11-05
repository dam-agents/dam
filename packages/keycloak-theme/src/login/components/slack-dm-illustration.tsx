import { useEffect, useRef, useState } from "react";

import {
  brandMark,
  BrandProvider,
  IbmLogo,
  useBrand,
  useInView,
  useReducedMotion,
} from "./illustration-kit.js";

function AgentLogo({ size = 36 }: { size?: number }) {
  const brand = useBrand();
  const fontSize = Math.round(size * 0.36);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg"
      style={{
        width: size,
        height: size,
        background:
          "linear-gradient(135deg, #dbeafe 0%, #f3e8ff 50%, #fce7f3 100%)",
      }}
    >
      <span
        className="font-semibold leading-none text-[#121619]"
        style={{ fontSize }}
      >
        {brandMark(brand)}
      </span>
    </div>
  );
}

const BEATS = [0, 1600, 3200, 5200, 7000] as const;

const LAST_STEP = BEATS.length - 1;

// UNIT_BOUNDARY_DESCRIPTION: the illustration's animation step. It plays once, the first time the illustration is in view, and then rests on the last step for good: scrolling it out of view again (paused) or back in never replays it, and if it leaves the view part way through, its pending steps are cancelled and it shows the last step. With reduced motion it shows the last step from the start.
function useAnimationStep(paused: boolean, reduceMotion: boolean) {
  const [step, setStep] = useState(reduceMotion ? LAST_STEP : -1);
  const hasPlayed = useRef(false);

  useEffect(() => {
    const finished = reduceMotion || hasPlayed.current;
    if (finished) {
      setStep(LAST_STEP);
      return;
    }
    if (paused) return;

    hasPlayed.current = true;

    const offset = 300;
    const timers = BEATS.map((beat, i) =>
      setTimeout(() => setStep(i), beat + offset),
    );
    return () => timers.forEach(clearTimeout);
  }, [paused, reduceMotion]);

  return step;
}

let dmStyleInjected = false;
function injectDmStyles() {
  if (dmStyleInjected) return;
  dmStyleInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    @keyframes dmDots {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-3px); }
    }
  `;
  document.head.appendChild(s);
}

const USER_COLOR = "#ee5396";
const THREAD_BLUE = "#1264A3";
const SEND_GREEN = "#007A5A";
const SLACK_AUBERGINE = "#3F0E40";
const SLACK_ACTIVE = "#1164A3";

function DmSidebar() {
  const brand = useBrand();
  return (
    <div
      className="hidden w-[200px] shrink-0 flex-col md:flex"
      style={{ background: SLACK_AUBERGINE }}
    >
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <div
          className="flex size-[28px] items-center justify-center rounded-md"
          style={{ background: "#0f62fe" }}
        >
          <IbmLogo />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[15px] font-bold text-white">IBM Research</span>
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            className="shrink-0 opacity-60"
          >
            <path
              d="M2.5 4L5 6.5L7.5 4"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      <div className="px-3 py-3">
        <p className="mb-1.5 px-2 text-[12px] font-medium text-white/50">
          Direct messages
        </p>
        <div
          className="flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[13px] font-medium text-white"
          style={{ background: SLACK_ACTIVE }}
        >
          <AgentLogo size={20} />
          <span className="truncate">{brand}</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[13px] text-white/70">
          <div
            className="flex size-5 items-center justify-center rounded text-[9px] font-bold text-white"
            style={{ background: "#42be65" }}
          >
            SM
          </div>
          <span className="truncate">Sofia Martinez</span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[13px] text-white/70">
          <div
            className="flex size-5 items-center justify-center rounded text-[9px] font-bold text-white"
            style={{ background: "#a56eff" }}
          >
            SD
          </div>
          <span className="truncate">Sasha Dubois</span>
        </div>
      </div>
    </div>
  );
}

function UserAvatar() {
  return (
    <div
      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
      style={{ background: USER_COLOR }}
    >
      JJ
    </div>
  );
}

function AgentAvatar() {
  return <AgentLogo size={36} />;
}

function Reveal({
  visible,
  children,
}: {
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="transition-all duration-[250ms] ease-out"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(6px)",
      }}
    >
      {children}
    </div>
  );
}

function TypingDots({ visible }: { visible: boolean }) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 transition-all duration-[250ms]"
      style={{
        opacity: visible ? 1 : 0,
        maxHeight: visible ? 48 : 0,
        overflow: "hidden",
      }}
    >
      <AgentAvatar />
      <div className="flex gap-[3px]">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-[5px] rounded-full bg-muted-foreground/50"
            style={{
              animation: visible
                ? `dmDots 1.2s ${i * 0.2}s ease-in-out infinite`
                : "none",
            }}
          />
        ))}
      </div>
    </div>
  );
}

function ReactionPill({
  emoji,
  count,
  visible,
}: {
  emoji: string;
  count: number;
  visible: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border border-input bg-muted/50 px-1.5 py-0.5 text-[11px] transition-all duration-[250ms]"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? "scale(1)" : "scale(0.8)",
      }}
    >
      <span>{emoji}</span>
      <span className="text-muted-foreground">{count}</span>
    </span>
  );
}

function DmPane({ step }: { step: number }) {
  const brand = useBrand();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, [step]);

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      {}
      <div className="flex items-center gap-2.5 border-b border-input px-4 py-2.5">
        <AgentLogo size={28} />
        <div>
          <span className="text-[15px] font-bold text-foreground">{brand}</span>
          <span className="relative -top-px ml-1.5 rounded bg-muted px-1 py-px text-[10px] font-semibold text-muted-foreground">
            APP
          </span>
        </div>
      </div>

      {}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-2">
        {}
        <Reveal visible={step >= 0}>
          <div className="flex gap-2 px-4 py-1.5">
            <UserAvatar />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[14px] font-bold text-foreground">
                  Jordan Jacobs
                </span>
                <span className="text-[11px] text-muted-foreground/60">
                  3:22 PM
                </span>
              </div>
              <p className="mt-0.5 text-[14px] leading-snug text-foreground">
                Create a schedule to update the product notes from{" "}
                <span
                  className="rounded-sm px-0.5 font-medium"
                  style={{
                    color: THREAD_BLUE,
                    background: "rgba(18,100,163,0.1)",
                  }}
                >
                  #user-feedback
                </span>{" "}
                every Friday at 8 PM.
              </p>
            </div>
          </div>
        </Reveal>

        {}
        <TypingDots visible={step === 1} />

        {}
        <Reveal visible={step >= 2}>
          <div className="flex gap-2 px-4 py-1.5">
            <AgentAvatar />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="text-[14px] font-bold text-foreground">
                  {brand}
                </span>
                <span className="relative -top-px rounded bg-muted px-1 py-px text-[10px] font-semibold text-muted-foreground">
                  APP
                </span>
                <span className="text-[11px] text-muted-foreground/60">
                  3:22 PM
                </span>
              </div>
              <p className="mt-0.5 text-[14px] leading-snug text-foreground">
                Done. I'll scan{" "}
                <span
                  className="rounded-sm px-0.5 font-medium"
                  style={{
                    color: THREAD_BLUE,
                    background: "rgba(18,100,163,0.1)",
                  }}
                >
                  #user-feedback
                </span>{" "}
                every Friday at 8 PM ET and update the product notes with new
                themes and issues.
              </p>

              {}
              <Reveal visible={step >= 3}>
                <div className="mt-2 overflow-hidden rounded-lg border border-input">
                  <div className="border-l-[3px] border-l-green-500 bg-muted/30 p-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[12px] text-green-600">✓</span>
                      <span className="text-[12px] font-semibold text-muted-foreground">
                        Schedule created
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] font-semibold leading-snug text-foreground">
                      Update product notes
                    </p>
                    <p className="mt-0.5 text-[12px] text-muted-foreground">
                      Every Friday · 8:00 PM ET · from #user-feedback
                    </p>
                    <div className="mt-1.5 border-t border-input pt-1.5">
                      <span
                        className="text-[12px] font-medium"
                        style={{ color: THREAD_BLUE }}
                      >
                        View schedule →
                      </span>
                    </div>
                  </div>
                </div>
              </Reveal>

              {}
              <div className="mt-1.5">
                <ReactionPill emoji="✅" count={1} visible={step >= 4} />
              </div>

              <p className="mt-1 text-[11px] text-muted-foreground/50">
                Powered by {brand}
              </p>
            </div>
          </div>
        </Reveal>
      </div>

      {}
      <div className="px-3 py-2">
        <div className="rounded-lg border border-input">
          <div className="px-3 py-1.5">
            <span className="text-[12px] text-placeholder">
              Message {brand}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-input px-2 py-1">
            <div className="flex items-center gap-0.5">
              {["B", "I"].map((l) => (
                <div
                  key={l}
                  className="flex size-5 items-center justify-center rounded text-[10px] font-bold text-muted-foreground/25"
                >
                  {l}
                </div>
              ))}
            </div>
            <div
              className="flex size-6 items-center justify-center rounded-md"
              style={{ background: SEND_GREEN }}
            >
              <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                <path
                  d="M4.156 7L9.844 4.156L7 9.844L6.344 7.656L4.156 7Z"
                  fill="white"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SlackDmIllustration({ brand }: { brand: string }) {
  injectDmStyles();

  const containerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const inView = useInView(containerRef);
  const step = useAnimationStep(!inView, reduceMotion);

  return (
    <BrandProvider value={brand}>
      <div
        ref={containerRef}
        className="h-full w-full"
        role="img"
        aria-label={`Illustration: a user asks their ${brand} agent to create a recurring schedule in Slack DMs.`}
      >
        <div
          aria-hidden="true"
          className="overflow-hidden rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]"
          style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
        >
          <div className="flex h-[520px]">
            <DmSidebar />
            <DmPane step={step} />
          </div>
        </div>
      </div>
    </BrandProvider>
  );
}
