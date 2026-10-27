import { useEffect, useRef, useState } from "react";

/* ── Palette constant for the DAM agent's reply-stack avatar ────── */

const CHAR_GREEN = "#3F6C45";

/* ── Animation timing (plays once, holds at final state) ─────────── */

const BEATS = [0, 1800, 3400, 5000, 6600, 8400, 10600, 12600] as const;

/* Step → what appears:
   -1  blank
    0  Sofia's message in channel + thread slides open
    1  Sasha reply + screenshot chip
    2  Jordan reply
    3  Jules "@DAM make a ticket from this thread"
    4  👀 reaction on Jules' msg + typing dots
    5  DAM draft card (typing dots gone)
    6  Jules "Looks good. File it and assign Jordan."
    7  DAM filed card + 🙌 + ✅ reactions                            */

/* ── Hooks ────────────────────────────────────────────────────────── */

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return reduced;
}

function useInView(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);
  return visible;
}

function useAnimationStep(paused: boolean, reduceMotion: boolean) {
  const [step, setStep] = useState(reduceMotion ? 7 : -1);
  const hasPlayed = useRef(false);

  useEffect(() => {
    if (reduceMotion) {
      setStep(7);
      return;
    }
    if (paused || hasPlayed.current) return;

    hasPlayed.current = true;

    const offset = 400;
    for (let i = 0; i < BEATS.length; i++) {
      setTimeout(() => setStep(i), BEATS[i] + offset);
    }
  }, [paused, reduceMotion]);

  return step;
}

/* ── Style injection (typing dots keyframe) ──────────────────────── */

let styleInjected = false;
function injectStyles() {
  if (styleInjected) return;
  styleInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    @keyframes slkDots {
      0%, 60%, 100% { transform: translateY(0); }
      30% { transform: translateY(-3px); }
    }
    @keyframes slkFadeIn {
      from { opacity: 0; transform: translateY(6px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(s);
}

/* ── Palette ─────────────────────────────────────────────────────── */

const SLACK_AUBERGINE = "#3F0E40";
const SLACK_ACTIVE = "#1164A3";
const THREAD_BLUE = "#1264A3";
const SEND_GREEN = "#007A5A";

const CAST = {
  sarah: { initials: "SM", color: "#4589ff", name: "Sofia Martinez" },
  samantha: { initials: "SD", color: "#a56eff", name: "Sasha Dubois" },
  jamie: { initials: "JJ", color: "#42be65", name: "Jordan Jacobs" },
  jenna: { initials: "JW", color: "#ee5396", name: "Jules Watson" },
} as const;

/* ── IBM logo (official 8-bar from public/ibm-logo.svg, fill swapped to white) */

function IbmLogo() {
  return (
    <svg viewBox="0 0 113 45" fill="white" className="h-[10px]">
      <path d="M0 41.8671H21.9304V45H0V41.8671ZM0 39.019H21.9304V35.8861H0V39.019ZM6.26582 33.038H15.6646V29.9051H6.26582V33.038ZM6.26582 27.057H15.6646V23.9241H6.26582V27.057ZM6.26582 21.076H15.6646V17.943H6.26582V21.076ZM15.6646 11.962H6.26582V15.0949H15.6646V11.962ZM0 9.11392H21.9304V5.98101H0V9.11392ZM0 3.13291H21.9304V0H0V3.13291ZM25.0633 39.019H58.4915C59.0525 38.0506 59.4797 36.9997 59.7532 35.8861H25.0661V39.019H25.0633ZM55.874 23.9241H31.3291V27.057H58.4886C57.7994 25.8693 56.9165 24.8098 55.874 23.9241ZM31.3291 17.943V21.076H55.874C56.9136 20.1902 57.7994 19.1307 58.4886 17.943H31.3291ZM58.4915 5.98101H25.0633V9.11392H59.7503C59.4769 8.00032 59.0497 6.94937 58.4886 5.98101H58.4915ZM48.1329 0H25.0633V3.13291H56.2016C54.0741 1.18766 51.243 0 48.1329 0ZM31.3291 15.0949H40.7278V11.962H31.3291V15.0949ZM49.557 15.0949H59.6763C59.9468 14.0953 60.0949 13.0472 60.0949 11.962H49.557V15.0949ZM31.3291 33.038H40.7278V29.9051H31.3291V33.038ZM49.557 29.9051V33.038H60.0949C60.0949 31.9529 59.9468 30.9047 59.6763 29.9051H49.557ZM25.0633 45H48.1329C51.2658 45 54.0741 43.8123 56.2016 41.8671H25.0633V45ZM87.7215 45L88.8095 41.8671H86.6307L87.7187 45H87.7215ZM85.6339 39.019H89.812L90.9114 35.8861H84.5345L85.6339 39.019ZM91.9082 33.038L93.0076 29.9051H82.4298L83.5291 33.038H91.9082ZM81.4329 27.057H94.0101L95.1095 23.9241H80.3335L81.4329 27.057ZM85.8503 15.0949L84.7595 11.962H68.9212V15.0949H85.8503ZM91.6718 9.11392H112.785V5.98101H92.7627L91.6718 9.11392ZM94.8418 0L93.7538 3.13291H112.785V0H94.8418ZM62.6582 45H78.3228V41.8671H62.6582V45ZM62.6582 39.019H78.3228V35.8861H62.6582V39.019ZM68.9241 33.038H78.3228V29.9051H68.9241V33.038ZM68.9241 27.057H78.3228V23.9241H68.9241V27.057ZM106.519 11.962H90.6807L89.5899 15.0949H106.516V11.962H106.519ZM97.1203 21.076H106.519V17.943H88.6016L87.7215 20.475L86.8415 17.943H68.9241V21.076H78.3228V18.1965L79.3339 21.076H96.1092L97.1203 18.1965V21.076ZM106.519 23.9241H97.1203V27.057H106.519V23.9241ZM97.1203 33.038H106.519V29.9051H97.1203V33.038ZM97.1203 39.019H112.785V35.8861H97.1203V39.019ZM97.1203 45H112.785V41.8671H97.1203V45ZM83.7712 9.11392L82.6804 5.98101H62.6582V9.11392H83.7712ZM81.6921 3.13291L80.6013 0H62.6582V3.13291H81.6921Z" />
    </svg>
  );
}

/* ── Avatars ─────────────────────────────────────────────────────── */

function PersonAvatar({
  initials,
  color,
}: {
  initials: string;
  color: string;
}) {
  return (
    <div
      className="flex size-9 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold text-white"
      style={{ background: color }}
    >
      {initials}
    </div>
  );
}

function SmallAvatar({ color }: { color: string }) {
  return (
    <div
      className="size-[18px] rounded border-2 border-background"
      style={{ background: color }}
    />
  );
}

function AgentAvatar() {
  return (
    <div
      className="flex size-9 shrink-0 items-center justify-center rounded-lg"
      style={{
        background: "linear-gradient(135deg, #dbeafe 0%, #f3e8ff 50%, #fce7f3 100%)",
      }}
    >
      <span className="text-[14px] font-semibold leading-none text-foreground">
        DAM
      </span>
    </div>
  );
}

/* ── Sidebar ─────────────────────────────────────────────────────── */

function Sidebar() {
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
          <span className="text-[15px] font-bold text-white">
            IBM Research
          </span>
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

      <div className="mt-3 space-y-0.5 px-2">
        <div className="px-2 py-0.5">
          <span className="text-[12px] font-medium text-white/50">
            Channels
          </span>
        </div>
        <SidebarItem label="dam-community" />
        <SidebarItem label="dam-design" active />
        <SidebarItem label="flow-boards" />
      </div>
    </div>
  );
}

function SidebarItem({
  label,
  active,
}: {
  label: string;
  active?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[13px] ${
        active ? "font-medium text-white" : "text-white/70"
      }`}
      style={active ? { background: SLACK_ACTIVE } : undefined}
    >
      <span className="w-3 text-center text-[12px] opacity-70">#</span>
      <span className="truncate">{label}</span>
    </div>
  );
}

/* ── Channel pane (middle) ───────────────────────────────────────── */

function ChannelPane({ step }: { step: number }) {
  const replyCount = step >= 7 ? 6 : step >= 6 ? 5 : step >= 5 ? 4 : step >= 3 ? 3 : step >= 2 ? 2 : step >= 1 ? 1 : 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-background">
      <div className="flex items-center justify-between border-b border-input px-4 py-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[15px] font-bold text-foreground">
            # dam-design
          </span>
          <Chevron />
        </div>
        <SearchIcon />
      </div>

      <div className="flex-1">
        <OldMessages />

        <div className="border-t border-input/40">
          <Reveal visible={step >= 0}>
            <div className="flex gap-2 px-4 py-1.5">
              <PersonAvatar
                initials={CAST.sarah.initials}
                color={CAST.sarah.color}
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[14px] font-bold text-foreground">
                    {CAST.sarah.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground/60">
                    10:12 AM
                  </span>
                </div>
                <p className="mt-0.5 text-[14px] leading-snug text-foreground">
                  The Save button on the settings page doesn't do anything.
                </p>

                {step >= 1 && (
                  <div className="mt-1.5 flex items-center gap-1.5 py-0.5">
                    <div className="flex -space-x-1">
                      <SmallAvatar color={CAST.samantha.color} />
                      {step >= 2 && (
                        <SmallAvatar color={CAST.jamie.color} />
                      )}
                      {step >= 3 && (
                        <SmallAvatar color={CAST.jenna.color} />
                      )}
                      {step >= 5 && <SmallAvatar color={CHAR_GREEN} />}
                    </div>
                    <span
                      className="text-[12px] font-bold"
                      style={{ color: THREAD_BLUE }}
                    >
                      {replyCount}{" "}
                      {replyCount === 1 ? "reply" : "replies"}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </Reveal>
        </div>
      </div>

      <Composer placeholder="Message #dam-design" />
    </div>
  );
}

/* ── Thread panel (right) ────────────────────────────────────────── */

function ThreadPanel({ step }: { step: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (step < 1) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, [step]);

  return (
    <div className="flex h-full w-[340px] shrink-0 flex-col border-l border-input bg-background">
      <div className="flex items-center justify-between border-b border-input px-4 py-2">
        <div>
          <span className="text-[15px] font-bold text-foreground">
            Thread
          </span>
          <span className="ml-2 text-[12px] text-muted-foreground">
            #dam-design
          </span>
        </div>
        <CloseIcon />
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {step >= 0 && (
          <FadeIn>
            <ThreadMsg
              initials={CAST.sarah.initials}
              color={CAST.sarah.color}
              name={CAST.sarah.name}
              time="10:12 AM"
              visible
            >
              The Save button on the settings page doesn't do anything.
            </ThreadMsg>
          </FadeIn>
        )}

        {step >= 1 && (
          <ReplySeparator
            count={step >= 7 ? 5 : step >= 6 ? 4 : step >= 5 ? 3 : step >= 3 ? 2 : 1}
            visible
          />
        )}

        {step >= 1 && (
          <FadeIn>
            <ThreadMsg
              initials={CAST.samantha.initials}
              color={CAST.samantha.color}
              name={CAST.samantha.name}
              time="10:14 AM"
              visible
            >
              Same for me. Here's what I see.
              <FileChip name="save-button.png" icon="img" />
            </ThreadMsg>
          </FadeIn>
        )}

        {step >= 2 && (
          <FadeIn>
            <ThreadMsg
              initials={CAST.jamie.initials}
              color={CAST.jamie.color}
              name={CAST.jamie.name}
              time="10:18 AM"
              visible
            >
              It works in Chrome. Only broken in Safari for me.
            </ThreadMsg>
          </FadeIn>
        )}

        {step >= 3 && (
          <FadeIn>
            <ThreadMsg
              initials={CAST.jenna.initials}
              color={CAST.jenna.color}
              name={CAST.jenna.name}
              time="10:22 AM"
              visible
            >
              <span
                className="rounded-sm px-0.5 font-medium"
                style={{
                  color: THREAD_BLUE,
                  background: "rgba(18,100,163,0.1)",
                }}
              >
                @DAM
              </span>{" "}
              make a ticket from this thread
              {step >= 4 && (
                <div className="mt-1">
                  <ReactionPill emoji="👀" count={1} visible />
                </div>
              )}
            </ThreadMsg>
          </FadeIn>
        )}

        {step === 4 && <TypingDots visible />}

        {step >= 5 && (
          <FadeIn>
            <AgentMsg time="10:23 AM" visible>
              <DraftCard visible={step === 5 || step === 6} />
            </AgentMsg>
          </FadeIn>
        )}

        {step >= 6 && (
          <FadeIn>
            <ThreadMsg
              initials={CAST.jenna.initials}
              color={CAST.jenna.color}
              name={CAST.jenna.name}
              time="10:24 AM"
              visible
            >
              Looks good. File it and assign Jordan.
            </ThreadMsg>
          </FadeIn>
        )}

        {step >= 7 && (
          <FadeIn>
            <AgentMsg time="10:24 AM" visible>
              <FiledCard />
              <div className="mt-1 flex items-center gap-1.5">
                <ReactionPill emoji="🙌" count={1} visible />
                <ReactionPill emoji="✅" count={1} visible />
              </div>
            </AgentMsg>
          </FadeIn>
        )}
      </div>

      <Composer placeholder="Reply…" compact />
    </div>
  );
}

/* ── Thread message row ──────────────────────────────────────────── */

function ThreadMsg({
  initials,
  color,
  name,
  time,
  children,
  visible,
}: {
  initials: string;
  color: string;
  name: string;
  time: string;
  children: React.ReactNode;
  visible: boolean;
}) {
  return (
    <Reveal visible={visible}>
      <div className="flex gap-2 px-4 py-1.5">
        <PersonAvatar initials={initials} color={color} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[14px] font-bold text-foreground">
              {name}
            </span>
            <span className="text-[11px] text-muted-foreground/60">
              {time}
            </span>
          </div>
          <div className="mt-0.5 text-[14px] leading-snug text-foreground">
            {children}
          </div>
        </div>
      </div>
    </Reveal>
  );
}

function AgentMsg({
  time,
  visible,
  children,
}: {
  time: string;
  visible: boolean;
  children: React.ReactNode;
}) {
  return (
    <Reveal visible={visible}>
      <div className="flex gap-2 px-4 py-1.5">
        <AgentAvatar />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span className="text-[14px] font-bold text-foreground">DAM</span>
            <span className="relative -top-px rounded bg-muted px-1 py-px text-[10px] font-semibold text-muted-foreground">
              APP
            </span>
            <span className="text-[11px] text-muted-foreground/60">
              {time}
            </span>
          </div>
          <div className="mt-0.5">{children}</div>
          <p className="mt-1 text-[11px] text-muted-foreground/50">
            Damitha - Powered by DAM
          </p>
        </div>
      </div>
    </Reveal>
  );
}

/* ── Cards ────────────────────────────────────────────────────────── */

function DraftCard({ visible }: { visible: boolean }) {
  return (
    <div
      className="mt-1 overflow-hidden rounded-lg border border-input transition-all duration-[250ms]"
      style={{ opacity: visible ? 1 : 0.4 }}
    >
      <div className="border-l-[3px] border-l-amber-400 bg-muted/30 p-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-600">
          Draft
        </span>
        <p className="mt-1 text-[13px] font-semibold leading-snug text-foreground">
          Save button does nothing in Safari
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          From Sofia, Sasha and Jordan · 1 screenshot
        </p>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="rounded-md px-2.5 py-1 text-[12px] font-medium text-white"
            style={{ background: "#0f62fe" }}
          >
            File it
          </span>
          <span className="rounded-md border border-input px-2.5 py-1 text-[12px] font-medium text-foreground">
            Edit
          </span>
        </div>
      </div>
    </div>
  );
}

function FiledCard() {
  return (
    <div className="mt-1 overflow-hidden rounded-lg border border-input">
      <div className="border-l-[3px] border-l-green-500 bg-muted/30 p-2.5">
        <div className="flex items-center gap-1.5">
          <span className="text-[12px] text-green-600">
            ✓
          </span>
          <span className="text-[12px] font-semibold text-muted-foreground">
            #4352
          </span>
        </div>
        <p className="mt-1 text-[13px] font-semibold leading-snug text-foreground">
          Save button does nothing in Safari
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Assigned to Jordan Jacobs
        </p>
        <div className="mt-1.5 border-t border-input pt-1.5">
          <span
            className="text-[12px] font-medium"
            style={{ color: THREAD_BLUE }}
          >
            Open issue →
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── Small primitives ────────────────────────────────────────────── */

function FileChip({
  name,
  icon,
}: {
  name: string;
  icon: "doc" | "img";
}) {
  return (
    <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border border-input bg-muted/40 px-2 py-1">
      {icon === "doc" ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className="shrink-0 text-muted-foreground"
        >
          <path
            d="M4 1.5h4.5L11 4v8.5H4V1.5z"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <path
            d="M8.5 1.5V4H11"
            stroke="currentColor"
            strokeWidth="1.1"
          />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          className="shrink-0 text-muted-foreground"
        >
          <rect
            x="2"
            y="3"
            width="10"
            height="8"
            rx="1"
            stroke="currentColor"
            strokeWidth="1.1"
          />
          <circle cx="5" cy="6.5" r="1" fill="currentColor" />
          <path
            d="M2 9.5l3-2 2 1.5 3-2.5 2 1.5"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinejoin="round"
          />
        </svg>
      )}
      <span className="text-[12px] text-foreground">{name}</span>
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
                ? `slkDots 1.2s ${i * 0.2}s ease-in-out infinite`
                : "none",
            }}
          />
        ))}
      </div>
    </div>
  );
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

function FadeIn({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ animation: "slkFadeIn 250ms ease-out" }}>{children}</div>
  );
}

function ReplySeparator({
  count,
  visible,
}: {
  count: number;
  visible: boolean;
}) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-1 transition-opacity duration-[250ms]"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <div className="h-px flex-1 bg-input" />
      <span className="text-[11px] font-medium text-muted-foreground">
        {count} {count === 1 ? "reply" : "replies"}
      </span>
      <div className="h-px flex-1 bg-input" />
    </div>
  );
}

function OldMessages() {
  return (
    <div className="space-y-3 px-4 py-2 opacity-[0.12]">
      {[65, 50, 80].map((w, i) => (
        <div key={i} className="flex gap-2">
          <div className="size-9 shrink-0 rounded-lg bg-muted-foreground/30" />
          <div className="flex-1 space-y-1.5 pt-0.5">
            <div
              className="h-3 rounded bg-muted-foreground/30"
              style={{ width: "30%" }}
            />
            <div
              className="h-2.5 rounded bg-muted-foreground/20"
              style={{ width: `${w}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function Composer({
  placeholder,
  compact,
}: {
  placeholder: string;
  compact?: boolean;
}) {
  return (
    <div className="px-3 py-2">
      <div className="rounded-lg border border-input">
        <div className="px-3 py-1.5">
          <span className="text-[12px] text-placeholder">{placeholder}</span>
        </div>
        <div className="flex items-center justify-between border-t border-input px-2 py-1">
          <div className="flex items-center gap-0.5">
            {(compact ? ["B", "I"] : ["B", "I", "S"]).map((l) => (
              <div
                key={l}
                className="flex size-5 items-center justify-center rounded text-[10px] font-bold text-muted-foreground/25"
              >
                {l}
              </div>
            ))}
            {!compact && (
              <>
                <div className="mx-0.5 h-3 w-px bg-input" />
                {[0, 1].map((i) => (
                  <div
                    key={i}
                    className="size-5 rounded bg-muted-foreground/[0.05]"
                  />
                ))}
              </>
            )}
          </div>
          <div
            className="flex size-6 items-center justify-center rounded-md"
            style={{ background: SEND_GREEN }}
          >
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <path
                d="M4.156 7L9.844 4.156L7 9.844L6.344 7.656L4.156 7Z"
                fill="white"
              />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chevron() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className="text-muted-foreground"
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <div className="flex size-7 items-center justify-center rounded text-muted-foreground/50">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle
          cx="6.5"
          cy="6.5"
          r="4"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M10 10l3 3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function CloseIcon() {
  return (
    <div className="flex size-7 items-center justify-center rounded text-muted-foreground/50">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path
          d="M3.5 3.5l7 7M10.5 3.5l-7 7"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

/* ── Main export ──────────────────────────────────────────────────── */

export function SlackTeamIllustration() {
  injectStyles();

  const containerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const inView = useInView(containerRef);
  const step = useAnimationStep(!inView, reduceMotion);

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Illustration: a team in Slack files a bug report together with their DAM agent."
    >
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-xl shadow-[0_8px_40px_rgba(0,0,0,0.12),0_2px_8px_rgba(0,0,0,0.06)]"
        style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
      >
        <div className="flex h-[520px]">
          <Sidebar />
          <ChannelPane step={step} />
          <div
            className="h-full shrink-0 overflow-hidden bg-background transition-[width] duration-[350ms] ease-out"
            style={{ width: step >= 0 ? 340 : 0 }}
          >
            <ThreadPanel step={step} />
          </div>
        </div>
      </div>
    </div>
  );
}
