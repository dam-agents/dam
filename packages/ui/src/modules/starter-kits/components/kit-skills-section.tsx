import { Launch } from "@carbon/icons-react";
import type { StarterKitView } from "api-server-api";

import { Badge } from "@/components/ui/badge";
import { FIELD_INSET } from "@/components/ui/inset";
import { SectionLabel } from "@/components/ui/section-label";
import { cn } from "@/lib/utils";

import { ClampedText } from "./clamped-text.js";

interface Props {
  kit: StarterKitView;
}

function SourceCard({
  title,
  subtitle,
  count,
  href,
  children,
}: {
  title: string;
  subtitle: string;
  count: string;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-kit-line bg-kit-surface">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {title}
            </span>
            <span className="text-sm text-muted-foreground">{count}</span>
            <Badge variant="kit" size="sm">
              Starter Kit
            </Badge>
          </div>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground">
            {subtitle}
          </p>
        </div>
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open ${title}`}
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
          >
            <Launch size={16} />
          </a>
        )}
      </div>
      <ul className="border-t border-kit-rule">{children}</ul>
    </div>
  );
}

export function KitSkillsSection({ kit }: Props) {
  const bundled = kit.skillsInKit;
  const external = kit.skills;
  if (bundled.length === 0 && external.length === 0) return null;

  return (
    <section className="mb-8">
      <SectionLabel spaced>Skills</SectionLabel>

      <div className={cn(FIELD_INSET, "flex flex-col gap-3")}>
        {bundled.length > 0 && kit.bundledSkills && (
          <SourceCard
            title={kit.id}
            subtitle={`${kit.seed?.url.replace("https://github.com/", "") ?? "the kit"} · /${kit.bundledSkills.path}`}
            count={`${bundled.length} in the definition`}
            {...(kit.seed?.url ? { href: kit.seed.url } : {})}
          >
            {bundled.map((skill) => (
              <li
                key={skill.name}
                className="border-b border-kit-rule px-4 py-2.5 last:border-b-0"
              >
                <p className="text-sm text-foreground">{skill.name}</p>
                {skill.description && (
                  <ClampedText
                    text={skill.description}
                    className="mt-0.5 text-sm text-muted-foreground"
                  />
                )}
              </li>
            ))}
          </SourceCard>
        )}

        {external.length > 0 && (
          <SourceCard
            title="External skills"
            subtitle="installed when the agent is created"
            count={`${external.length}`}
          >
            {external.map((skill) => (
              <li
                key={`${skill.source}:${skill.name}`}
                className="border-b border-kit-rule px-4 py-2.5 last:border-b-0"
              >
                <p className="text-sm text-foreground">{skill.name}</p>
                <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {skill.source}
                </p>
              </li>
            ))}
          </SourceCard>
        )}
      </div>

      <p className={cn(FIELD_INSET, "mt-3 text-sm text-muted-foreground")}>
        Skills in the definition arrive with the repository the agent clones and
        are discovered as files — the platform installs nothing for them, so
        they cannot be switched off here.
      </p>
    </section>
  );
}
