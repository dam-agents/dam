import { SlackTeamIllustration } from "../slack-team-illustration.js";
import { SectionLabel, SectionTitle, SHAPE_COLOR } from "./section-kit.js";

/* UNIT_BOUNDARY_DESCRIPTION: The "For everyone on the team" section: agents
 * work in Slack, GitHub, the terminal and the editor, beside an illustration
 * of a team thread in Slack. From lg up the illustration fills the right half;
 * below, it sits above the text, zoomed to fit. */
export function ChannelsSection({ brand }: { brand: string }) {
  return (
    <section className="relative min-h-dvh snap-start overflow-hidden">
      <div className="absolute inset-y-0 right-0 z-10 hidden w-1/2 items-center lg:flex">
        <svg
          className="absolute top-[38%] right-[5%] -translate-y-1/2"
          width="300"
          height="500"
          viewBox="83 14 26 44"
          fill="none"
          aria-hidden
        >
          <path
            d="M88.32 39.20L108.71 57.14L108.72 29.25C108.63 24.26 106.21 18.62 99.75 16.58C93.04 14.47 85.81 18.22 83.69 24.93C81.90 30.62 84.20 35.53 88.32 39.20Z"
            fill={SHAPE_COLOR.green}
          />
        </svg>
        <div className="relative z-10 -ml-[8%] w-[140%] max-w-[860px] pr-10">
          <SlackTeamIllustration brand={brand} />
        </div>
      </div>
      <div className="bg-background absolute inset-y-0 left-0 hidden w-1/2 lg:block" />

      <div className="bg-background relative z-20 flex min-h-dvh flex-col items-center lg:flex-row lg:bg-transparent">
        <div className="w-full px-4 pt-20 lg:hidden">
          <div
            className="mx-auto [zoom:0.5] min-[430px]:[zoom:0.58] sm:[zoom:0.89] md:[zoom:1]"
            style={{ width: 680 }}
          >
            <SlackTeamIllustration brand={brand} />
          </div>
        </div>
        <div className="mx-auto w-full max-w-[540px] px-6 pt-8 pb-20 lg:mx-0 lg:flex lg:w-1/2 lg:max-w-none lg:items-center lg:justify-center lg:py-28">
          <div className="w-full max-w-[460px]">
            <SectionLabel color={SHAPE_COLOR.green}>
              For everyone on the team
            </SectionLabel>
            <SectionTitle>Agents that work where your team works</SectionTitle>
            <p className="text-muted-foreground mt-5 text-[16px] leading-relaxed">
              Agents live in Slack where they can monitor channels, answer
              questions, triage issues, schedule meetings, and organize your
              team&rsquo;s knowledge.
            </p>
            <p className="text-muted-foreground mt-3 text-[16px] leading-relaxed">
              Agents can also live in GitHub, your terminal, and your editor.
              Bring agents to where your work lives.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
