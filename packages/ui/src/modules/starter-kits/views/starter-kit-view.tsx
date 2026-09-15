import { ArrowLeft, Launch } from "@carbon/icons-react";
import type { ConnectionTemplateView, StarterKitView } from "api-server-api";
import { useMemo } from "react";

import {
  DialogBody,
  DialogFooter,
  DialogHeader,
  Modal,
} from "@/components/modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { SectionLabel } from "@/components/ui/section-label";

import { ListSkeleton } from "../../../components/list-skeleton.js";
import { useStore } from "../../../store.js";
import { useBudgetReserved } from "../../budgets/api/queries.js";
import {
  formatSizeLabel,
  sizeInMi,
  slotsFor,
  slotUnitOf,
} from "../../budgets/lib/slots.js";
import { useConnectionTemplates } from "../../connections/api/queries.js";
import { ConnectionIcon } from "../../connections/components/connection-icon.js";
import { useStarterKit } from "../api/queries.js";
import { kitIcon } from "../lib/kit-icon.js";
import {
  describeAccepts,
  harnessesLine,
  kitScheduleCadence,
} from "../lib/setup.js";

const CATEGORY_LABEL: Record<StarterKitView["category"], string> = {
  knowledge: "Knowledge",
  software: "Software",
  productivity: "Productivity",
  research: "Research",
};

type TemplateIndex = ReadonlyMap<string, ConnectionTemplateView>;

function acceptedTemplates(
  accepts: readonly string[],
  templates: readonly ConnectionTemplateView[],
): ConnectionTemplateView[] {
  return templates.filter(
    (t) =>
      accepts.includes(t.id) || (t.family && accepts.includes(t.family.id)),
  );
}

function Row({
  icons,
  title,
  detail,
  trailing,
}: {
  icons?: string[];
  title: string;
  detail?: string;
  trailing?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      {icons && icons.length > 0 && (
        <div className="flex shrink-0 items-center justify-center gap-1 rounded-lg border border-border px-2 py-2">
          {icons.slice(0, 3).map((slug) => (
            <ConnectionIcon
              key={slug}
              iconSlug={slug}
              alt=""
              size={16}
              className="text-foreground/80"
            />
          ))}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {detail && (
          <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
        )}
      </div>
      {trailing}
    </li>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <SectionLabel spaced>{label}</SectionLabel>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

export function StarterKitDetailView() {
  const catalog = useStore((s) => s.starterKitCatalog);
  const kitId = useStore((s) => s.starterKitId);
  const kit = useStarterKit(catalog, kitId);
  const setView = useStore((s) => s.setView);

  if (kit.isPending)
    return (
      <Modal widthClass="w-[600px]" onClose={() => setView("starter-kits")}>
        <DialogBody>
          <ListSkeleton rows={4} rowHeight={72} />
        </DialogBody>
      </Modal>
    );
  if (kit.isError || kit.data === undefined) {
    return (
      <Modal widthClass="w-[600px]" onClose={() => setView("starter-kits")}>
        <DialogBody>
          <Callout tone="danger">
            <p className="text-sm text-foreground">
              Couldn&apos;t load this starter kit. It may have been removed from
              the catalog, or the catalog is unreachable.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void kit.refetch()}
              >
                Retry
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setView("starter-kits")}
              >
                All kits
              </Button>
            </div>
          </Callout>
        </DialogBody>
      </Modal>
    );
  }
  return <KitDetail kit={kit.data} />;
}

function KitDetail({ kit }: { kit: StarterKitView }) {
  const KitIcon = kitIcon(kit);
  const setView = useStore((s) => s.setView);
  const navigateToStarterKitSetup = useStore(
    (s) => s.navigateToStarterKitSetup,
  );
  const templates = useConnectionTemplates();
  const budget = useBudgetReserved();

  const templateById: TemplateIndex = useMemo(
    () => new Map((templates.data ?? []).map((t) => [t.id, t])),
    [templates.data],
  );

  const size = useMemo(() => {
    if (!kit.resources || !budget.data) return null;
    const unit = slotUnitOf(budget.data);
    const mi = sizeInMi(kit.resources);
    if (mi.cpuMilli === 0 && mi.memoryMi === 0) return null;
    return { slots: slotsFor(mi, unit), label: formatSizeLabel(mi, unit) };
  }, [kit.resources, budget.data]);

  const skillCount = kit.skillsInKit.length + kit.skills.length;

  const close = () => setView("starter-kits");

  return (
    <Modal widthClass="w-[600px]" onClose={close}>
      <DialogHeader
        title={kit.name}
        titleAccessory={
          <Badge variant="kit">{CATEGORY_LABEL[kit.category]}</Badge>
        }
        subtitle={kit.description}
        onClose={close}
      >
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md border border-border text-muted-foreground">
            <KitIcon size={14} />
          </span>
          {kit.connections.flatMap((req) =>
            acceptedTemplates(req.accepts, templates.data ?? [])
              .flatMap((t) => (t.family ? [t.family] : []))
              .filter((f, i, all) => all.findIndex((x) => x.id === f.id) === i)
              .map((family) => (
                <Badge key={family.id} variant="muted" size="sm">
                  {family.title}
                </Badge>
              )),
          )}
          {skillCount > 0 && (
            <Badge variant="muted" size="sm">
              {skillCount} {skillCount === 1 ? "skill" : "skills"}
            </Badge>
          )}
        </div>
      </DialogHeader>

      <DialogBody>
        <h2 className="mb-3 text-base font-semibold text-foreground">
          Included
        </h2>

        {skillCount > 0 && (
          <Section label="Skills">
            {kit.skillsInKit.map((skill) => (
              <Row
                key={`in-kit:${skill.name}`}
                title={skill.name}
                detail={skill.description}
                trailing={
                  <Badge variant="muted" size="sm">
                    in the kit
                  </Badge>
                }
              />
            ))}
            {kit.skills.map((skill) => (
              <Row
                key={`external:${skill.source}`}
                title={skill.name}
                detail={skill.source}
                trailing={
                  <Badge variant="muted" size="sm">
                    installed at create
                  </Badge>
                }
              />
            ))}
          </Section>
        )}

        {kit.image && (
          <Section label="Framework">
            <Row
              title={kit.name}
              detail={kit.image.ref}
              trailing={
                <Badge variant="muted" size="sm">
                  brings its own agent
                </Badge>
              }
            />
          </Section>
        )}

        {kit.schedules.length > 0 && (
          <Section label="Schedules">
            {kit.schedules.map((schedule) => (
              <Row
                key={schedule.name}
                title={schedule.name}
                detail={kitScheduleCadence(schedule)}
                trailing={
                  <Badge variant="muted" size="sm">
                    {schedule.enabled ? "on" : "off"}
                  </Badge>
                }
              />
            ))}
            <li className="text-sm text-muted-foreground">
              Created on the new agent. They stay held until onboarding is
              finished, so nothing runs against a half-configured agent.
            </li>
          </Section>
        )}

        {kit.seed && (
          <Section label="Definition">
            <Row
              title={kit.seed.url.replace("https://github.com/", "")}
              detail={`Cloned by the agent during onboarding${kit.seed.ref ? ` at ${kit.seed.ref}` : ""}`}
              trailing={
                <a
                  href={kit.seed.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label="Open the definition repository"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <Launch size={16} />
                </a>
              }
            />
          </Section>
        )}

        {size && size.slots > 1 && (
          <Section label="Compute resources">
            <Row
              title={size.label}
              detail={
                kit.resources?.storage
                  ? `${kit.resources.storage} disk. ${kit.resources.note ?? ""}`.trim()
                  : kit.resources?.note
              }
              trailing={
                <Badge variant="muted" size="sm">
                  {size.slots} slots
                </Badge>
              }
            />
            <li className="text-sm text-muted-foreground">
              This kit asks for more than one slot of your compute ceiling. CPU
              and memory stay editable on the agent; disk is fixed at create.
            </li>
          </Section>
        )}

        <h2 className="mb-3 mt-8 text-base font-semibold text-foreground">
          You&apos;ll set up
        </h2>

        {kit.connections.length > 0 && (
          <Section label="Connections">
            {kit.connections.map((req) => (
              <Row
                key={req.accepts.join("|")}
                icons={acceptedTemplates(req.accepts, templates.data ?? [])
                  .map((t) => t.iconSlug)
                  .filter((slug): slug is string => slug !== undefined)
                  .filter((slug, i, all) => all.indexOf(slug) === i)}
                title={describeAccepts(req.accepts, templateById)}
                detail={req.note}
                trailing={
                  <Badge
                    variant={req.required ? "template" : "muted"}
                    size="sm"
                  >
                    {req.required ? "required" : "optional"}
                  </Badge>
                }
              />
            ))}
          </Section>
        )}

        {kit.channels.length > 0 && (
          <Section label="Channels">
            {kit.channels.map((channel) => (
              <Row
                key={channel.type}
                icons={[channel.type]}
                title={channel.type === "slack" ? "Slack" : "Telegram"}
                detail={channel.note}
                trailing={
                  <Badge variant="muted" size="sm">
                    optional
                  </Badge>
                }
              />
            ))}
          </Section>
        )}

        {!kit.image && (
          <Section label="Harness">
            <Row
              title={harnessesLine(kit)}
              detail="Chosen on the next step, from the harnesses installed here."
            />
          </Section>
        )}

        {kit.parameters.length > 0 && (
          <Section label="Onboarding will ask you for">
            {kit.parameters.map((p) => (
              <Row
                key={p.name}
                title={p.name}
                detail={p.note}
                trailing={
                  <Badge variant={p.required ? "template" : "muted"} size="sm">
                    {p.required ? "required" : "optional"}
                  </Badge>
                }
              />
            ))}
          </Section>
        )}
        <h2 className="mb-3 mt-8 text-base font-semibold text-foreground">
          See it in action
        </h2>
        {kit.video ? (
          <a
            href={kit.video}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-foreground underline underline-offset-2"
          >
            Watch the walkthrough <Launch size={16} />
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">Video coming soon.</p>
        )}
      </DialogBody>

      <DialogFooter divided className="justify-between">
        <Button variant="ghost" onClick={close}>
          <ArrowLeft size={16} /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setView("coding-agent-new")}>
            Start from scratch instead
          </Button>
          <Button
            onClick={() => navigateToStarterKitSetup(kit.catalog, kit.id)}
          >
            Use this Starter Kit
          </Button>
        </div>
      </DialogFooter>
    </Modal>
  );
}
