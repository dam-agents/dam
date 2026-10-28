import {
  CloudApp,
  Dashboard,
  Launch,
  Locked,
  OverflowMenuVertical,
  Share,
} from "@carbon/icons-react";

import { WorkCardShell } from "../../modules/sessions/components/work-cards/work-card-shell.js";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </h2>
  );
}

type Visibility =
  | { kind: "private" }
  | { kind: "restricted"; count: number }
  | { kind: "public" };

function VisibilityLabel({ visibility }: { visibility: Visibility }) {
  if (visibility.kind === "private") {
    return (
      <>
        <Locked size={12} />
        Private
      </>
    );
  }
  if (visibility.kind === "restricted") {
    return (
      <>
        <Share size={12} />
        {visibility.count} people
      </>
    );
  }
  return (
    <>
      <Share size={12} />
      Public
    </>
  );
}

function CardDetail({
  label,
  visibility,
  expiry,
}: {
  label: string;
  visibility: Visibility;
  expiry?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      {label}
      <span className="mx-0.5">·</span>
      <VisibilityLabel visibility={visibility} />
      {expiry && (
        <>
          <span className="mx-0.5">·</span>
          {expiry}
        </>
      )}
    </span>
  );
}

function EnvTrailingIcon() {
  return (
    <span className="relative shrink-0">
      <Launch
        size={16}
        className="transition-opacity group-hover/card:opacity-0"
      />
      <OverflowMenuVertical
        size={16}
        className="absolute inset-0 opacity-0 transition-opacity group-hover/card:opacity-100"
      />
    </span>
  );
}

const ENV_CARDS: {
  label: string;
  expiry?: string;
  visibility: Visibility;
  expired?: boolean;
}[] = [
  {
    label: "Restricted with expiry",
    expiry: "Expires in 30 days",
    visibility: { kind: "restricted", count: 5 },
  },
  {
    label: "Restricted with expiry",
    expiry: "Expires in 7 days",
    visibility: { kind: "restricted", count: 3 },
  },
  {
    label: "Private with expiry",
    expiry: "Expires in 1 day",
    visibility: { kind: "private" },
  },
  {
    label: "Private expired",
    expiry: "Expired",
    visibility: { kind: "private" },
    expired: true,
  },
];

const ARTIFACT_CARDS: {
  title: string;
  kind: string;
  visibility: Visibility;
  expiry?: string;
}[] = [
  {
    title: "Landing page",
    kind: "HTML",
    visibility: { kind: "public" },
    expiry: "Expires in 14 days",
  },
  {
    title: "Dashboard component",
    kind: "JSX",
    visibility: { kind: "restricted", count: 3 },
    expiry: "Expires in 7 days",
  },
  {
    title: "API reference",
    kind: "Markdown",
    visibility: { kind: "restricted", count: 5 },
  },
  {
    title: "helper-utils.ts",
    kind: "Code",
    visibility: { kind: "private" },
    expiry: "Expires in 3 days",
  },
  {
    title: "Meeting notes",
    kind: "Text",
    visibility: { kind: "private" },
  },
  {
    title: "export.csv",
    kind: "File",
    visibility: { kind: "private" },
  },
];

export function WorkCardDesigns() {
  return (
    <div className="space-y-10">
      <div>
        <h1 className="mb-1 text-lg font-semibold text-foreground">
          Work Card Designs
        </h1>
        <p className="text-sm text-muted-foreground">
          Environment cards and artifact cards.
        </p>
      </div>

      <section>
        <SectionHeading>Environment Card</SectionHeading>
        <div className="space-y-2">
          {ENV_CARDS.map((card) => (
            <WorkCardShell
              key={card.label}
              icon={<CloudApp size={16} />}
              title={
                <>
                  csv-export-preview
                  <span
                    className={`ml-1.5 inline-block size-2 shrink-0 translate-y-[-0.5px] rounded-full align-middle ${card.expired ? "bg-[#697077]" : "bg-[#24a148] dark:bg-[#42be65]"}`}
                  />
                </>
              }
              detail={
                <CardDetail
                  label="Environment"
                  visibility={card.visibility}
                  expiry={card.expiry}
                />
              }
              trailingIcon={
                card.expired ? <Launch size={16} /> : <EnvTrailingIcon />
              }
              disabled={card.expired}
              onClick={() => {}}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionHeading>Artifact Card</SectionHeading>
        <div className="space-y-2">
          {ARTIFACT_CARDS.map((a) => (
            <WorkCardShell
              key={a.kind}
              icon={<Dashboard size={16} />}
              title={a.title}
              detail={
                <CardDetail
                  label={a.kind}
                  visibility={a.visibility}
                  expiry={a.expiry}
                />
              }
              onClick={() => {}}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
