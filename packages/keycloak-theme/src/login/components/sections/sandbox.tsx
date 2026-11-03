import type { ReactNode } from "react";

import {
  CARD,
  SectionLabel,
  SectionTitle,
  SHAPE_COLOR,
} from "./section-kit.js";

/* UNIT_BOUNDARY_DESCRIPTION: The "For developers" section: every coding agent
 * runs in its own sandbox, beside a list of sandboxes and their state. */
export function SandboxSection() {
  return (
    <section className="bg-section flex min-h-dvh snap-start items-center py-24 lg:py-32">
      <div className="mx-auto w-full max-w-[1120px] px-6">
        <div className="flex flex-col items-center gap-16 lg:flex-row lg:gap-20">
          <div className="flex flex-1 items-center justify-center">
            <div className="relative w-full max-w-[440px]">
              <div
                className="absolute -top-10 -left-10 size-[180px] rounded-full"
                style={{ backgroundColor: SHAPE_COLOR.pink }}
              />
              <SandboxListCard />
            </div>
          </div>

          <div className="lg:w-[420px] lg:shrink-0">
            <SectionLabel color={SHAPE_COLOR.pink}>For developers</SectionLabel>
            <SectionTitle>
              Run any coding agent in its own sandbox.
            </SectionTitle>
            <p className="text-muted-foreground mt-5 text-[16px] leading-relaxed">
              Claude Code, Codex, Bob, and Pi running side by side.
            </p>
            <ul className="mt-6 space-y-3">
              <FeatureBullet>Docker and k3s in every sandbox</FeatureBullet>
              <FeatureBullet>Built-in web browser</FeatureBullet>
              <FeatureBullet>Persistent workspaces</FeatureBullet>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureBullet({ children }: { children: ReactNode }) {
  return (
    <li className="text-foreground flex items-center gap-2 text-[15px]">
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
    <div className="relative z-10 w-full" aria-hidden="true">
      <div className={`${CARD} overflow-hidden`}>
        <div className="px-5 pt-4 pb-2">
          <span className="text-muted-foreground text-[11px] font-semibold tracking-[0.1em] uppercase">
            Your sandboxes
          </span>
        </div>
        <div className="space-y-2 px-4 pb-4">
          <SandboxRow
            name="api-refactor"
            detail="Claude Code · Docker, k3s"
            working
          />
          <SandboxRow name="flaky-tests" detail="Codex · browser" working />
          <SandboxRow name="docs-site" working />
          <SandboxRow name="auth-spike" />
        </div>
      </div>
    </div>
  );
}

function SandboxRow({
  name,
  detail,
  working = false,
}: {
  name: string;
  detail?: string;
  working?: boolean;
}) {
  return (
    <div className="border-input bg-background flex items-center justify-between rounded-lg border px-4 py-3">
      <div className="min-w-0">
        <p className="text-foreground truncate text-[15px] font-semibold">
          {name}
        </p>
        {detail && (
          <p className="text-muted-foreground mt-0.5 truncate text-[13px]">
            {detail}
          </p>
        )}
      </div>
      <span
        className={
          working
            ? "inline-flex shrink-0 items-center rounded-full bg-[#defbe6] px-2.5 py-0.5 text-xs tracking-[0.338px] text-[#15803d] dark:bg-green-950 dark:text-green-300"
            : "inline-flex shrink-0 items-center rounded-full bg-[#edf5ff] px-2.5 py-0.5 text-xs tracking-[0.338px] text-[#0f62fe] dark:bg-blue-950 dark:text-blue-300"
        }
      >
        {working ? "Working" : "Idle"}
      </span>
    </div>
  );
}
