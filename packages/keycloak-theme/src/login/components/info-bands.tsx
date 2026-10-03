import { FaqAccordion } from "./faq-accordion.js";
import {
  IllustrationAsk,
  IllustrationChannels,
  IllustrationCodeReview,
  IllustrationMonitor,
  IllustrationResult,
  IllustrationSchedule,
  IllustrationWebApp,
} from "./illustrations.js";

const LOGIN_DOCS_URL = "https://ibm.biz/dam-docs";

function BandHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-medium uppercase tracking-[1.65px] text-muted-foreground">
      {children}
    </h2>
  );
}

function BandTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 text-[20px] font-semibold leading-snug tracking-[-0.3px] text-foreground md:text-[24px]">
      {children}
    </p>
  );
}

/** Band 1 — What people hand to an agent */
export function BandJobs() {
  return (
    <section className="space-y-8" aria-labelledby="band-jobs-heading">
      <div>
        <BandHeading>What people hand over</BandHeading>
        <BandTitle>Real tasks, running on a schedule or on demand</BandTitle>
      </div>

      <div className="space-y-6">
        <JobCard
          title="Review pull requests"
          when="Every time a PR opens"
          illustration={<IllustrationCodeReview />}
        />
        <JobCard
          title="Build and deploy a web app"
          when="When you push to main"
          illustration={<IllustrationWebApp />}
        />
        <JobCard
          title="Monitor for broken links"
          when="Every morning at 9 AM"
          illustration={<IllustrationMonitor />}
        />
      </div>
    </section>
  );
}

function JobCard({
  title,
  when,
  illustration,
}: {
  title: string;
  when: string;
  illustration: React.ReactNode;
}) {
  return (
    <div className="flex gap-5">
      <div className="w-[120px] shrink-0 md:w-[140px]">{illustration}</div>
      <div className="flex flex-col justify-center">
        <p className="text-[15px] font-semibold leading-snug text-foreground">
          {title}
        </p>
        <p className="mt-1 text-[14px] leading-snug text-muted-foreground">
          {when}
        </p>
      </div>
    </div>
  );
}

/** Band 2 — The loop: ask → schedule → runs and reports back */
export function BandLoop() {
  return (
    <section className="space-y-8" aria-labelledby="band-loop-heading">
      <div>
        <BandHeading>How it works</BandHeading>
        <BandTitle>Ask once. It keeps going.</BandTitle>
      </div>

      <div className="space-y-8">
        <LoopBeat
          step="1"
          label="Ask in Slack"
          body="Tell your agent what to do — in a message, the same way you'd ask a teammate."
          illustration={<IllustrationAsk />}
        />
        <LoopBeat
          step="2"
          label="A schedule appears"
          body="The agent turns your request into a recurring schedule. No cron syntax, no config files."
          illustration={<IllustrationSchedule />}
        />
        <LoopBeat
          step="3"
          label="Results come back to you"
          body="The agent runs at that time and posts what it found — right back in the same channel."
          illustration={<IllustrationResult />}
        />
      </div>
    </section>
  );
}

function LoopBeat({
  step,
  label,
  body,
  illustration,
}: {
  step: string;
  label: string;
  body: string;
  illustration: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground">
          {step}
        </span>
        <p className="text-[15px] font-semibold leading-snug text-foreground">
          {label}
        </p>
      </div>
      <p className="ml-9 text-[14px] leading-relaxed text-muted-foreground">
        {body}
      </p>
      <div className="ml-9 max-w-[320px]">{illustration}</div>
    </div>
  );
}

/** Band 3 — Where your agent lives */
export function BandChannels() {
  return (
    <section className="space-y-6" aria-labelledby="band-channels-heading">
      <div>
        <BandHeading>Where your agent lives</BandHeading>
        <BandTitle>Here, in Slack, or in Telegram</BandTitle>
      </div>
      <p className="text-[15px] leading-relaxed text-muted-foreground">
        Talk to your agent in the platform chat, or connect it to a Slack or
        Telegram channel so your whole team can use it where they already work.
      </p>
      <div className="max-w-[400px]">
        <IllustrationChannels />
      </div>
    </section>
  );
}

/** Band 4 — FAQ */
export function BandFaq() {
  return (
    <section className="space-y-6" aria-labelledby="band-faq-heading">
      <div>
        <BandHeading>Common questions</BandHeading>
      </div>
      <FaqAccordion />
    </section>
  );
}

/** Band 5 — Getting access */
export function BandAccess({
  requestAccessUrl,
}: {
  requestAccessUrl: string | undefined;
}) {
  return (
    <section className="space-y-4" aria-labelledby="band-access-heading">
      <div>
        <BandHeading>Get started</BandHeading>
        <BandTitle>Available to IBM Research teams</BandTitle>
      </div>
      <p className="text-[15px] leading-relaxed text-muted-foreground">
        Sign in above if you already have access. Otherwise, request access and
        your team admin will be notified.
      </p>
      <div className="flex flex-wrap gap-4">
        {requestAccessUrl && (
          <a
            href={requestAccessUrl}
            className="inline-flex h-11 items-center justify-center rounded-md border border-input bg-background px-6 text-[15px] font-medium text-foreground hover:bg-muted"
          >
            Request access
          </a>
        )}
        <a
          href={LOGIN_DOCS_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-11 items-center text-[15px] text-accent hover:underline"
        >
          Read the docs
        </a>
      </div>
      <p className="text-[14px] leading-relaxed text-muted-foreground">
        Questions? Ask in{" "}
        <span className="font-medium text-foreground">#dam-community</span> on
        Slack.
      </p>
    </section>
  );
}
