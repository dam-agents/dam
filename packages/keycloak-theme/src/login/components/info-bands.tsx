import React, { useEffect, useRef, useState } from "react";
import { SlackTeamIllustration } from "./slack-team-illustration.js";

const LOGIN_DOCS_URL = "https://ibm.biz/dam-docs";

/* ── Shared typography ──────────────────────────────────────────────── */

function SectionLabel({
  children,
  color,
}: {
  children: React.ReactNode;
  color?: string;
}) {
  return (
    <p
      className="text-[13px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
      style={color ? { color } : undefined}
    >
      {children}
    </p>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-3 text-[32px] font-light leading-[1.15] -tracking-[0.02em] text-foreground md:text-[40px]">
      {children}
    </h2>
  );
}

/* ── Storybook gesture CSS (stack character hover) ─────────────────── */

const STACK_GESTURE_CSS = `
@keyframes bee-char-look-leye {
  0%, 100%  { transform: translate(0, 0) scale(1); }
  25%, 38%  { transform: translate(135px, -80px) scale(1); }
  58%, 72%  { transform: translate(-135px, -80px) scale(1.15); }
}
@keyframes bee-char-look-reye {
  0%, 100%  { transform: translate(0, 0) scale(1); }
  25%, 38%  { transform: translate(135px, -80px) scale(1.15); }
  58%, 72%  { transform: translate(-135px, -80px) scale(1); }
}
@keyframes bee-char-bob {
  0%, 100% { transform: translateY(0); }
  45% { transform: translateY(-220px); }
}
.bee-avatar .bee-eyes-wake > * {
  transform-box: fill-box;
  transform-origin: center;
}
.group:hover .bee-char .bee-eyes-wake > :nth-child(1) {
  animation: bee-char-look-leye 1.2s ease-in-out;
}
.group:hover .bee-char .bee-eyes-wake > :nth-child(2) {
  animation: bee-char-look-reye 1.2s ease-in-out;
}
.group:hover .bee-char[data-icon="stack"] svg > rect:nth-of-type(3) {
  animation: bee-char-bob 0.4s ease-in-out;
}
.group:hover .bee-char[data-icon="stack"] svg > rect:nth-of-type(2) {
  animation: bee-char-bob 0.4s ease-in-out 0.1s;
}
.group:hover .bee-char[data-icon="stack"] svg > rect:nth-of-type(1) {
  animation: bee-char-bob 0.4s ease-in-out 0.2s;
}
`;

function useStackGestureStyles() {
  const injected = useRef(false);
  useEffect(() => {
    if (injected.current) return;
    injected.current = true;
    const style = document.createElement("style");
    style.textContent = STACK_GESTURE_CSS;
    document.head.appendChild(style);
  }, []);
}

/* ── Shared card primitives ─────────────────────────────────────────── */

const CARD =
  "rounded-xl border border-input bg-background shadow-[0_2px_16px_rgba(0,0,0,0.06)]";

/* ── Avatar palette ─────────────────────────────────────────────────── */

const ACCENT = {
  cyan: "#04a3be",
  green: "#03b065",
  indigo: "#7584fe",
  pink: "#f04e82",
  orange: "#e38804",
  purple: "#af6af2",
  blue: "#0199f0",
  teal: "#03a99b",
} as const;

/* ── Scene illustration primitives ──────────────────────────────────── */

const SCENE_CARD =
  "absolute rounded-lg border border-input bg-background shadow-[0_4px_24px_rgba(56,56,56,0.08)]";

function SceneCanvas({
  w,
  h,
  children,
}: {
  w: number;
  h: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="relative w-full"
      style={{ maxWidth: w, height: h }}
      aria-hidden="true"
    >
      {children}
    </div>
  );
}

function SceneTile({
  x,
  y,
  color,
  children,
}: {
  x: number;
  y: number;
  color: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute flex size-[30px] items-center justify-center rounded-[7px] border border-input bg-background"
      style={{ left: x, top: y, color }}
    >
      {children}
    </div>
  );
}

function InfoBlock({
  scene,
  title,
  children,
}: {
  scene: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      {scene}
      <p className="mt-5 text-[16px] font-semibold leading-snug text-foreground">
        {title}
      </p>
      <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
        {children}
      </p>
    </div>
  );
}


/* ═══════ Band: Agents that work where you work ════════════════════ */

function SkeletonBar({ w, className }: { w: string; className?: string }) {
  return (
    <div
      className={`h-[5px] rounded-full bg-input ${className ?? ""}`}
      style={{ width: w }}
    />
  );
}

function MiniDamLogo({ size = 14 }: { size?: number }) {
  const fs = Math.round(size * 0.36);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded"
      style={{
        width: size,
        height: size,
        background:
          "linear-gradient(135deg, #dbeafe 0%, #f3e8ff 50%, #fce7f3 100%)",
      }}
    >
      <span
        className="font-semibold leading-none text-foreground"
        style={{ fontSize: fs }}
      >
        DAM
      </span>
    </div>
  );
}

function MiniWebChat({ className }: { className?: string }) {
  return (
    <div className={`flex w-full flex-col ${className ?? ""}`}>
      <div className="flex-1 p-2.5">
        {/* User message — right-aligned bubble */}
        <div className="flex justify-end">
          <div className="rounded-lg rounded-br-sm bg-foreground/10 px-2 py-1">
            <SkeletonBar w="48px" className="!bg-foreground/20" />
            <SkeletonBar w="36px" className="mt-0.5 !bg-foreground/15" />
          </div>
        </div>
        {/* Agent reply — left-aligned with avatar */}
        <div className="mt-2 flex gap-1.5">
          <MiniDamLogo size={14} />
          <div className="space-y-1">
            <SkeletonBar w="56px" className="!bg-purple-300/30" />
            <SkeletonBar w="44px" className="!bg-purple-300/20" />
            <SkeletonBar w="32px" className="!bg-purple-300/20" />
          </div>
        </div>
      </div>
      {/* Input bar */}
      <div className="mx-2 mb-2 flex items-center gap-1 rounded-md border border-input bg-muted/30 px-1.5 py-1">
        <SkeletonBar w="50px" className="!bg-input/60" />
        <div className="ml-auto size-[8px] rounded bg-foreground/15" />
      </div>
    </div>
  );
}

function MiniSlack({ className }: { className?: string }) {
  return (
    <div className={`flex w-full ${className ?? ""}`}>
      <div
        className="w-[32px] shrink-0 border-r border-input"
        style={{ backgroundColor: "#4a154b" }}
      >
        <div className="mx-auto mt-2 size-[10px] rounded bg-white/30" />
        <div className="mx-auto mt-1 size-[10px] rounded bg-white/20" />
      </div>
      <div className="flex-1 p-2">
        <div className="flex items-center gap-1">
          <span className="text-[8px] font-bold text-foreground"># team</span>
        </div>
        <div className="mt-2 flex gap-1">
          <div className="size-[12px] shrink-0 rounded-sm bg-input" />
          <div className="space-y-1">
            <SkeletonBar w="52px" />
            <SkeletonBar w="40px" className="bg-input/60" />
          </div>
        </div>
        <div className="mt-1.5 flex gap-1">
          <div className="size-[12px] shrink-0 rounded-sm bg-accent/40" />
          <div className="space-y-1">
            <SkeletonBar w="40px" />
            <SkeletonBar w="56px" className="bg-input/60" />
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniGitHub({ className }: { className?: string }) {
  return (
    <div className={`w-full p-2.5 ${className ?? ""}`}>
      {/* PR title row */}
      <div className="flex items-center gap-1.5">
        <span className="text-[8px] font-semibold text-foreground">Add CSV export</span>
        <span className="ml-auto rounded-full bg-[#8b5cf6]/15 px-1.5 py-px text-[6px] font-medium text-[#8b5cf6]">
          merged
        </span>
      </div>
      {/* Labels row */}
      <div className="mt-2 flex gap-1">
        <span className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-px text-[6px] text-blue-600 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
          feature
        </span>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-px text-[6px] text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400">
          agent-authored
        </span>
      </div>
      {/* File changes */}
      <div className="mt-2.5 space-y-1">
        <div className="flex items-center gap-1">
          <div className="size-[6px] rounded-sm bg-emerald-500" />
          <span className="text-[7px] text-muted-foreground">src/export.ts</span>
          <span className="ml-auto text-[6px] text-emerald-500">+42</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="size-[6px] rounded-sm bg-emerald-500" />
          <span className="text-[7px] text-muted-foreground">src/index.ts</span>
          <span className="ml-auto text-[6px] text-emerald-500">+3</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="size-[6px] rounded-sm bg-amber-500" />
          <span className="text-[7px] text-muted-foreground">test/export.test.ts</span>
          <span className="ml-auto text-[6px] text-emerald-500">+18</span>
        </div>
      </div>
      {/* Checks */}
      <div className="mt-2 flex items-center gap-1 border-t border-input pt-1.5">
        <svg width="8" height="8" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="8" cy="8" r="6" className="fill-emerald-500" />
          <path d="M5 8l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[7px] text-muted-foreground">All checks passed</span>
      </div>
    </div>
  );
}

function MiniCli({ className }: { className?: string }) {
  return (
    <div
      className={`w-full bg-[#1e1e1e] p-2.5 text-[7px] font-mono leading-[1.6] text-[#d4d4d4] ${className ?? ""}`}
    >
      <p>
        <span className="text-[#6A9955]">$</span> dam chat
      </p>
      <p className="mt-1 text-[#808080]">Summarize this week&apos;s</p>
      <p className="text-[#808080]">product notes</p>
      <p className="mt-1.5 text-[#dcdcaa]">Top theme: support queue</p>
      <SkeletonBar w="60%" className="mt-1 !bg-[#333]" />
      <SkeletonBar w="44px" className="mt-0.5 !bg-[#333]" />
    </div>
  );
}

function MiniIde({ className }: { className?: string }) {
  return (
    <div className={`flex w-full ${className ?? ""}`}>
      <div className="w-[28px] shrink-0 border-r border-input bg-[#252526] p-1">
        <div className="space-y-1.5">
          <div className="size-[8px] rounded-sm bg-[#555]" />
          <div className="size-[8px] rounded-sm bg-[#555]" />
          <div className="size-[8px] rounded-sm bg-[#3b82f6]" />
        </div>
      </div>
      <div className="flex-1 bg-[#1e1e1e] p-2 text-[7px] font-mono leading-[1.6]">
        <p className="text-[#569cd6]">function</p>
        <p className="text-[#dcdcaa]">
          &nbsp;&nbsp;getTotal<span className="text-[#d4d4d4]">()</span>
        </p>
        <p className="text-[#d4d4d4]">&nbsp;&nbsp;{"{"}</p>
        <p>
          <span className="text-[#c586c0]">&nbsp;&nbsp;&nbsp;&nbsp;return</span>
          <span className="text-[#b5cea8]"> 42</span>
        </p>
        <p className="text-[#d4d4d4]">&nbsp;&nbsp;{"}"}</p>
      </div>
    </div>
  );
}

function MiniMonday({ className }: { className?: string }) {
  return (
    <div className={`w-full p-2.5 ${className ?? ""}`}>
      <div className="flex items-center gap-1.5">
        <svg width="12" height="12" viewBox="0 0 64 64" fill="none" aria-hidden>
          <path d="M8.4 43.2c-3.6 0-6.4-3.2-6.4-6.8 0-2.4 1.2-4.6 3.2-5.8l17.2-11.6c3-2 7-1.2 9 1.8s1.2 7-1.8 9L12.4 41.4c-1.2.8-2.6 1.8-4 1.8z" fill="#FF3D57"/>
          <path d="M28 43.2c-3.6 0-6.6-2.8-6.8-6.4 0-2.4 1.2-4.6 3.2-5.8L41.6 19.4c3-2 7-1.2 9 1.8s1.2 7-1.8 9L31.6 41.8c-1 .8-2.4 1.4-3.6 1.4z" fill="#FFCB00"/>
          <circle cx="53.8" cy="38.8" r="6" fill="#00D647"/>
        </svg>
        <span className="text-[8px] font-semibold text-foreground">Sprint board</span>
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center gap-1">
          <div className="h-[5px] w-[40%] rounded-full bg-[#00D647]" />
          <span className="text-[6px] text-muted-foreground">Done</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-[5px] w-[25%] rounded-full bg-[#FFCB00]" />
          <span className="text-[6px] text-muted-foreground">In progress</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="h-[5px] w-[15%] rounded-full bg-[#FF3D57]" />
          <span className="text-[6px] text-muted-foreground">Stuck</span>
        </div>
      </div>
    </div>
  );
}

function MiniOutlook({ className }: { className?: string }) {
  return (
    <div className={`w-full p-2.5 ${className ?? ""}`}>
      <div className="flex items-center gap-1.5">
        <svg width="10" height="10" viewBox="0 0 32 32" fill="none" aria-hidden>
          <rect x="3" y="6" width="26" height="20" rx="2" fill="#0078D4"/>
          <path d="M3 10l13 8 13-8" stroke="#fff" strokeWidth="1.5" fill="none"/>
        </svg>
        <span className="text-[8px] font-semibold text-foreground">Inbox</span>
      </div>
      <div className="mt-2 space-y-1.5">
        <div className="flex gap-1.5">
          <div className="size-[10px] shrink-0 rounded-full bg-[#0078D4]/30" />
          <div className="space-y-0.5">
            <SkeletonBar w="56px" />
            <SkeletonBar w="40px" className="bg-input/60" />
          </div>
        </div>
        <div className="flex gap-1.5">
          <div className="size-[10px] shrink-0 rounded-full bg-input" />
          <div className="space-y-0.5">
            <SkeletonBar w="48px" />
            <SkeletonBar w="52px" className="bg-input/60" />
          </div>
        </div>
      </div>
    </div>
  );
}

function DottedCircle({
  size,
  style,
}: {
  size: number;
  style?: React.CSSProperties;
}) {
  const r = size / 2 - 1;
  return (
    <div className="absolute" style={style}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          className="stroke-muted-foreground/20"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      </svg>
    </div>
  );
}

export function BandIntegrations() {
  return (
    <section className="relative min-h-[100dvh] snap-start overflow-hidden">
      <div className="relative flex min-h-[100dvh] items-center">
        <div className="mx-auto w-full max-w-[1120px] px-6">
          <div className="flex flex-col items-center gap-16 lg:flex-row lg:gap-20">
            {/* Left — text */}
            <div className="lg:w-[420px] lg:shrink-0">
              <SectionTitle>
                Agents that work
                <br />
                where you work.
              </SectionTitle>
              <p className="mt-6 text-[16px] leading-relaxed text-muted-foreground">
                Your agent lives in Slack, GitHub, your terminal, and your
                editor. Talk to it wherever you already work.
              </p>
            </div>

            {/* Right — stacked app windows */}
            <div className="hidden flex-1 items-center justify-center lg:flex">
              <div className="relative" style={{ width: 490, height: 580 }}>
                <DottedCircle size={440} style={{ top: 70, left: 25 }} />

                {/* Row 1 — Slack (wide) + Web chat (narrow) */}
                <div className={`${CARD} absolute left-[30px] top-[0px] w-[280px] overflow-hidden`}>
                  <div className="flex items-center gap-1.5 border-b border-input bg-muted/40 px-3 py-1.5">
                    <svg width="12" height="12" viewBox="0 0 128 128" aria-hidden>
                      <path d="M27.255 80.719c0 7.33-5.978 13.317-13.309 13.317C6.616 94.036.63 88.049.63 80.719s5.987-13.317 13.317-13.317h13.309zm6.709 0c0-7.33 5.987-13.317 13.317-13.317s13.317 5.986 13.317 13.317v33.335c0 7.33-5.986 13.317-13.317 13.317-7.33 0-13.317-5.987-13.317-13.317z" fill="#E01E5A"/>
                      <path d="M47.281 27.255c-7.33 0-13.317-5.978-13.317-13.309C33.964 6.616 39.951.63 47.281.63s13.317 5.987 13.317 13.317v13.309zm0 6.709c7.33 0 13.317 5.987 13.317 13.317s-5.986 13.317-13.317 13.317H13.946C6.616 60.598.63 54.612.63 47.281c0-7.33 5.987-13.317 13.317-13.317z" fill="#36C5F0"/>
                      <path d="M100.745 47.281c0-7.33 5.978-13.317 13.309-13.317 7.33 0 13.317 5.987 13.317 13.317s-5.987 13.317-13.317 13.317h-13.309zm-6.709 0c0 7.33-5.987 13.317-13.317 13.317s-13.317-5.986-13.317-13.317V13.946C67.402 6.616 73.388.63 80.719.63c7.33 0 13.317 5.987 13.317 13.317z" fill="#2EB67D"/>
                      <path d="M80.719 100.745c7.33 0 13.317 5.978 13.317 13.309 0 7.33-5.987 13.317-13.317 13.317s-13.317-5.987-13.317-13.317v-13.309zm0-6.709c-7.33 0-13.317-5.987-13.317-13.317s5.986-13.317 13.317-13.317h33.335c7.33 0 13.317 5.986 13.317 13.317 0 7.33-5.987 13.317-13.317 13.317z" fill="#ECB22E"/>
                    </svg>
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      Slack
                    </span>
                  </div>
                  <MiniSlack className="h-[150px]" />
                </div>

                <div className={`${CARD} absolute right-[5px] top-[10px] w-[200px] overflow-hidden`}>
                  <div className="flex items-center gap-1.5 border-b border-input bg-muted/40 px-3 py-1.5">
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      DAM Web UI
                    </span>
                  </div>
                  <MiniWebChat className="h-[120px]" />
                </div>

                {/* Row 2 — GitHub (wide, overlapping) */}
                <div className={`${CARD} absolute left-[55px] top-[180px] w-[310px] overflow-hidden`}>
                  <div className="flex items-center gap-1.5 border-b border-input bg-muted/40 px-3 py-1.5">
                    <svg width="12" height="12" viewBox="0 0 98 96" aria-hidden>
                      <path fillRule="evenodd" clipRule="evenodd" d="M48.854 0C21.839 0 0 22 0 49.217c0 21.756 13.993 40.172 33.405 46.69 2.427.49 3.316-1.059 3.316-2.362 0-1.141-.08-5.052-.08-9.127-13.59 2.934-16.42-5.867-16.42-5.867-2.184-5.704-5.42-7.17-5.42-7.17-4.448-3.015.324-3.015.324-3.015 4.934.326 7.523 5.052 7.523 5.052 4.367 7.496 11.404 5.378 14.235 4.074.404-3.178 1.699-5.378 3.074-6.6-10.839-1.141-22.243-5.378-22.243-24.283 0-5.378 1.94-9.778 5.014-13.2-.485-1.222-2.184-6.275.486-13.038 0 0 4.125-1.304 13.426 5.052a46.97 46.97 0 0112.214-1.63c4.125 0 8.33.571 12.213 1.63 9.302-6.356 13.427-5.052 13.427-5.052 2.67 6.763.97 11.816.485 13.038 3.155 3.422 5.015 7.822 5.015 13.2 0 18.905-11.404 23.06-22.324 24.283 1.78 1.548 3.316 4.481 3.316 9.126 0 6.6-.08 11.897-.08 13.526 0 1.304.89 2.853 3.316 2.364 19.412-6.52 33.405-24.935 33.405-46.691C97.707 22 75.788 0 48.854 0z" className="fill-foreground"/>
                    </svg>
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      GitHub
                    </span>
                  </div>
                  <MiniGitHub className="h-[150px]" />
                </div>

                {/* Row 3 — Terminal (dark, wide) */}
                <div className="absolute left-[15px] top-[345px] w-[310px] overflow-hidden rounded-xl border border-[#333] shadow-[0_8px_32px_rgba(0,0,0,0.15)]">
                  <div className="flex items-center gap-1.5 border-b border-[#333] bg-[#252526] px-3 py-1.5">
                    <div className="size-[7px] rounded-full bg-[#ff5f57]" />
                    <div className="size-[7px] rounded-full bg-[#febc2e]" />
                    <div className="size-[7px] rounded-full bg-[#28c840]" />
                    <span className="ml-2 text-[10px] text-[#808080]">
                      Terminal
                    </span>
                  </div>
                  <MiniCli className="h-[120px]" />
                </div>

                {/* Row 3 — VS Code (overlapping terminal, right) */}
                <div className={`${CARD} absolute right-[5px] top-[395px] w-[230px] overflow-hidden`}>
                  <div className="flex items-center gap-1.5 border-b border-input bg-muted/40 px-3 py-1.5">
                    <svg width="14" height="14" viewBox="0 0 100 100" aria-hidden>
                      <path d="M97.1 11.3l-23-9.7c-2-.8-4.3-.3-5.8 1.2L26.8 41.8 11.1 30c-1.6-1.2-3.9-1.1-5.4.2l-4.2 3.8c-1.7 1.5-1.7 4.2 0 5.7L14.1 50 1.5 60.3c-1.7 1.5-1.7 4.2 0 5.7l4.2 3.8c1.5 1.3 3.8 1.4 5.4.2l15.7-11.8 41.5 39c1.5 1.5 3.8 2 5.8 1.2l23-9.7c1.8-.8 3-2.5 3-4.5V15.8c0-2-1.2-3.7-3-4.5zM75.5 73.4L41.3 50l34.2-23.4v46.8z" fill="#007ACC"/>
                    </svg>
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      VS Code
                    </span>
                  </div>
                  <MiniIde className="h-[110px]" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
/* ═══════ Band 2: Everything it needs to work like a teammate ═════════ */

export function BandCapabilities({ brandName }: { brandName: string }) {
  useStackGestureStyles();
  return (
    <section className="relative min-h-[100dvh] snap-start overflow-x-clip bg-muted/30">
      <div className="flex min-h-[100dvh] items-center">
        <div className="mx-auto w-full max-w-[1120px] px-6">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            {/* Left — text */}
            <div>
              <SectionLabel>What is {brandName}?</SectionLabel>
              <SectionTitle>
                Agents that work like teammates
              </SectionTitle>
              <p className="mt-5 max-w-md text-[16px] leading-relaxed text-muted-foreground">
                Each agent runs in its own sandbox, keeps its files, and keeps
                working after you log off. Build it from reusable blocks,
                connect the tools you already use, and hand off the work.{" "}
                <a
                  href={LOGIN_DOCS_URL}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-accent hover:underline"
                >
                  Read the docs
                </a>
              </p>
            </div>

            {/* Right — agent with floating scene cards */}
            <div className="relative hidden min-h-[660px] lg:block">
              {/* Everything positioned from the center of this container */}
              <div className="absolute left-1/2 top-1/2" style={{ transform: "translate(-50%, -50%)" }}>
                {/* Agent — center focal point */}
                <div className="group relative z-10 cursor-pointer overflow-visible">
                  <div className="bee-avatar bee-char bee-awake overflow-visible" data-icon="stack">
                    <svg viewBox="850 350 1800 2800" fill="none" className="h-[150px] w-auto overflow-visible" aria-hidden="true">
                      <g className="bee-eyes-wake">
                        <path fillRule="evenodd" clipRule="evenodd" d="M1391.43 447C1253.67 447 1142 558.7 1142 696.5C1142 834.3 1253.67 946 1391.43 946C1529.18 946 1640.84 834.3 1640.84 696.5C1640.84 558.7 1529.18 447 1391.43 447Z" fill="#E89DA8" />
                        <path fillRule="evenodd" clipRule="evenodd" d="M2094.25 447C1956.52 447 1844.84 558.7 1844.84 696.5C1844.84 834.3 1956.52 946 2094.25 946C2232 946 2343.67 834.3 2343.67 696.5C2343.67 558.7 2232 447 2094.25 447Z" fill="#E89DA8" />
                      </g>
                      <rect x="935" y="1125" width="1616" height="489.42" fill="#5B76D2" />
                      <rect x="935" y="1837.52" width="1616" height="489.41" fill="#5B76D2" />
                      <rect x="935" y="2550.04" width="1616" height="489.41" fill="#5B76D2" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Cards orbiting the agent — offsets from center */}
              <div className="absolute left-1/2 top-1/2" style={{ transform: "translate(-50%, -50%) translate(-180px, -190px) scale(0.73) rotate(-2deg)" }}>
                <SchedulesScene />
              </div>
              <div className="absolute left-1/2 top-1/2" style={{ transform: "translate(-50%, -50%) translate(65px, -195px) scale(0.75) rotate(1.5deg)" }}>
                <FilesScene />
              </div>
              <div className="absolute left-1/2 top-1/2" style={{ transform: "translate(-50%, -50%) translate(-305px, -10px) scale(0.71) rotate(1deg)" }}>
                <ConnectionsScene />
              </div>
              <div className="absolute left-1/2 top-1/2" style={{ transform: "translate(-50%, -50%) translate(140px, 10px) scale(0.74) rotate(-1.5deg)" }}>
                <SkillsScene />
              </div>
              <div className="absolute left-1/2 top-1/2" style={{ transform: "translate(-50%, -50%) translate(-200px, 180px) scale(0.72) rotate(2deg)" }}>
                <KnowledgeScene />
              </div>
              <div className="absolute left-1/2 top-1/2" style={{ transform: "translate(-50%, -50%) translate(90px, 190px) scale(0.73) rotate(-1deg)" }}>
                <ArtifactsScene />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CapabilityCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <div>
      {children}
      <h3 className="mt-4 text-[17px] font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-[14px] leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}



/* ── Capability scenes ──────────────────────────────────────────────── */

function SchedulesScene() {
  return (
    <SceneCanvas w={280} h={190}>
      <div className={`${SCENE_CARD} left-[12px] top-[10px] w-[210px] px-3 py-2.5`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Schedules</p>
        <div className="mt-2 space-y-0.5">
          <ToggleRow label="Daily review" on />
          <ToggleRow label="Nightly audit" on />
          <ToggleRow label="Weekly sync" on={false} />
        </div>
      </div>
      <SceneTile x={238} y={16} color={ACCENT.cyan}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
          <path d="M8 5v3l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

function ToggleRow({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <p className="text-[14px] font-medium leading-tight text-foreground">{label}</p>
      <div
        className="flex h-4 w-7 items-center rounded-full px-0.5"
        style={{ backgroundColor: on ? "#1a1a1a" : "#dde1e6" }}
      >
        <div
          className="size-3 rounded-full bg-white transition-transform"
          style={{ transform: on ? "translateX(12px)" : "translateX(0)" }}
        />
      </div>
    </div>
  );
}

function FilesScene() {
  return (
    <SceneCanvas w={280} h={200}>
      <div className={`${SCENE_CARD} left-[12px] top-[10px] w-[210px] px-3 py-2.5`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Files</p>
        <div className="mt-2 flex items-center gap-1.5">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke={ACCENT.indigo} strokeWidth="1.2" />
          </svg>
          <span className="text-[14px] font-medium text-foreground">workspace</span>
        </div>
        <div className="ml-4 mt-1.5 space-y-1 border-l border-input pl-3">
          <FileRow name="config.yaml" />
          <FileRow name="memory.md" />
          <FileRow name="output/" folder />
        </div>
      </div>

      <div className={`${SCENE_CARD} left-[44px] top-[140px] flex items-center gap-1.5 px-2.5 py-1.5`}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="7" fill="#24A148" />
          <path d="M5 8l2 2 4-4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-[14px] font-medium text-foreground">Persistent</span>
      </div>

      <SceneTile x={238} y={16} color={ACCENT.indigo}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

function FileRow({ name, folder }: { name: string; folder?: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-[14px] text-muted-foreground">
      {folder ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M2 4a1 1 0 011-1h3l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      )}
      <span>{name}</span>
    </div>
  );
}

function SkillsScene() {
  return (
    <SceneCanvas w={280} h={190}>
      <div className={`${SCENE_CARD} left-[12px] top-[10px] w-[210px] px-3 py-2.5`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Skills</p>
        <div className="mt-2 space-y-0.5">
          <ToggleRow label="Code review" on />
          <ToggleRow label="Plan feature" on />
          <ToggleRow label="Write tests" on={false} />
        </div>
      </div>
      <SceneTile x={238} y={16} color={ACCENT.pink}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 2h5l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" />
          <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

function ConnectionsScene() {
  return (
    <SceneCanvas w={280} h={210}>
      <div className={`${SCENE_CARD} left-[12px] top-[10px] w-[210px] px-3 py-2.5`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Connections</p>
        <div className="mt-2 space-y-0.5">
          <ConnectionRow name="GitHub" connected icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" fill="currentColor" className="text-foreground" />
            </svg>
          } />
          <ConnectionRow name="Slack" connected icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M3.36 10.08a1.68 1.68 0 11-1.68-1.68h1.68v1.68zm.84 0a1.68 1.68 0 113.36 0v4.2a1.68 1.68 0 11-3.36 0v-4.2z" fill="#E01E5A" />
              <path d="M5.88 3.36a1.68 1.68 0 111.68-1.68v1.68H5.88zm0 .84a1.68 1.68 0 110 3.36h-4.2a1.68 1.68 0 110-3.36h4.2z" fill="#36C5F0" />
              <path d="M12.6 5.88a1.68 1.68 0 111.68 1.68H12.6V5.88zm-.84 0a1.68 1.68 0 11-3.36 0v-4.2a1.68 1.68 0 113.36 0v4.2z" fill="#2EB67D" />
              <path d="M10.08 12.6a1.68 1.68 0 11-1.68 1.68V12.6h1.68zm0-.84a1.68 1.68 0 110-3.36h4.2a1.68 1.68 0 110 3.36h-4.2z" fill="#ECB22E" />
            </svg>
          } />
          <ConnectionRow name="Kubernetes" connected icon={
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M8 1l6.06 3.5v7L8 15l-6.06-3.5v-7L8 1z" stroke="#326CE5" strokeWidth="1.1" />
              <circle cx="8" cy="8" r="2.5" stroke="#326CE5" strokeWidth="1.1" />
            </svg>
          } />
        </div>
      </div>
      <SceneTile x={238} y={16} color={ACCENT.green}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M6.5 9.5l3-3M5 11a2.83 2.83 0 01-2-4.83L5.17 4A2.83 2.83 0 0110 6M11 5a2.83 2.83 0 012 4.83L10.83 12A2.83 2.83 0 016 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

function ConnectionRow({ name, connected, icon }: { name: string; connected: boolean; icon: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-[14px] font-medium text-foreground">{name}</span>
      </div>
      <div className={`size-2 rounded-full ${connected ? "bg-emerald-500" : "bg-input"}`} />
    </div>
  );
}

function KnowledgeScene() {
  return (
    <SceneCanvas w={280} h={190}>
      <div className={`${SCENE_CARD} left-[12px] top-[10px] w-[210px] px-3 py-2.5`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Knowledge</p>
        <div className="mt-2 flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.2" />
          </svg>
          <span className="text-[14px] font-semibold text-foreground">Product docs</span>
        </div>
        <p className="mt-1 text-[14px] text-muted-foreground">12 sources</p>
      </div>
      <SceneTile x={238} y={90} color={ACCENT.orange}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M2 4a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

function ArtifactsScene() {
  return (
    <SceneCanvas w={280} h={210}>
      <div className={`${SCENE_CARD} left-[12px] top-[10px] w-[210px] px-3 py-2.5`}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Artifacts</p>
        <div className="mt-2 flex items-center gap-2">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="12" height="12" rx="2" stroke={ACCENT.purple} strokeWidth="1.2" />
            <path d="M5 6h6M5 9h4" stroke={ACCENT.purple} strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="text-[14px] font-semibold text-foreground">Q3 sprint review</span>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">8 views · 2h ago</p>
      </div>
      <div className={`${SCENE_CARD} left-[12px] top-[124px] flex w-[195px] items-center gap-1.5 px-2.5 py-1.5`}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" className="text-muted-foreground" />
          <path d="M2.5 8h11M8 2.5c-1.5 2-2.5 3.5-2.5 5.5s1 3.5 2.5 5.5M8 2.5c1.5 2 2.5 3.5 2.5 5.5s-1 3.5-2.5 5.5" stroke="currentColor" strokeWidth="1" className="text-muted-foreground" />
        </svg>
        <span className="text-[13px] font-medium text-foreground whitespace-nowrap">Shared via link</span>
      </div>
      <SceneTile x={238} y={16} color={ACCENT.purple}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="3" y="2" width="10" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M6 6h4M6 9h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </SceneTile>
    </SceneCanvas>
  );
}

/* ═══════ Band 3: Add it to a channel ═══════════════════════════════ */

export function BandChannels() {
  return (
    <section className="relative min-h-[100dvh] snap-start overflow-hidden">
      {/* Right half — green wing peeks from the right of the Slack illustration */}
      <div className="absolute inset-y-0 right-0 z-10 hidden w-1/2 items-center lg:flex">
        <svg
          className="absolute right-[5%] top-[38%] -translate-y-1/2"
          width="300"
          height="500"
          viewBox="83 14 26 44"
          fill="none"
          aria-hidden
        >
          <path
            d="M88.32 39.20L108.71 57.14L108.72 29.25C108.63 24.26 106.21 18.62 99.75 16.58C93.04 14.47 85.81 18.22 83.69 24.93C81.90 30.62 84.20 35.53 88.32 39.20Z"
            fill="#3F6C45"
          />
        </svg>
        <div className="relative z-10 -ml-[8%] w-[140%] max-w-[860px] pr-10">
          <SlackTeamIllustration />
        </div>
      </div>
      {/* Left half — white bg */}
      <div className="absolute inset-y-0 left-0 hidden w-1/2 bg-background lg:block" />

      <div className="relative z-20 flex min-h-[100dvh] items-center bg-background lg:bg-transparent">
        <div className="mx-auto w-full max-w-[540px] px-6 py-20 lg:mx-0 lg:flex lg:w-1/2 lg:max-w-none lg:items-center lg:justify-center lg:py-28">
          <div className="w-full max-w-[460px]">
            <SectionLabel color="#3F6C45">For everyone on the team</SectionLabel>
            <SectionTitle>
              Add it to a channel.
              <br />
              It keeps things moving.
            </SectionTitle>
            <p className="mt-5 text-[16px] leading-relaxed text-muted-foreground">
              It watches Slack, organizes what your team knows, sets up meetings,
              triages issues, and answers first-line questions.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════ Band 4: Run any coding agent in its own sandbox ═══════════ */

export function BandSandbox() {
  return (
    <section className="flex min-h-[100dvh] snap-start items-center bg-muted/30 py-24 lg:py-32">
      <div className="mx-auto w-full max-w-[1120px] px-6">
        <div className="flex flex-col items-center gap-16 lg:flex-row lg:gap-20">
          {/* Left — illustration */}
          <div className="flex flex-1 items-center justify-center">
            <div className="relative">
              <div
                className="absolute -left-10 -top-10 size-[180px] rounded-full"
                style={{ backgroundColor: "#E89DA8" }}
              />
              <SandboxListCard />
            </div>
          </div>

          {/* Right — text */}
          <div className="lg:w-[420px] lg:shrink-0">
            <SectionLabel color="#E89DA8">For developers</SectionLabel>
            <SectionTitle>
              Run any coding agent in its own sandbox.
            </SectionTitle>
            <p className="mt-5 text-[16px] leading-relaxed text-muted-foreground">
              Claude Code, Codex, Bob, Pi. Run as many as you need, side by side.
            </p>
            <ul className="mt-6 space-y-3">
              <FeatureBullet>Docker and k3s inside</FeatureBullet>
              <FeatureBullet>Built-in web browser</FeatureBullet>
              <FeatureBullet>Workspace that persists</FeatureBullet>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureBullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-[15px] text-foreground">
      <svg
        width="18"
        height="18"
        viewBox="0 0 32 32"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <path
          d="M16 2a14 14 0 1 0 14 14A14 14 0 0 0 16 2Zm-2 19.59-5.3-5.3 1.42-1.42L14 18.75l7.88-7.88 1.42 1.42Z"
          className="fill-foreground"
        />
      </svg>
      {children}
    </li>
  );
}

function SandboxListCard() {
  return (
    <div className="relative z-10 w-[440px]">
      <div className={`${CARD} overflow-hidden`}>
        <div className="px-5 pb-2 pt-4">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Your sandboxes
          </span>
        </div>

        <div className="space-y-2 px-4 pb-4">
          <SandboxRow
            name="api-refactor"
            detail="Claude Code · Docker, k3s"
            status="running"
          />
          <SandboxRow
            name="flaky-tests"
            detail="Codex · browser"
            status="running"
          />
          <SandboxRow name="docs-site" detail="" status="running" />
          <SandboxRow name="auth-spike" detail="" status="idle" />
        </div>
      </div>
    </div>
  );
}

function SandboxRow({
  name,
  detail,
  status,
}: {
  name: string;
  detail: string;
  status: "running" | "idle";
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-input bg-background px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-foreground">
          {name}
        </p>
        {detail && (
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">
            {detail}
          </p>
        )}
      </div>
      <span
        className="inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs tracking-[0.338px]"
        style={
          status === "running"
            ? { backgroundColor: "#defbe6", color: "#15803d" }
            : { backgroundColor: "#edf5ff", color: "#0f62fe" }
        }
      >
        {status === "running" ? "Working" : "Idle"}
      </span>
    </div>
  );
}

/* ═══════ Band 5: Agents on your repos and clusters ═════════════════ */

export function BandDevOps() {
  return (
    <section className="flex min-h-[100dvh] snap-start items-center py-24 lg:py-32">
      <div className="mx-auto w-full max-w-[1120px] px-6">
        <div className="flex flex-col items-center gap-16 lg:flex-row lg:gap-20">
          {/* Left — text */}
          <div className="lg:w-[420px] lg:shrink-0">
            <SectionLabel color="#DE9950">For DevOps</SectionLabel>
            <SectionTitle>
              Agents on your repos
              <br />
              and clusters.
            </SectionTitle>
            <p className="mt-5 text-[16px] leading-relaxed text-muted-foreground">
              Code Guardian reviews every PR. A monitoring agent reads your cluster
              over kubectl and diagnoses what broke.
            </p>
            <p className="mt-4 text-[16px] font-semibold text-foreground">
              Your keys never reach the agent.
            </p>
          </div>

          {/* Right — illustration with orange half-moon */}
          <div className="flex flex-1 items-center justify-center">
            <div className="relative">
              <div
                className="absolute -right-12 -top-14"
                style={{ width: 460, height: 147 }}
                aria-hidden="true"
              >
                <svg
                  viewBox="933 1901 1616 516"
                  className="h-full w-full"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M933 1901C1075.54 2205.17 1384.28 2417 1741.93 2417C2099.83 2417 2406.59 2205.51 2549 1901H933Z"
                    fill="#DE9950"
                  />
                </svg>
              </div>
              <ClusterWatchCard />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClusterWatchCard() {
  return (
    <div className="relative z-10 w-full max-w-[440px] overflow-hidden rounded-xl border border-[#333] bg-[#1e1e1e] shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
      {/* Tab bar */}
      <div className="flex items-center gap-px border-b border-[#333] bg-[#252526]">
        <div className="flex items-center gap-2 bg-[#1e1e1e] px-4 py-2.5">
          <span className="text-[13px] font-medium text-[#d4d4d4]">
            cluster-watch
          </span>
        </div>
        <div className="ml-auto flex items-center gap-1.5 px-3 py-2.5">
          <div className="size-2 rounded-full bg-amber-500" />
          <span className="text-[11px] text-[#808080]">
            Investigating · prod-us-east
          </span>
        </div>
      </div>

      {/* Terminal content */}
      <div className="p-4 font-mono text-[12px] leading-[1.7] text-[#d4d4d4]">
        <p>
          <span className="text-[#6A9955]">$</span>{" "}
          <span className="text-[#dcdcaa]">kubectl</span> get pods -n checkout
        </p>
        <div className="mt-2">
          <div className="flex gap-4 text-[#808080]">
            <span className="w-[140px]">NAME</span>
            <span>STATUS</span>
          </div>
          <div className="flex gap-4">
            <span className="w-[140px] text-[#d4d4d4]">payments-72fx</span>
            <span className="text-[#f87171]">CrashLoopBackOff</span>
          </div>
        </div>

        {/* Diagnosis */}
        <div className="mt-4 rounded-md border border-[#333] bg-[#252526] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#808080]">
            Diagnosis
          </p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[#ccc]">
            The payments pod is OOM-killed. Current limit is 256Mi; the pod
            peaked at 420Mi after the price-calc migration.
          </p>
        </div>

        {/* Actions */}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="rounded-md border border-[#555] px-3 py-1.5 text-[12px] font-medium text-[#d4d4d4] transition-colors hover:bg-[#333]"
          >
            Raise limit to 512M
          </button>
          <button
            type="button"
            className="rounded-md bg-[#3b82f6] px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-[#2563eb]"
          >
            Open PR
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════ Band 6: Testimonials ═════════════════════════════════════ */

function testimonials(brandName: string) {
  return [
    {
      tag: "Code review across repos",
      role: "A four-person product dev team",
      quote:
        "We have now set up many scheduled PR code-guardian agents for many of our code repos. This was done just via natural language. No friction setting it up.",
    },
    {
      tag: "Fleet operations",
      role: "An infrastructure and operations lead",
      quote: `${brandName} is doing a fleet sweep for me for several of my clusters every morning, and I use it to bridge Slack requests to GitHub.`,
    },
    {
      tag: "Team knowledge base",
      role: "A compiler team",
      quote:
        "Immensely useful to have this agent on [our] Slack channels.",
    },
  ];
}

function useTestimonialCarousel() {
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(true);

  useEffect(() => {
    const id = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIdx((prev) => (prev + 1) % 3);
        setFade(true);
      }, 400);
    }, 12000);
    return () => clearInterval(id);
  }, []);

  const goTo = (i: number) => {
    setFade(false);
    setTimeout(() => {
      setIdx(i);
      setFade(true);
    }, 300);
  };

  return { idx, fade, goTo };
}

function CarouselDots({ count, idx, onSelect }: { count: number; idx: number; onSelect: (i: number) => void }) {
  return (
    <div className="mt-10 flex gap-2">
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          onClick={() => onSelect(i)}
          className={`h-1.5 rounded-full transition-all duration-300 ${
            i === idx
              ? "w-6 bg-foreground"
              : "w-1.5 bg-foreground/20 hover:bg-foreground/40"
          }`}
          aria-label={`Quote ${i + 1}`}
        />
      ))}
    </div>
  );
}

export function BandTestimonials({ brandName }: { brandName: string }) {
  const items = testimonials(brandName);
  const { idx, fade, goTo } = useTestimonialCarousel();
  const t = items[idx]!;

  return (
    <section className="flex min-h-[100dvh] snap-start flex-col justify-center overflow-hidden py-24 lg:py-32">
      <div className="mx-auto w-full max-w-[1120px] px-6">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <SectionLabel>From the community</SectionLabel>
            <SectionTitle>
              See how your colleagues
              <br />
              are using {brandName}.
            </SectionTitle>
            <p className="mt-4 max-w-md text-[16px] leading-relaxed text-muted-foreground">
              Real stories from teams running agents every day.
            </p>
          </div>

          <div className="flex flex-col items-center justify-center">
            <div
              className="min-h-[420px] w-full transition-opacity duration-400"
              style={{ opacity: fade ? 1 : 0 }}
            >
              <svg
                className="mb-6 size-10 text-foreground opacity-10"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z"
                  fill="currentColor"
                />
              </svg>
              <p className="text-[32px] font-normal leading-[1.5] text-foreground md:text-[42px]">
                {t.quote}
              </p>
              <div className="mt-6 flex items-center gap-3">
                <span className="text-[13px] font-medium text-muted-foreground">
                  {t.role}
                </span>
                <span className="text-muted-foreground">·</span>
                <span className="text-[13px] font-medium text-muted-foreground">
                  {t.tag}
                </span>
              </div>
            </div>
            <CarouselDots count={items.length} idx={idx} onSelect={goTo} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ═══════ Band 7: Hand off your first task ══════════════════════════ */

export function BandAccess({
  formEl,
  characters,
}: {
  formEl?: React.ReactNode;
  characters?: React.ReactNode;
}) {
  return (
    <section className="flex min-h-[100dvh] snap-start items-center bg-muted/30 py-20 lg:py-28">
      <div className="mx-auto w-full max-w-[1120px] px-6">
        <div className="flex items-start gap-12">
          <div className="flex-1">
            <SectionLabel>Get started</SectionLabel>
            <SectionTitle>Hand off your first task.</SectionTitle>

            {formEl && (
              <div className="mt-8 max-w-[var(--width-login-col)]">
                {formEl}
              </div>
            )}

            <p className="mt-6 text-[14px] leading-relaxed text-muted-foreground">
              <a
                href={LOGIN_DOCS_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent hover:underline"
              >
                Read the docs
              </a>
              {" · "}
              Questions? Ask in{" "}
              <span className="font-medium text-foreground">
                #dam-community
              </span>{" "}
              on Slack.
            </p>
          </div>

          {characters}
        </div>
      </div>
    </section>
  );
}
