import { useEffect, useRef, useState } from "react";

/* ── Compass character (static copy — the team's DAM agent avatar) ── */

const CHAR_PINK = "#E89DA8";
const CHAR_GREEN = "#3F6C45";

function AgentCharSvg() {
  return (
    <svg viewBox="0 0 125 125" fill="none">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M75.74 53.57C70.80 53.57 66.80 57.58 66.80 62.52C66.80 67.46 70.80 71.46 75.74 71.46C80.68 71.46 84.68 67.46 84.68 62.52C84.68 57.58 80.68 53.57 75.74 53.57Z"
        fill={CHAR_PINK}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M49.25 53.57C44.31 53.57 40.30 57.58 40.30 62.52C40.30 67.46 44.31 71.46 49.25 71.46C54.19 71.46 58.19 67.46 58.19 62.52C58.19 57.58 54.19 53.57 49.25 53.57Z"
        fill={CHAR_PINK}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M88.32 85.79L108.71 67.84L108.72 95.73C108.63 100.73 106.21 106.37 99.75 108.40C93.04 110.52 85.81 106.77 83.69 100.05C81.90 94.36 84.20 89.45 88.32 85.79Z"
        fill={CHAR_GREEN}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M88.32 39.20L108.71 57.14L108.72 29.25C108.63 24.26 106.21 18.62 99.75 16.58C93.04 14.47 85.81 18.22 83.69 24.93C81.90 30.62 84.20 35.53 88.32 39.20Z"
        fill={CHAR_GREEN}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M36.43 39.20L16.04 57.14L16.03 29.25C16.12 24.26 18.54 18.62 24.99 16.58C31.71 14.47 38.94 18.22 41.06 24.93C42.85 30.62 40.55 35.53 36.43 39.20Z"
        fill={CHAR_GREEN}
      />
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M36.43 85.79L16.04 67.84L16.03 95.73C16.12 100.73 18.54 106.37 24.99 108.40C31.71 110.52 38.94 106.77 41.06 100.05C42.85 94.36 40.55 89.45 36.43 85.79Z"
        fill={CHAR_GREEN}
      />
    </svg>
  );
}

/* ── Animation timing (plays once, holds at final state) ─────────── */

const BEATS = [0, 1800, 3400, 5000, 6600, 8400, 10600, 12600] as const;

/* Step → what appears:
   -1  blank
    0  Sarah's message in channel + thread opens
    1  Samantha reply + file chip
    2  Jamie reply + image chip
    3  Jenna "@DAM draft a ticket from this thread"
    4  👀 reaction on Jenna's msg + typing dots
    5  Damitha draft card (typing dots gone)
    6  Jenna "Looks good. File it and assign Jamie."
    7  Damitha filed card + 🙌 + ✅ reactions                       */

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
    if (paused) return;
    if (hasPlayed.current) return;

    hasPlayed.current = true;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const offset = 400;
    for (let i = 0; i < BEATS.length; i++) {
      timers.push(
        setTimeout(
          () => {
            if (!cancelled) setStep(i);
          },
          BEATS[i] + offset,
        ),
      );
    }

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
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
  `;
  document.head.appendChild(s);
}

/* ── Palette ─────────────────────────────────────────────────────── */

const SLACK_AUBERGINE = "#3F0E40";
const SLACK_ACTIVE = "#1164A3";
const THREAD_BLUE = "#1264A3";
const SEND_GREEN = "#007A5A";

const CAST = {
  sarah: { initials: "SM", color: "#4589ff", name: "Sarah Miller" },
  samantha: { initials: "SD", color: "#a56eff", name: "Samantha Dempsey" },
  jamie: { initials: "JJ", color: "#42be65", name: "Jamie Jabbour" },
  jenna: { initials: "JW", color: "#ee5396", name: "Jenna Winkler" },
} as const;

/* ── IBM logo (official 8-bar from public/ibm-logo.svg, fill swapped to white) */

function IbmLogo() {
  return (
    <svg viewBox="0 0 113 45" fill="white" className="h-[14px]">
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
    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#e8f5e9] dark:bg-[#1b3a1e]">
      <div className="size-6">
        <AgentCharSvg />
      </div>
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
          className="flex size-[26px] items-center justify-center rounded-md"
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
                  New users say setup takes too long before they get a working
                  agent.
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
    if (step < 5) return;
    const el = scrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, [step]);

  return (
    <div
      className="flex w-[340px] shrink-0 flex-col border-l border-input bg-background xl:w-[380px]"
      style={{
        opacity: step >= 0 ? 1 : 0,
        transition: "opacity 300ms ease-out",
      }}
    >
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

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Parent message — Sarah */}
        <ThreadMsg
          initials={CAST.sarah.initials}
          color={CAST.sarah.color}
          name={CAST.sarah.name}
          time="10:12 AM"
          visible={step >= 0}
        >
          New users say setup takes too long before they get a working agent.
        </ThreadMsg>

        <ReplySeparator
          count={step >= 7 ? 5 : step >= 6 ? 4 : step >= 5 ? 3 : step >= 3 ? 2 : 1}
          visible={step >= 1}
        />

        {/* Beat 1 — Samantha + file chip */}
        <ThreadMsg
          initials={CAST.samantha.initials}
          color={CAST.samantha.color}
          name={CAST.samantha.name}
          time="10:14 AM"
          visible={step >= 1}
        >
          Same thing came up in our interviews. Notes attached.
          <FileChip name="onboarding-interviews.pdf" icon="doc" />
        </ThreadMsg>

        {/* Beat 2 — Jamie + image chip */}
        <ThreadMsg
          initials={CAST.jamie.initials}
          color={CAST.jamie.color}
          name={CAST.jamie.name}
          time="10:18 AM"
          visible={step >= 2}
        >
          Here's a lighter flow to start from.
          <FileChip name="quick-setup-flow.png" icon="img" />
        </ThreadMsg>

        {/* Beat 3 — Jenna asks the agent */}
        <ThreadMsg
          initials={CAST.jenna.initials}
          color={CAST.jenna.color}
          name={CAST.jenna.name}
          time="10:22 AM"
          visible={step >= 3}
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
          draft a ticket from this thread
          <div className="mt-1">
            <ReactionPill emoji="👀" count={1} visible={step >= 4} />
          </div>
        </ThreadMsg>

        {/* Beat 4 — Typing dots */}
        <TypingDots visible={step === 4} />

        {/* Beat 5 — Damitha draft card */}
        <AgentMsg time="10:23 AM" visible={step >= 5}>
          <DraftCard visible={step === 5 || step === 6} />
        </AgentMsg>

        {/* Beat 6 — Jenna approves */}
        <ThreadMsg
          initials={CAST.jenna.initials}
          color={CAST.jenna.color}
          name={CAST.jenna.name}
          time="10:24 AM"
          visible={step >= 6}
        >
          Looks good. File it and assign Jamie.
        </ThreadMsg>

        {/* Beat 7 — Damitha filed card + reactions */}
        <AgentMsg time="10:24 AM" visible={step >= 7}>
          <FiledCard />
          <div className="mt-1 flex items-center gap-1.5">
            <ReactionPill emoji="🙌" count={1} visible={step >= 7} />
            <ReactionPill emoji="✅" count={1} visible={step >= 7} />
          </div>
        </AgentMsg>
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
            Damitha · Powered by DAM
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
        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
          Draft
        </span>
        <p className="mt-1 text-[13px] font-semibold leading-snug text-foreground">
          New users do too much setup before their first agent
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          From Sarah, Samantha and Jamie · 2 files
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
          <span className="text-[12px] text-green-600 dark:text-green-400">
            ✓
          </span>
          <span className="text-[12px] font-semibold text-muted-foreground">
            #4352
          </span>
        </div>
        <p className="mt-1 text-[13px] font-semibold leading-snug text-foreground">
          New users do too much setup before their first agent
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Assigned to Jamie Jabbour
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
      aria-label="Illustration: a team in Slack builds a ticket together with their DAM agent."
    >
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-xl border border-input shadow-[0_4px_24px_rgba(56,56,56,0.08)]"
        style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}
      >
        <div className="flex h-[520px]">
          <Sidebar />
          <ChannelPane step={step} />
          <ThreadPanel step={step} />
        </div>
      </div>
    </div>
  );
}
