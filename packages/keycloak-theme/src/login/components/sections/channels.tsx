import { ChannelsBgShapes } from "../hero-bg-shapes.js";
import { ScaledStage } from "../scaled-stage.js";
import { SlackTeamIllustration } from "../slack-team-illustration.js";
import { SectionLabel, SectionTitle, SHAPE_COLOR } from "./section-kit.js";

/* UNIT_BOUNDARY_DESCRIPTION: The "For everyone on the team" section: agents
 * work in Slack, GitHub, the terminal and the editor, beside an illustration
 * of a team thread in Slack framed by a green wing, drawn at the design's
 * 820 x 520 px and scaled as one. From lg up it fills the right half; below,
 * it sits above the text. */
export function ChannelsSection({ brand }: { brand: string }) {
  return (
    <section className="relative min-h-dvh snap-start overflow-hidden">
      <div className="absolute inset-y-0 right-0 z-10 hidden w-1/2 items-center lg:flex">
        <div className="-ml-[8%] w-[140%] max-w-[860px] pr-10">
          <TeamStage brand={brand} />
        </div>
      </div>
      <div className="bg-background absolute inset-y-0 left-0 hidden w-1/2 lg:block" />

      <div className="bg-background relative z-20 flex min-h-dvh flex-col items-center lg:flex-row lg:bg-transparent">
        <div className="w-full px-6 pt-24 pb-6 lg:hidden">
          <div className="mx-auto max-w-[680px] pr-[8%]">
            <TeamStage brand={brand} />
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

function TeamStage({ brand }: { brand: string }) {
  return (
    <ScaledStage width={820} height={520}>
      <ChannelsBgShapes />
      <div className="relative h-full">
        <SlackTeamIllustration brand={brand} />
      </div>
    </ScaledStage>
  );
}
