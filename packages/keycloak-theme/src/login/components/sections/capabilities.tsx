import type { ReactNode } from "react";

import {
  ExternalLink,
  SectionLabel,
  SectionTitle,
  SHAPE_COLOR,
} from "./section-kit.js";

const SCENE_CARD =
  "absolute rounded-lg border border-input bg-background shadow-[0_4px_24px_rgba(56,56,56,0.08)]";

const ACCENT = { indigo: "#7584fe", purple: "#af6af2" } as const;

/* UNIT_BOUNDARY_DESCRIPTION: The "What is <brand>?" section: what an agent is,
 * beside the stack character surrounded by cards for its schedules, files,
 * connections, skills, knowledge and artifacts. The card group is drawn at a
 * fixed 820 x 700 px and zoomed down on narrow screens so it keeps its layout. */
export function CapabilitiesSection({
  brand,
  docsUrl,
}: {
  brand: string;
  docsUrl: string;
}) {
  return (
    <section className="bg-section relative min-h-dvh snap-start overflow-x-clip">
      <div className="flex min-h-dvh items-center">
        <div className="mx-auto w-full max-w-[1120px] px-6">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div>
              <SectionLabel>What is {brand}?</SectionLabel>
              <SectionTitle>Agents that work like teammates</SectionTitle>
              <p className="text-muted-foreground mt-5 max-w-md text-[16px] leading-relaxed">
                {brand} is IBM Research&rsquo;s solution for safely running
                long-lived agents. Agents use the same tools as your team,
                remember what you&rsquo;ve taught them, and keep working after
                you log off. Hand off work to agents that run on schedules in
                isolated sandboxes even after your laptop closes.
              </p>
              {docsUrl && (
                <ExternalLink
                  href={docsUrl}
                  className="text-accent mt-3 inline-block text-[16px] hover:underline"
                >
                  Read the docs
                </ExternalLink>
              )}
            </div>

            <div className="relative -order-1 min-h-[400px] lg:order-none lg:min-h-[660px]">
              <div className="absolute inset-0 flex items-center justify-center lg:static">
                <div className="origin-center [zoom:0.46] min-[430px]:[zoom:0.53] sm:[zoom:0.65] lg:[zoom:1]">
                  <div className="relative" style={{ width: 820, height: 700 }}>
                    <div
                      className="absolute top-1/2 left-1/2"
                      style={{ transform: "translate(-50%, -50%)" }}
                    >
                      <StackCharacter />
                    </div>
                    <Orbit transform="translate(-180px, -190px) scale(0.73) rotate(-2deg)">
                      <SchedulesScene />
                    </Orbit>
                    <Orbit transform="translate(65px, -195px) scale(0.75) rotate(1.5deg)">
                      <FilesScene />
                    </Orbit>
                    <Orbit transform="translate(-305px, -10px) scale(0.71) rotate(1deg)">
                      <ConnectionsScene />
                    </Orbit>
                    <Orbit transform="translate(140px, 10px) scale(0.74) rotate(-1.5deg)">
                      <SkillsScene />
                    </Orbit>
                    <Orbit transform="translate(-200px, 180px) scale(0.72) rotate(2deg)">
                      <KnowledgeScene />
                    </Orbit>
                    <Orbit transform="translate(90px, 190px) scale(0.73) rotate(-1deg)">
                      <ArtifactsScene />
                    </Orbit>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Orbit({
  transform,
  children,
}: {
  transform: string;
  children: ReactNode;
}) {
  return (
    <div
      className="absolute top-1/2 left-1/2"
      style={{ transform: `translate(-50%, -50%) ${transform}` }}
    >
      {children}
    </div>
  );
}

function StackCharacter() {
  return (
    <div className="group relative z-10 cursor-pointer overflow-visible">
      <div className="stack-character overflow-visible">
        <svg
          viewBox="850 350 1800 2800"
          fill="none"
          className="h-[150px] w-auto overflow-visible"
          aria-hidden="true"
        >
          <g className="stack-character-eyes">
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M1391.43 447C1253.67 447 1142 558.7 1142 696.5C1142 834.3 1253.67 946 1391.43 946C1529.18 946 1640.84 834.3 1640.84 696.5C1640.84 558.7 1529.18 447 1391.43 447Z"
              fill={SHAPE_COLOR.pink}
            />
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M2094.25 447C1956.52 447 1844.84 558.7 1844.84 696.5C1844.84 834.3 1956.52 946 2094.25 946C2232 946 2343.67 834.3 2343.67 696.5C2343.67 558.7 2232 447 2094.25 447Z"
              fill={SHAPE_COLOR.pink}
            />
          </g>
          <rect
            x="935"
            y="1125"
            width="1616"
            height="489.42"
            fill={SHAPE_COLOR.blue}
          />
          <rect
            x="935"
            y="1837.52"
            width="1616"
            height="489.41"
            fill={SHAPE_COLOR.blue}
          />
          <rect
            x="935"
            y="2550.04"
            width="1616"
            height="489.41"
            fill={SHAPE_COLOR.blue}
          />
        </svg>
      </div>
    </div>
  );
}

function SceneCanvas({
  w,
  h,
  children,
}: {
  w: number;
  h: number;
  children: ReactNode;
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

function SceneTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground text-[11px] font-semibold tracking-[0.1em] uppercase">
      {children}
    </p>
  );
}

function ToggleRow({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <p className="text-foreground text-[14px] leading-tight font-medium">
        {label}
      </p>
      <div
        className={`flex h-4 w-7 items-center rounded-full px-0.5 ${on ? "bg-foreground" : "bg-input"}`}
      >
        <div
          className="bg-background size-3 rounded-full transition-transform"
          style={{ transform: on ? "translateX(12px)" : "translateX(0)" }}
        />
      </div>
    </div>
  );
}

function SchedulesScene() {
  return (
    <SceneCanvas w={280} h={190}>
      <div
        className={`${SCENE_CARD} top-[10px] left-[12px] w-[210px] px-3 py-2.5`}
      >
        <SceneTitle>Schedules</SceneTitle>
        <div className="mt-2 space-y-0.5">
          <ToggleRow label="Daily review" on />
          <ToggleRow label="Nightly audit" on />
          <ToggleRow label="Weekly sync" on={false} />
        </div>
      </div>
    </SceneCanvas>
  );
}

function SkillsScene() {
  return (
    <SceneCanvas w={280} h={190}>
      <div
        className={`${SCENE_CARD} top-[10px] left-[12px] w-[210px] px-3 py-2.5`}
      >
        <SceneTitle>Skills</SceneTitle>
        <div className="mt-2 space-y-0.5">
          <ToggleRow label="Code review" on />
          <ToggleRow label="Plan feature" on />
          <ToggleRow label="Write tests" on={false} />
        </div>
      </div>
    </SceneCanvas>
  );
}

function FolderIcon({ stroke = "currentColor" }: { stroke?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 4a1 1 0 011-1h3.5l1.5 1.5H13a1 1 0 011 1V12a1 1 0 01-1 1H3a1 1 0 01-1-1V4z"
        stroke={stroke}
        strokeWidth="1.2"
      />
    </svg>
  );
}

function FileRow({ name, folder }: { name: string; folder?: boolean }) {
  return (
    <div className="text-muted-foreground flex items-center gap-1.5 text-[14px]">
      {folder ? (
        <FolderIcon />
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

function FilesScene() {
  return (
    <SceneCanvas w={280} h={200}>
      <div
        className={`${SCENE_CARD} top-[10px] left-[12px] w-[210px] px-3 py-2.5`}
      >
        <SceneTitle>Files</SceneTitle>
        <div className="mt-2 flex items-center gap-1.5">
          <FolderIcon stroke={ACCENT.indigo} />
          <span className="text-foreground text-[14px] font-medium">
            workspace
          </span>
        </div>
        <div className="border-input mt-1.5 ml-4 space-y-1 border-l pl-3">
          <FileRow name="config.yaml" />
          <FileRow name="memory.md" />
          <FileRow name="output/" folder />
        </div>
      </div>
      <div
        className={`${SCENE_CARD} top-[140px] left-[44px] flex items-center gap-1.5 px-2.5 py-1.5`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="7" fill="#24A148" />
          <path
            d="M5 8l2 2 4-4"
            stroke="#fff"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="text-foreground text-[14px] font-medium">
          Persistent
        </span>
      </div>
    </SceneCanvas>
  );
}

function ConnectionRow({ name, icon }: { name: string; icon: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-foreground text-[14px] font-medium">{name}</span>
      </div>
      <div className="size-2 rounded-full bg-emerald-500" />
    </div>
  );
}

function ConnectionsScene() {
  return (
    <SceneCanvas w={280} h={210}>
      <div
        className={`${SCENE_CARD} top-[10px] left-[12px] w-[210px] px-3 py-2.5`}
      >
        <SceneTitle>Connections</SceneTitle>
        <div className="mt-2 space-y-0.5">
          <ConnectionRow
            name="GitHub"
            icon={
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"
                  fill="currentColor"
                  className="text-foreground"
                />
              </svg>
            }
          />
          <ConnectionRow
            name="Slack"
            icon={
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M3.36 10.08a1.68 1.68 0 11-1.68-1.68h1.68v1.68zm.84 0a1.68 1.68 0 113.36 0v4.2a1.68 1.68 0 11-3.36 0v-4.2z"
                  fill="#E01E5A"
                />
                <path
                  d="M5.88 3.36a1.68 1.68 0 111.68-1.68v1.68H5.88zm0 .84a1.68 1.68 0 110 3.36h-4.2a1.68 1.68 0 110-3.36h4.2z"
                  fill="#36C5F0"
                />
                <path
                  d="M12.6 5.88a1.68 1.68 0 111.68 1.68H12.6V5.88zm-.84 0a1.68 1.68 0 11-3.36 0v-4.2a1.68 1.68 0 113.36 0v4.2z"
                  fill="#2EB67D"
                />
                <path
                  d="M10.08 12.6a1.68 1.68 0 11-1.68 1.68V12.6h1.68zm0-.84a1.68 1.68 0 110-3.36h4.2a1.68 1.68 0 110 3.36h-4.2z"
                  fill="#ECB22E"
                />
              </svg>
            }
          />
          <ConnectionRow
            name="Kubernetes"
            icon={
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M8 1l6.06 3.5v7L8 15l-6.06-3.5v-7L8 1z"
                  stroke="#326CE5"
                  strokeWidth="1.1"
                />
                <circle
                  cx="8"
                  cy="8"
                  r="2.5"
                  stroke="#326CE5"
                  strokeWidth="1.1"
                />
              </svg>
            }
          />
        </div>
      </div>
    </SceneCanvas>
  );
}

function KnowledgeScene() {
  return (
    <SceneCanvas w={280} h={190}>
      <div
        className={`${SCENE_CARD} top-[10px] left-[12px] w-[210px] px-3 py-2.5`}
      >
        <SceneTitle>Knowledge</SceneTitle>
        <div className="mt-2 flex items-center gap-2">
          <FolderIcon />
          <span className="text-foreground text-[14px] font-semibold">
            Product docs
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-[14px]">12 sources</p>
      </div>
    </SceneCanvas>
  );
}

function ArtifactsScene() {
  return (
    <SceneCanvas w={280} h={210}>
      <div
        className={`${SCENE_CARD} top-[10px] left-[12px] w-[210px] px-3 py-2.5`}
      >
        <SceneTitle>Artifacts</SceneTitle>
        <div className="mt-2 flex items-center gap-2">
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
          >
            <rect
              x="2"
              y="2"
              width="12"
              height="12"
              rx="2"
              stroke={ACCENT.purple}
              strokeWidth="1.2"
            />
            <path
              d="M5 6h6M5 9h4"
              stroke={ACCENT.purple}
              strokeWidth="1.2"
              strokeLinecap="round"
            />
          </svg>
          <span className="text-foreground text-[14px] font-semibold">
            Q3 sprint review
          </span>
        </div>
        <p className="text-muted-foreground mt-1 text-[13px]">
          8 views · 2h ago
        </p>
      </div>
      <div
        className={`${SCENE_CARD} top-[124px] left-[12px] flex w-[195px] items-center gap-1.5 px-2.5 py-1.5`}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
          className="text-muted-foreground"
        >
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M2.5 8h11M8 2.5c-1.5 2-2.5 3.5-2.5 5.5s1 3.5 2.5 5.5M8 2.5c1.5 2 2.5 3.5 2.5 5.5s-1 3.5-2.5 5.5"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
        <span className="text-foreground text-[13px] font-medium whitespace-nowrap">
          Shared via link
        </span>
      </div>
    </SceneCanvas>
  );
}
